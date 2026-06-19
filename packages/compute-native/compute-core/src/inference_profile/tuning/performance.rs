use serde::{Deserialize, Serialize};

use crate::inference_profile::{evidence::TimestampMs, phase::PhaseKind};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PerformanceMetricSet {
    pub tokenizer_ingress_latency_ns: Option<u64>,
    pub retrieval_latency_ns: Option<u64>,
    pub reranking_latency_ns: Option<u64>,
    pub prefill_ttft_ns: Option<u64>,
    pub decode_tps: Option<f64>,
    pub token_latency_p50_ns: Option<u64>,
    pub token_latency_p95_ns: Option<u64>,
    pub token_latency_p99_ns: Option<u64>,
    pub kv_write_latency_ns: Option<u64>,
    pub kv_append_latency_ns: Option<u64>,
    pub kv_view_copy_cost_bytes: Option<u64>,
    pub structured_validation_overhead_ns: Option<u64>,
    pub tool_call_boundary_latency_ns: Option<u64>,
    pub memory_read_latency_ns: Option<u64>,
    pub memory_write_latency_ns: Option<u64>,
    pub checkpoint_cost_ns: Option<u64>,
    pub cancellation_latency_ns: Option<u64>,
    pub recovery_time_ns: Option<u64>,
    pub peak_memory_bytes: Option<u64>,
    pub active_memory_bytes: Option<u64>,
    pub cache_memory_bytes: Option<u64>,
    pub ssd_cache_hit_rate: Option<f64>,
    pub warm_vs_cold_cache_delta_tps: Option<f64>,
    pub thermal_degradation_pct: Option<f64>,
    pub concurrency_scaling_efficiency: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricDelta {
    pub metric_name: String,
    pub baseline_value: f64,
    pub candidate_value: f64,
    pub delta_pct: f64,
    pub direction: MetricDirection,
    pub protected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricDirection {
    Better,
    Worse,
    Neutral,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceBenchmarkSpec {
    pub spec_id: String,
    pub phase_kind: PhaseKind,
    pub target_metrics: Vec<String>,
    pub repetitions: u32,
    pub warmup_runs: Option<u32>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceBenchmarkReceipt {
    pub receipt_id: String,
    pub spec_id: String,
    pub run_number: u32,
    pub started_at: TimestampMs,
    pub finished_at: TimestampMs,
    pub metrics: PerformanceMetricSet,
    pub comparison_delta: Option<Vec<MetricDelta>>,
    pub notes: Option<String>,
}
