//! TRIBUNUS-ASYNC-INFERENCE-PROFILE-0001 (TAIP)
//!
//! TAIP is the schema and execution model for Tribunus's phase-graph approach
//! to inference. Instead of treating inference as a monolithic `generate()` call,
//! TAIP models it as a DAG of independently-qualified execution phases.
//!
//! Each phase declares:
//! - Its `PhaseKind` and static behavioural flags
//! - The `BackendOwnerContract` that owns its execution
//! - Its `MemoryContract` (address space, mutability, copy policy)
//! - Its `ConcurrencyPolicy` (scheduling, barriers, read/write model)
//! - Its `EvidenceRequirement` gates that must pass for qualification
//! - Its current `EvidenceStatus` (derived from the `EvidenceLedger`)
//!
//! # Key invariant
//!
//! `EvidenceStatus::Compiled` NEVER implies `EvidenceStatus::Qualified`.
//! Compilation only proves the tool accepted the artifact. Every gate
//! (`Loaded`, `RuntimeSmokePassed`, `ParityPassed`, etc.) must be reached
//! independently via separate `PhaseEvidenceReceipt`s in the ledger.
//!
//! # Core AI positioning
//!
//! Apple's Core AI is `BackendKind::CoreAI`. Its KV-cache phases start as
//! `BackendPhaseCapability::Opaque` because the runtime abstracts placement.
//! Tribunus treats Core AI as a hostile black box: observable behaviour only,
//! durable receipts only, no inferred authority.
//!
//! # Module map
//!
//! - [`ids`] — strongly-typed identifiers (`PhaseId`, `ProfileId`, digests)
//! - [`phase`] — `PhaseKind`, `PhaseStaticMeta`, `AsyncInferencePhase`
//! - [`backend`] — `BackendKind`, `PlacementClaim`, `EvidenceStatus`, `BackendOwnerContract`
//! - [`memory`] — `AddressSpaceKind`, `MemoryContract`
//! - [`concurrency`] — `SchedulingMode`, `ConcurrencyPolicy`
//! - [`evidence`] — `PhaseEvidenceReceipt`, `status_reducer`, `EvidenceLedger`
//! - [`profile`] — `MachineProfile`, `ModelProfile`, `ExecutionProfile`, `PhaseGraph`
//! - [`serde_schema`] — canonical JSON digest, JSON Schema stubs

pub mod backend;
pub mod concurrency;
pub mod core_ai;
pub mod coreml_opaque_probe;
pub mod evidence;
pub mod ids;
pub mod ledger_jsonl;
pub mod memory;
pub mod mlx_probe;
pub mod phase;
pub mod profile;
pub mod reference_backend;
pub mod serde_schema;
pub mod tuning;

// ── Convenience re-exports ─────────────────────────────────────────────────

pub use ids::{
    ArtifactDigest, BackendAdapterId, MachineProfileDigest, ModelProfileDigest, PhaseId, ProfileId,
    ReceiptId,
};

pub use phase::{
    required_gates, AsyncInferencePhase, CancellationPolicy, CheckpointPolicy, EvidenceRequirement,
    IoKind, PhaseInputContract, PhaseKind, PhaseOutputContract, PhaseStaticMeta,
};

pub use backend::{
    BackendKind, BackendOwnerContract, DeviceClass, EvidenceStatus, FallbackPolicy, OwnershipMode,
    PlacementClaim,
};

pub use memory::{
    AddressSpaceKind, AliasingPolicy, CopyPolicy, LifetimePolicy, MemoryContract,
    MemoryPressurePolicy, MutabilityMode, SynchronizationPolicy, TensorLayoutContract,
};

pub use concurrency::{
    BarrierKind, ConcurrencyPolicy, RacePolicy, ReadWriteModel, SchedulingMode, StreamAffinity,
};

pub use evidence::{
    status_reducer, EvidenceArtifactRef, EvidenceGateResult, EvidenceLedger, FailureClassification,
    LedgerError, NativeEvidenceLedger, PhaseEvidenceReceipt, PhaseMetrics, TimestampMs,
};

pub use profile::{
    AotCompilePhase, CompressionContract, ExecutionProfile, KvCacheShapeContract, MachineProfile,
    ModelBundleManifest, ModelProfile, PhaseGraph, PhaseGraphError,
};

pub use serde_schema::{all_schemas, canonical_digest, canonical_json};

pub use tuning::{
    BaselineProfileRef, CachePolicy, GenericEvalKind, HardGate, IntelligenceBenchmarkKind,
    IntelligenceBenchmarkReceipt, IntelligenceBenchmarkSpec, MetricDelta,
    PerformanceBenchmarkReceipt, PerformanceBenchmarkSpec, ProtectedMetricGuard, TargetMetricSpec,
    TribunusNativeEvalKind, TuningAcceptancePolicy, TuningBenchmarkReceipt, TuningBenchmarkSuite,
    TuningLoopState, TuningOutcome, WorkloadClass, WorkloadDescriptor,
};

pub use core_ai::CoreAIBackendAdapter;
pub use coreml_opaque_probe::CoreMlOpaqueProbe;
pub use ledger_jsonl::JsonlEvidenceLedger;
pub use mlx_probe::MlxProbe;
pub use reference_backend::CpuReferenceBackend;
