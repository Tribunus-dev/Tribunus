//! TAIP memory contracts — tensor ownership, address spaces, and copy policy.
//!
//! `MemoryContract` is the heart of the TAIP phase system. On Apple silicon,
//! the unified-memory architecture means CPU and GPU share physical memory,
//! but frameworks differ in whether they expose host-visible buffers.
//!
//! - MLX: arrays live in unified memory; CPU/GPU use them without copying.
//! - Core AI / Core ML: placement is backend-managed; host visibility is opaque
//!   unless explicitly documented. Default `AddressSpaceKind` is `BackendOpaque`.

use serde::{Deserialize, Serialize};

// ── AddressSpaceKind ───────────────────────────────────────────────────────

/// Where tensor data lives relative to the host CPU.
///
/// On Apple silicon, `UnifiedHostVisible` is the preferred claim for MLX
/// (arrays live in shared memory, accessible from both CPU and GPU without
/// device copies). For Core AI and Core ML, use `BackendOpaque` unless
/// evidence proves host-visible access.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddressSpaceKind {
    /// Host CPU and GPU share the same physical memory; no copy required for
    /// cross-device access (Apple silicon unified memory, MLX arrays).
    UnifiedHostVisible,
    /// Tensor lives exclusively on the device; host access requires copy.
    DeviceLocal,
    /// Pinned host memory, DMA-accessible by the device.
    PinnedHost,
    /// Backed by an IOSurface; can be shared with Core ML via PixelBuffer.
    MappedIoSurface,
    /// Backend manages the address space internally; host visibility unknown.
    /// Use this for Core AI and Core ML unless evidence proves otherwise.
    BackendOpaque,
    /// Data lives on a remote server; latency-bound access.
    Remote,
    /// Address space is not known.
    Unknown,
}

// ── MutabilityMode ─────────────────────────────────────────────────────────

/// Whether tensor data can be mutated in place.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MutabilityMode {
    /// Read-only after creation.
    Immutable,
    /// Can be written in place by a single owner.
    MutableExclusive,
    /// Can be appended to but not modified in place (KV cache append semantics).
    AppendOnly,
}

// ── AliasingPolicy ─────────────────────────────────────────────────────────

/// Whether multiple handles can point to the same physical memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AliasingPolicy {
    /// No aliasing — each handle owns distinct storage.
    NoAliasing,
    /// Read-only aliases are permitted.
    ReadOnlyAliasPermitted,
    /// Full aliasing is permitted (unsafe; requires explicit documentation).
    AliasPermitted,
}

// ── CopyPolicy ─────────────────────────────────────────────────────────────

/// Whether data movement across a phase boundary requires a copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CopyPolicy {
    /// No application-level copy — zero-copy path.
    ZeroCopy,
    /// Backend may copy internally but the application does not.
    ApplicationZeroCopy,
    /// A host-side copy is required for this boundary.
    HostCopyRequired,
    /// Copy behaviour is managed by the backend; unknown from outside.
    BackendManaged,
}

// ── SynchronizationPolicy ──────────────────────────────────────────────────

/// How execution ordering is enforced across operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SynchronizationPolicy {
    /// Explicit synchronization barrier required (e.g. `eval()` fence).
    ExplicitBarrier,
    /// Backend inserts dependency fences automatically (MLX stream scheduling).
    BackendManaged,
    /// Fully asynchronous; caller is responsible for ordering.
    CallerManaged,
    /// No synchronization needed (single-threaded, serial execution).
    None,
}

// ── LifetimePolicy ─────────────────────────────────────────────────────────

/// When tensor storage is released.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifetimePolicy {
    /// Released when all dependent operations complete (lazy / RAII).
    LazyOnCompletion,
    /// Released explicitly by the owning phase.
    ExplicitRelease,
    /// Tied to a session lease — released when the session ends.
    SessionScoped,
    /// Persisted across sessions (checkpoint storage).
    Persistent,
}

// ── MemoryPressurePolicy ───────────────────────────────────────────────────

/// How the phase responds when memory is under pressure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryPressurePolicy {
    /// Fail fast — return an error rather than evict or swap.
    FailFast,
    /// Evict least-recently-used cached tensors and retry.
    EvictCache,
    /// Route to a lower-memory backend (e.g. CPU fallback).
    RouteToCheaperBackend,
    /// Block until memory is available.
    BlockUntilAvailable,
    /// Backend manages pressure internally (Core ML / Core AI).
    BackendManaged,
}

// ── TensorLayoutContract ───────────────────────────────────────────────────

/// Declares the layout of a tensor at a phase boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensorLayoutContract {
    /// Logical dtype (e.g. `"f16"`, `"bf16"`, `"f32"`, `"i8"`).
    pub logical_dtype: String,
    /// Physical storage dtype (may differ, e.g. int4 packed as int8).
    pub storage_dtype: String,
    /// Dimension ordering (`"row_major"`, `"col_major"`, `"backend_managed"`).
    pub dimension_order: String,
    /// Alignment requirement in bytes (e.g. 16, 4096).
    pub alignment_bytes: u32,
}

impl TensorLayoutContract {
    pub fn f16_row_major() -> Self {
        Self {
            logical_dtype: "f16".into(),
            storage_dtype: "f16".into(),
            dimension_order: "row_major".into(),
            alignment_bytes: 16,
        }
    }

    pub fn f32_row_major() -> Self {
        Self {
            logical_dtype: "f32".into(),
            storage_dtype: "f32".into(),
            dimension_order: "row_major".into(),
            alignment_bytes: 16,
        }
    }

    pub fn opaque() -> Self {
        Self {
            logical_dtype: "opaque".into(),
            storage_dtype: "opaque".into(),
            dimension_order: "backend_managed".into(),
            alignment_bytes: 0,
        }
    }
}

// ── MemoryContract ─────────────────────────────────────────────────────────

/// Declares the memory semantics of a phase's primary tensor resource.
///
/// This is the binding contract between phases in the graph: if phase A
/// produces a tensor and phase B consumes it, both must agree on the
/// `MemoryContract`. Mismatches require an explicit copy node between them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryContract {
    /// Where tensor data lives.
    pub address_space: AddressSpaceKind,
    /// Optional layout metadata (None if entirely backend-opaque).
    pub tensor_layout: Option<TensorLayoutContract>,
    /// Whether the tensor can be mutated.
    pub mutability: MutabilityMode,
    /// Aliasing policy.
    pub aliasing: AliasingPolicy,
    /// Copy requirements at phase boundaries.
    pub copy_policy: CopyPolicy,
    /// How synchronization is managed.
    pub synchronization: SynchronizationPolicy,
    /// When the storage is released.
    pub lifetime: LifetimePolicy,
    /// How memory pressure is handled.
    pub pressure_policy: MemoryPressurePolicy,
    /// Whether zero-copy has been proven by evidence (vs. claimed).
    /// `None` = not yet probed.
    pub zero_copy_claim: Option<bool>,
}

impl MemoryContract {
    /// Unified-memory contract for MLX arrays: host-visible, no copy required,
    /// backend manages synchronization across CPU/GPU streams.
    pub fn mlx_unified() -> Self {
        Self {
            address_space: AddressSpaceKind::UnifiedHostVisible,
            tensor_layout: Some(TensorLayoutContract::f16_row_major()),
            mutability: MutabilityMode::MutableExclusive,
            aliasing: AliasingPolicy::NoAliasing,
            copy_policy: CopyPolicy::ZeroCopy,
            synchronization: SynchronizationPolicy::BackendManaged,
            lifetime: LifetimePolicy::LazyOnCompletion,
            pressure_policy: MemoryPressurePolicy::EvictCache,
            zero_copy_claim: None, // must be confirmed by probe
        }
    }

    /// Opaque contract for Core AI / Core ML — host visibility unknown.
    pub fn backend_opaque() -> Self {
        Self {
            address_space: AddressSpaceKind::BackendOpaque,
            tensor_layout: Some(TensorLayoutContract::opaque()),
            mutability: MutabilityMode::Immutable,
            aliasing: AliasingPolicy::NoAliasing,
            copy_policy: CopyPolicy::BackendManaged,
            synchronization: SynchronizationPolicy::BackendManaged,
            lifetime: LifetimePolicy::SessionScoped,
            pressure_policy: MemoryPressurePolicy::BackendManaged,
            zero_copy_claim: None,
        }
    }

    /// Contract for IOSurface-backed boundary tensors (MLX ↔ Core ML bridge).
    pub fn iosurface_fp16() -> Self {
        Self {
            address_space: AddressSpaceKind::MappedIoSurface,
            tensor_layout: Some(TensorLayoutContract {
                logical_dtype: "f16".into(),
                storage_dtype: "f16".into(),
                dimension_order: "row_major".into(),
                alignment_bytes: 4096,
            }),
            mutability: MutabilityMode::MutableExclusive,
            aliasing: AliasingPolicy::NoAliasing,
            copy_policy: CopyPolicy::ApplicationZeroCopy,
            synchronization: SynchronizationPolicy::ExplicitBarrier,
            lifetime: LifetimePolicy::ExplicitRelease,
            pressure_policy: MemoryPressurePolicy::FailFast,
            zero_copy_claim: None,
        }
    }

    /// Simple CPU host memory contract for the reference backend.
    pub fn cpu_host() -> Self {
        Self {
            address_space: AddressSpaceKind::PinnedHost,
            tensor_layout: Some(TensorLayoutContract::f32_row_major()),
            mutability: MutabilityMode::MutableExclusive,
            aliasing: AliasingPolicy::NoAliasing,
            copy_policy: CopyPolicy::HostCopyRequired,
            synchronization: SynchronizationPolicy::None,
            lifetime: LifetimePolicy::LazyOnCompletion,
            pressure_policy: MemoryPressurePolicy::FailFast,
            zero_copy_claim: Some(false),
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mlx_unified_contract_has_correct_address_space() {
        let c = MemoryContract::mlx_unified();
        assert_eq!(c.address_space, AddressSpaceKind::UnifiedHostVisible);
        assert_eq!(c.copy_policy, CopyPolicy::ZeroCopy);
        assert_eq!(c.synchronization, SynchronizationPolicy::BackendManaged);
    }

    #[test]
    fn backend_opaque_contract_is_opaque() {
        let c = MemoryContract::backend_opaque();
        assert_eq!(c.address_space, AddressSpaceKind::BackendOpaque);
        assert_eq!(c.copy_policy, CopyPolicy::BackendManaged);
        // zero_copy_claim must be None — we do not assume zero-copy for opaque backends
        assert!(c.zero_copy_claim.is_none());
    }

    #[test]
    fn iosurface_contract_has_page_alignment() {
        let c = MemoryContract::iosurface_fp16();
        assert_eq!(c.address_space, AddressSpaceKind::MappedIoSurface);
        assert_eq!(
            c.tensor_layout.unwrap().alignment_bytes,
            4096,
            "IOSurface tensors must be page-aligned"
        );
    }

    #[test]
    fn memory_contract_serde_round_trip() {
        let c = MemoryContract::mlx_unified();
        let json = serde_json::to_string(&c).unwrap();
        let back: MemoryContract = serde_json::from_str(&json).unwrap();
        assert_eq!(back.address_space, c.address_space);
        assert_eq!(back.copy_policy, c.copy_policy);
    }

    #[test]
    fn address_space_kind_serde_round_trip() {
        for kind in [
            AddressSpaceKind::UnifiedHostVisible,
            AddressSpaceKind::BackendOpaque,
            AddressSpaceKind::MappedIoSurface,
            AddressSpaceKind::Remote,
        ] {
            let json = serde_json::to_string(&kind).unwrap();
            let back: AddressSpaceKind = serde_json::from_str(&json).unwrap();
            assert_eq!(back, kind);
        }
    }
}
