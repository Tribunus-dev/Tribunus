//! TAIP backend kinds, placement claims, and the `BackendOwnerContract`.
//!
//! `BackendKind` is the enumeration of all known execution substrates.
//! `BackendOwnerContract` is a structured claim (not a string) asserting
//! which backend owns execution of a phase. The claim is only credible once
//! a qualifying `PhaseEvidenceReceipt` exists in the `EvidenceLedger`.

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::inference_profile::ids::{BackendAdapterId, ReceiptId};

// ── BackendKind ────────────────────────────────────────────────────────────

/// All known execution substrates Tribunus can route a phase to.
///
/// Variants are stable. Adding a variant is semver-minor;
/// removing or renaming is semver-major.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendKind {
    /// Apple Core AI (macOS 27+ / iOS 27+ / Xcode 27+).
    /// Proprietary runtime; treated as an opaque black box.
    CoreAI,
    /// Apple Core ML.
    CoreML,
    /// Apple MLX — unified-memory array framework.
    MLX,
    /// Apple Accelerate / BNNS / vDSP / LAPACK.
    Accelerate,
    /// Custom Metal compute shaders.
    MetalCustom,
    /// llama.cpp GGUF runtime.
    LlamaCpp,
    /// MLC-LLM compiled model runtime.
    MlcLlm,
    /// PyTorch with Apple MPS backend.
    PyTorchMps,
    /// NVIDIA CUDA.
    Cuda,
    /// AMD ROCm / HIP.
    Rocm,
    /// Vulkan compute.
    Vulkan,
    /// WebGPU (browser or native WebGPU).
    WebGpu,
    /// Remote inference endpoint (HTTP API).
    RemoteProvider,
    /// Deterministic CPU reference implementation (testing only).
    CpuReference,
    /// Tribunus-native Rust implementation.
    TribunusNative,
}

impl fmt::Display for BackendKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            BackendKind::CoreAI => "core_ai",
            BackendKind::CoreML => "core_ml",
            BackendKind::MLX => "mlx",
            BackendKind::Accelerate => "accelerate",
            BackendKind::MetalCustom => "metal_custom",
            BackendKind::LlamaCpp => "llama_cpp",
            BackendKind::MlcLlm => "mlc_llm",
            BackendKind::PyTorchMps => "pytorch_mps",
            BackendKind::Cuda => "cuda",
            BackendKind::Rocm => "rocm",
            BackendKind::Vulkan => "vulkan",
            BackendKind::WebGpu => "web_gpu",
            BackendKind::RemoteProvider => "remote_provider",
            BackendKind::CpuReference => "cpu_reference",
            BackendKind::TribunusNative => "tribunus_native",
        };
        f.write_str(s)
    }
}

// ── DeviceClass ────────────────────────────────────────────────────────────

/// The class of physical device the backend targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceClass {
    AppleSiliconUnified,
    AppleSiliconGpu,
    AppleNeuralEngine,
    IntelCpu,
    AmdCpu,
    ArmCpu,
    NvidiaGpu,
    AmdGpu,
    Remote,
    Unknown,
}

// ── PlacementClaim ─────────────────────────────────────────────────────────

/// Where execution is *claimed* to happen.
///
/// For Apple frameworks that abstract scheduling internally (Core AI, Core ML),
/// use `BackendManaged` — not `Ane` or `Gpu` — unless Instruments or
/// documented APIs explicitly prove the placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlacementClaim {
    /// Executed on the CPU.
    Cpu,
    /// Executed on the GPU.
    Gpu,
    /// Executed on the Apple Neural Engine.
    Ane,
    /// Dispatched across CPU and GPU using shared memory — no copy required.
    CpuGpuShared,
    /// The backend manages placement internally; actual device is not inspectable.
    BackendManaged,
    /// Executed on a remote server.
    Remote,
    /// Placement is not known.
    Unknown,
}

// ── OwnershipMode ──────────────────────────────────────────────────────────

/// How the backend takes ownership of tensor data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnershipMode {
    /// Backend holds exclusive mutable ownership.
    Exclusive,
    /// Multiple backends may read simultaneously; no writer.
    SharedRead,
    /// Ownership is transferred via a durable lease mechanism.
    LeaseGated,
}

// ── EvidenceStatus ─────────────────────────────────────────────────────────

/// Qualification status of a backend for a specific phase on a specific
/// (model, machine) tuple.
///
/// Status is derived by the `status_reducer` from the receipt history.
/// It is never stored as authoritative state — always recomputed.
///
/// **Invariant: `Compiled` cannot advance directly to `Qualified`.**
/// Every intermediate gate must produce a passing receipt first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStatus {
    /// No qualification attempt has been made.
    Unqualified = 0,
    /// A capability claim has been registered but no tests run.
    Claimed = 1,
    /// The artifact compiled without error (does NOT imply correctness).
    Compiled = 2,
    /// The artifact loaded into the backend runtime.
    Loaded = 3,
    /// A basic smoke test passed (toy inputs, happy path only).
    RuntimeSmokePassed = 4,
    /// Outputs match a reference implementation within tolerance.
    ParityPassed = 5,
    /// Repeated execution under load passes without regression.
    StressPassed = 6,
    /// Concurrent access patterns respected all defined invariants.
    ConcurrencyPassed = 7,
    /// Cancellation leaves no orphaned writes or poisoned state.
    CancellationPassed = 8,
    /// Recovery from checkpoint produces correct output.
    RecoveryPassed = 9,
    /// All required gates passed — this phase is fully qualified.
    Qualified = 10,
    /// A gate failed; the backend is ineligible for this phase.
    Rejected = 255,
    /// A gate produced ambiguous results; requires human review.
    Quarantined = 254,
}

impl EvidenceStatus {
    /// Returns `true` if this status represents a terminal failure.
    pub fn is_failed(self) -> bool {
        matches!(self, EvidenceStatus::Rejected | EvidenceStatus::Quarantined)
    }

    /// Returns `true` if this status represents successful qualification.
    pub fn is_qualified(self) -> bool {
        self == EvidenceStatus::Qualified
    }
}

impl fmt::Display for EvidenceStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            EvidenceStatus::Unqualified => "unqualified",
            EvidenceStatus::Claimed => "claimed",
            EvidenceStatus::Compiled => "compiled",
            EvidenceStatus::Loaded => "loaded",
            EvidenceStatus::RuntimeSmokePassed => "runtime_smoke_passed",
            EvidenceStatus::ParityPassed => "parity_passed",
            EvidenceStatus::StressPassed => "stress_passed",
            EvidenceStatus::ConcurrencyPassed => "concurrency_passed",
            EvidenceStatus::CancellationPassed => "cancellation_passed",
            EvidenceStatus::RecoveryPassed => "recovery_passed",
            EvidenceStatus::Qualified => "qualified",
            EvidenceStatus::Rejected => "rejected",
            EvidenceStatus::Quarantined => "quarantined",
        };
        f.write_str(s)
    }
}

// ── FallbackPolicy ─────────────────────────────────────────────────────────

/// How the phase graph responds when the primary backend fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FallbackPolicy {
    /// No fallback — failure is propagated to the caller.
    None,
    /// A fallback backend is required and must be pre-qualified.
    Required,
    /// A fallback backend is available but not mandatory.
    Optional,
}

// ── BackendOwnerContract ───────────────────────────────────────────────────

/// A structured claim asserting which backend owns execution of a phase.
///
/// This is the typed form of "MLX owns prefill." The claim is only credible
/// once a qualifying `PhaseEvidenceReceipt` exists in the `EvidenceLedger`.
/// Never derive authority from the claim alone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendOwnerContract {
    /// Which backend this contract assigns ownership to.
    pub backend: BackendKind,
    /// Versioned adapter identifier (e.g. `"mlx-backend@0.3.0"`).
    pub adapter_id: BackendAdapterId,
    /// Human-readable adapter version string.
    pub adapter_version: String,
    /// Framework or runtime version reported by the backend at probe time.
    pub runtime_version: Option<String>,
    /// Physical device class the backend targets.
    pub device_class: DeviceClass,
    /// Where execution *claims* to happen.
    pub placement: PlacementClaim,
    /// How tensor ownership is managed.
    pub ownership_mode: OwnershipMode,
    /// Current qualification status (derived from evidence, not asserted).
    pub support_status: EvidenceStatus,
    /// ID of the most recent passing `PhaseEvidenceReceipt`, if any.
    pub qualification_receipt_id: Option<ReceiptId>,
}

impl BackendOwnerContract {
    /// Construct an unqualified contract for the given backend.
    pub fn unqualified(backend: BackendKind, adapter_id: BackendAdapterId) -> Self {
        let (device_class, placement) = default_device_placement(backend);
        Self {
            backend,
            adapter_id,
            adapter_version: "0.0.0".into(),
            runtime_version: None,
            device_class,
            placement,
            ownership_mode: OwnershipMode::Exclusive,
            support_status: EvidenceStatus::Unqualified,
            qualification_receipt_id: None,
        }
    }
}

fn default_device_placement(backend: BackendKind) -> (DeviceClass, PlacementClaim) {
    match backend {
        BackendKind::CoreAI | BackendKind::CoreML => (
            DeviceClass::AppleSiliconUnified,
            PlacementClaim::BackendManaged,
        ),
        BackendKind::MLX => (
            DeviceClass::AppleSiliconUnified,
            PlacementClaim::CpuGpuShared,
        ),
        BackendKind::Accelerate => (DeviceClass::AppleSiliconUnified, PlacementClaim::Cpu),
        BackendKind::MetalCustom => (DeviceClass::AppleSiliconGpu, PlacementClaim::Gpu),
        BackendKind::Cuda => (DeviceClass::NvidiaGpu, PlacementClaim::Gpu),
        BackendKind::Rocm => (DeviceClass::AmdGpu, PlacementClaim::Gpu),
        BackendKind::CpuReference | BackendKind::TribunusNative => {
            (DeviceClass::ArmCpu, PlacementClaim::Cpu)
        }
        BackendKind::RemoteProvider => (DeviceClass::Remote, PlacementClaim::Remote),
        _ => (DeviceClass::Unknown, PlacementClaim::Unknown),
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference_profile::ids::BackendAdapterId;

    #[test]
    fn evidence_status_ordering() {
        // Unqualified < Compiled < Loaded < ... < Qualified
        assert!(EvidenceStatus::Unqualified < EvidenceStatus::Compiled);
        assert!(EvidenceStatus::Compiled < EvidenceStatus::Loaded);
        assert!(EvidenceStatus::Loaded < EvidenceStatus::RuntimeSmokePassed);
        assert!(EvidenceStatus::RuntimeSmokePassed < EvidenceStatus::Qualified);
    }

    #[test]
    fn compiled_is_not_qualified() {
        assert!(!EvidenceStatus::Compiled.is_qualified());
    }

    #[test]
    fn rejected_is_failed() {
        assert!(EvidenceStatus::Rejected.is_failed());
        assert!(EvidenceStatus::Quarantined.is_failed());
        assert!(!EvidenceStatus::Qualified.is_failed());
    }

    #[test]
    fn backend_kind_serde_round_trip() {
        for backend in [
            BackendKind::CoreAI,
            BackendKind::MLX,
            BackendKind::CoreML,
            BackendKind::CpuReference,
            BackendKind::RemoteProvider,
        ] {
            let json = serde_json::to_string(&backend).unwrap();
            let back: BackendKind = serde_json::from_str(&json).unwrap();
            assert_eq!(back, backend);
        }
    }

    #[test]
    fn core_ai_defaults_to_backend_managed_placement() {
        let (_, placement) = default_device_placement(BackendKind::CoreAI);
        assert_eq!(
            placement,
            PlacementClaim::BackendManaged,
            "CoreAI must default to BackendManaged — never assume ANE or GPU without evidence"
        );
    }

    #[test]
    fn core_ml_defaults_to_backend_managed_placement() {
        let (_, placement) = default_device_placement(BackendKind::CoreML);
        assert_eq!(placement, PlacementClaim::BackendManaged);
    }

    #[test]
    fn mlx_defaults_to_cpu_gpu_shared() {
        let (_, placement) = default_device_placement(BackendKind::MLX);
        assert_eq!(placement, PlacementClaim::CpuGpuShared);
    }

    #[test]
    fn backend_owner_contract_unqualified_constructor() {
        let contract = BackendOwnerContract::unqualified(
            BackendKind::MLX,
            BackendAdapterId::new("mlx-backend", "0.3.0"),
        );
        assert_eq!(contract.backend, BackendKind::MLX);
        assert_eq!(contract.support_status, EvidenceStatus::Unqualified);
        assert!(contract.qualification_receipt_id.is_none());
        assert_eq!(contract.placement, PlacementClaim::CpuGpuShared);
    }

    #[test]
    fn placement_claim_serde_round_trip() {
        let p = PlacementClaim::BackendManaged;
        let json = serde_json::to_string(&p).unwrap();
        let back: PlacementClaim = serde_json::from_str(&json).unwrap();
        assert_eq!(back, p);
    }
}
