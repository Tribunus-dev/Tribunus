use serde::{Deserialize, Serialize};

use crate::inference_profile::ids::{MachineProfileDigest, ModelProfileDigest};

use super::{
    intelligence::{IntelligenceBenchmarkReceipt, IntelligenceBenchmarkSpec},
    performance::{PerformanceBenchmarkReceipt, PerformanceBenchmarkSpec},
    policy::{TuningAcceptancePolicy, TuningOutcome},
};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SuiteId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkloadClass {
    ShortChat,
    LongContextAnalysis,
    ConcurrentBatch,
    ToolCallHeavy,
    RepeatedPrefixCoding,
    StructuredOutputGeneration,
    RetrievalAugmented,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CachePolicy {
    NoCaching,
    PrefixReuse,
    SsdKvTiered,
    WarmSessionRestore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkloadDescriptor {
    pub workload_class: WorkloadClass,
    pub avg_context_tokens: u32,
    pub concurrency_level: u32,
    pub cache_policy: CachePolicy,
    pub streaming_required: bool,
    pub tool_call_budget_per_turn: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TuningLoopState {
    CandidateGenerated,
    PerformanceSuiteRunning,
    PerformanceComplete,
    IntelligenceSuiteRunning,
    Comparing,
    OutcomeDetermined,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineProfileRef {
    pub profile_digest: String,
    pub suite_receipt_digest: String,
    pub promoted_at: u64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TuningBenchmarkReceipt {
    pub receipt_id: String,
    pub receipt_kind: TuningReceiptKind,
    pub performance: Option<PerformanceBenchmarkReceipt>,
    pub intelligence: Option<IntelligenceBenchmarkReceipt>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TuningReceiptKind {
    Performance,
    Intelligence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TuningBenchmarkSuite {
    pub schema_version: String,
    pub suite_id: SuiteId,
    pub model_profile_digest: ModelProfileDigest,
    pub machine_profile_digest: MachineProfileDigest,
    pub execution_profile_digest: String,
    pub workload_descriptor: WorkloadDescriptor,
    pub performance_benchmarks: Vec<PerformanceBenchmarkSpec>,
    pub intelligence_benchmarks: Vec<IntelligenceBenchmarkSpec>,
    pub acceptance_policy: TuningAcceptancePolicy,
    pub comparison_baseline: Option<BaselineProfileRef>,
    pub suite_status: TuningSuiteStatus,
    pub tuning_loop_state: TuningLoopState,
    pub benchmark_receipts: Vec<TuningBenchmarkReceipt>,
    pub tuning_outcome: Option<TuningOutcome>,
    pub created_at: u64,
    pub updated_at: Option<u64>,
    pub schema_notes: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TuningSuiteStatus {
    Pending,
    PerformanceRunning,
    IntelligenceRunning,
    Comparing,
    Promoted,
    Quarantined,
    Rejected,
}

impl Default for TuningSuiteStatus {
    fn default() -> Self {
        Self::Pending
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suite_serializes_with_required_top_level_keys() {
        let suite = TuningBenchmarkSuite {
            schema_version: "tribunus.taip.tuning_benchmark_suite.v1".into(),
            suite_id: SuiteId("suite-1".into()),
            model_profile_digest: ModelProfileDigest("a".repeat(64)),
            machine_profile_digest: MachineProfileDigest("b".repeat(64)),
            execution_profile_digest: "c".repeat(64),
            workload_descriptor: WorkloadDescriptor {
                workload_class: WorkloadClass::ShortChat,
                avg_context_tokens: 128,
                concurrency_level: 1,
                cache_policy: CachePolicy::PrefixReuse,
                streaming_required: true,
                tool_call_budget_per_turn: 4,
            },
            performance_benchmarks: vec![],
            intelligence_benchmarks: vec![],
            acceptance_policy: TuningAcceptancePolicy {
                hard_gates: vec![],
                protected_metrics: vec![],
                target_metrics: vec![],
                min_intelligence_score: 0.5,
                min_performance_score: 0.5,
                stability_runs: 3,
            },
            comparison_baseline: None,
            suite_status: TuningSuiteStatus::Pending,
            tuning_loop_state: TuningLoopState::CandidateGenerated,
            benchmark_receipts: vec![],
            tuning_outcome: None,
            created_at: 0,
            updated_at: None,
            schema_notes: None,
        };
        let json = serde_json::to_value(suite).unwrap();
        assert_eq!(
            json["schema_version"],
            "tribunus.taip.tuning_benchmark_suite.v1"
        );
        assert!(json["workload_descriptor"].is_object());
        assert!(json["performance_benchmarks"].is_array());
        assert!(json["intelligence_benchmarks"].is_array());
        assert!(json["benchmark_receipts"].is_array());
    }
}
