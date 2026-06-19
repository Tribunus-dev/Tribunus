//! Canonical HF dataset table row types.
//!
//! Each struct maps one-to-one with an Arrow record batch / Parquet column group
//! in the published Hugging Face dataset.  These are the forensic & analytic
//! schema — designed for querying, not for event ingestion.
//!
//! ## Conventions
//!
//! * Every `*_id` field is `String` (not wrapped).  Tables are independent
//!   Parquet files in HF; foreign-key relationships are logical, not enforced
//!   at the storage layer.
//! * Optional fields use `Option<T>` — absent values become null in
//!   Arrow/Parquet.  A field is optional when the instrumentation may not have
//!   captured it (e.g. older runs, hardware without thermal telemetry).
//! * Numeric sentinel-free optionals use `Option<i64>` / `Option<f64>` /
//!   `Option<u32>` rather than magic values.

use serde::{Deserialize, Serialize};

/// One row = one benchmark or compiler qualification run.
///
/// A run is the top-level execution unit: one launch of the Tribunus inference
/// engine under a specific model, hardware, and workload combination.  Every
/// observation, artifact, and manifest in the dataset belongs to exactly one
/// run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalRunRow {
    pub run_id: String,
    pub schema_version: String,
    pub created_at: String, // RFC 3339
    pub tribunus_commit: Option<String>,
    pub repo_dirty: Option<bool>,
    pub runner_os: Option<String>,
    pub runner_kernel: Option<String>,
    pub runner_hostname_hash: Option<String>,
    pub hardware_id: Option<String>,
    pub model_id: Option<String>,
    pub model_revision: Option<String>,
    pub quantization: Option<String>,
    pub workload_id: Option<String>,
    pub backend_policy_id: Option<String>,
    pub result_status: Option<String>,
    pub artifact_uri: Option<String>,
}

/// One row = one measured device configuration.
///
/// A hardware profile captures the static (or slowly-changing) properties of
/// the machine that executed a run.  Multiple runs on the same hardware share
/// the same `hardware_id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalHardwareProfileRow {
    pub hardware_id: String,
    pub soc: Option<String>,
    pub cpu_core_count: Option<u32>,
    pub gpu_core_count: Option<u32>,
    pub ram_gb: Option<f64>,
    pub os_version: Option<String>,
    pub mlx_version: Option<String>,
    pub coreml_version: Option<String>,
    pub thermal_mode: Option<String>,
    pub power_mode: Option<String>,
}

/// One row = one backend result inside a run.
///
/// A run may evaluate multiple backends (MLX, CoreML, ANE, Metal, etc.) in
/// sequence.  Each backend attempt produces one observation row containing
/// compile / load / predict status, latency percentiles, throughput, numerical
/// accuracy, and memory pressure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalBackendObservationRow {
    pub observation_id: String,
    pub run_id: String,
    pub backend: Option<String>,
    pub placement: Option<String>,
    pub compile_status: Option<String>,
    pub load_status: Option<String>,
    pub predict_status: Option<String>,
    pub fallback_used: Option<bool>,
    pub fallback_reason: Option<String>,
    pub tokens_per_second: Option<f64>,
    pub ttft_ms: Option<f64>,
    pub p50_latency_ms: Option<f64>,
    pub p95_latency_ms: Option<f64>,
    pub p99_latency_ms: Option<f64>,
    pub peak_memory_mb: Option<f64>,
    pub arena_residency_bytes: Option<i64>,
    pub numerical_max_abs_err: Option<f64>,
    pub cosine_similarity: Option<f64>,
    pub diagnostic_cluster: Option<String>,
}

/// One row = one compute-image or phase-graph qualification.
///
/// Compiler manifests describe the compiled program graph that a backend
/// actually executed: phase count, operator families, dtype / KV-cache
/// policies, cache hit rate, and any terminal failure point.  The
/// `compiler_diagnostics_hash` links to the raw compiler trace in the
/// artifacts table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalCompilerManifestRow {
    pub manifest_id: String,
    pub graph_hash: Option<String>,
    pub phase_count: Option<i32>,
    pub op_families: Option<Vec<String>>,
    pub shape_key: Option<String>,
    pub dtype_policy: Option<String>,
    pub kv_cache_policy: Option<String>,
    pub backend_eligibility: Option<Vec<String>>,
    pub compile_cache_hit: Option<bool>,
    pub compile_timing_ms: Option<i64>,
    pub terminal_failure_phase: Option<String>,
    pub compiler_diagnostics_hash: Option<String>,
}

/// One row = one linked blob: receipt, manifest, trace, log, etc.
///
/// Artifacts are the raw sidecar files that supplement structured columns:
/// compiler diagnostic JSON, memory arenas dumps, numerical comparison traces,
/// etc.  Each artifact is referenced by `run_id` and identified by its SHA-256
/// hash for deduplication.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalArtifactRow {
    pub artifact_id: String,
    pub run_id: String,
    pub kind: Option<String>,
    pub path: Option<String>,
    pub sha256: Option<String>,
    pub size_bytes: Option<i64>,
    pub mime_type: Option<String>,
    pub created_by: Option<String>,
    pub retention_policy: Option<String>,
}
