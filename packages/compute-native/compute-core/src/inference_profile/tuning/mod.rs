//! TAIP tuning benchmark schema.

pub mod intelligence;
pub mod loop_state;
pub mod performance;
pub mod policy;
pub mod suite;

pub use intelligence::{
    GenericEvalKind, IntelligenceBenchmarkKind, IntelligenceBenchmarkReceipt,
    IntelligenceBenchmarkSpec, TribunusNativeEvalKind,
};
pub use loop_state::TuningLoopState as OrderedTuningLoopState;
pub use performance::{
    MetricDelta, PerformanceBenchmarkReceipt, PerformanceBenchmarkSpec, PerformanceMetricSet,
};
pub use policy::{
    HardGate, ProtectedMetricGuard, TargetMetricSpec, TuningAcceptancePolicy, TuningOutcome,
};
pub use suite::{
    BaselineProfileRef, CachePolicy, TuningBenchmarkReceipt, TuningBenchmarkSuite, TuningLoopState,
    WorkloadClass, WorkloadDescriptor,
};
