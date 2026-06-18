use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TuningAcceptancePolicy {
    pub hard_gates: Vec<HardGate>,
    pub protected_metrics: Vec<ProtectedMetricGuard>,
    pub target_metrics: Vec<TargetMetricSpec>,
    pub min_intelligence_score: f64,
    pub min_performance_score: f64,
    pub stability_runs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardGate {
    pub gate_id: String,
    pub kind: HardGateKind,
    pub params: Option<serde_json::Value>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HardGateKind {
    SchemaValidToolCalls,
    NoUnauthorizedMemoryWrites,
    CancellationSafety,
    DeterministicReplay,
    MinimumIntelligenceScore,
    NoToolCallHallucination,
    StructuredOutputContractCompliance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectedMetricGuard {
    pub metric_name: String,
    pub regression_threshold_pct: f64,
    pub gate_class: GateClass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateClass {
    Hard,
    Soft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetMetricSpec {
    pub metric_name: String,
    pub improvement_direction: ImprovementDirection,
    pub min_improvement_pct: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImprovementDirection {
    LowerIsBetter,
    HigherIsBetter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum TuningOutcome {
    Promoted {
        effective_at: u64,
    },
    Quarantined {
        reason: QuarantineReason,
        workload_fit: Vec<crate::inference_profile::tuning::suite::WorkloadClass>,
    },
    Rejected {
        failing_gates: Vec<String>,
        regression_report: Vec<super::performance::MetricDelta>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuarantineReason {
    PerformanceRegressionInProtectedMetric,
    IntelligenceRegression,
    WorkloadSpecificOnly,
    ThermalInstability,
    ConcurrencyRegression,
}
