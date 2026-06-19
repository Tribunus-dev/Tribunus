//! Canonical HF dataset table builders — Arrow RecordBatch construction for
//! the five canonical tables: runs, hardware_profiles, backend_observations,
//! compiler_manifests, and artifacts.
//!
//! Each builder accumulates rows, flushes to [`RecordBatch`]es in groups of
//! [`BATCH_SIZE`] (8,192), and can write accumulated batches to Arrow IPC
//! (Feather v2) files.

use arrow::array::{
    BooleanBuilder, Float64Builder, Int32Builder, Int64Builder, ListBuilder, StringBuilder,
    UInt32Builder,
};
use arrow::datatypes::{DataType, Field, Schema, SchemaRef};
use arrow::ipc::writer::FileWriter;
use arrow::record_batch::RecordBatch;
use std::sync::Arc;

/// Maximum rows per batch before automatic flush.
const BATCH_SIZE: usize = 8192;

// ── Row types ──────────────────────────────────────────────────────────────

/// One row in the `runs` canonical table.
#[derive(Debug, Clone)]
pub struct CanonicalRunRow {
    pub run_id: String,
    pub schema_version: String,
    pub created_at: String,
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

/// One row in the `hardware_profiles` canonical table.
#[derive(Debug, Clone)]
pub struct CanonicalHardwareRow {
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

/// One row in the `backend_observations` canonical table.
#[derive(Debug, Clone)]
pub struct CanonicalBackendRow {
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

/// One row in the `compiler_manifests` canonical table.
#[derive(Debug, Clone)]
pub struct CanonicalCompilerRow {
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

/// One row in the `artifacts` canonical table.
#[derive(Debug, Clone)]
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

// ── CanonicalRunBatchBuilder ───────────────────────────────────────────────

/// Batch builder for the `runs` canonical table.
pub struct CanonicalRunBatchBuilder {
    schema: Arc<Schema>,
    run_id: StringBuilder,
    schema_version: StringBuilder,
    created_at: StringBuilder,
    tribunus_commit: StringBuilder,
    repo_dirty: BooleanBuilder,
    runner_os: StringBuilder,
    runner_kernel: StringBuilder,
    runner_hostname_hash: StringBuilder,
    hardware_id: StringBuilder,
    model_id: StringBuilder,
    model_revision: StringBuilder,
    quantization: StringBuilder,
    workload_id: StringBuilder,
    backend_policy_id: StringBuilder,
    result_status: StringBuilder,
    artifact_uri: StringBuilder,
    cur_rows: usize,
    batches: Vec<RecordBatch>,
}

impl CanonicalRunBatchBuilder {
    pub fn new() -> Self {
        let schema = Arc::new(Schema::new(vec![
            Field::new("run_id", DataType::Utf8, false),
            Field::new("schema_version", DataType::Utf8, false),
            Field::new("created_at", DataType::Utf8, false),
            Field::new("tribunus_commit", DataType::Utf8, true),
            Field::new("repo_dirty", DataType::Boolean, true),
            Field::new("runner_os", DataType::Utf8, true),
            Field::new("runner_kernel", DataType::Utf8, true),
            Field::new("runner_hostname_hash", DataType::Utf8, true),
            Field::new("hardware_id", DataType::Utf8, true),
            Field::new("model_id", DataType::Utf8, true),
            Field::new("model_revision", DataType::Utf8, true),
            Field::new("quantization", DataType::Utf8, true),
            Field::new("workload_id", DataType::Utf8, true),
            Field::new("backend_policy_id", DataType::Utf8, true),
            Field::new("result_status", DataType::Utf8, true),
            Field::new("artifact_uri", DataType::Utf8, true),
        ]));

        Self {
            schema,
            run_id: StringBuilder::new(),
            schema_version: StringBuilder::new(),
            created_at: StringBuilder::new(),
            tribunus_commit: StringBuilder::new(),
            repo_dirty: BooleanBuilder::new(),
            runner_os: StringBuilder::new(),
            runner_kernel: StringBuilder::new(),
            runner_hostname_hash: StringBuilder::new(),
            hardware_id: StringBuilder::new(),
            model_id: StringBuilder::new(),
            model_revision: StringBuilder::new(),
            quantization: StringBuilder::new(),
            workload_id: StringBuilder::new(),
            backend_policy_id: StringBuilder::new(),
            result_status: StringBuilder::new(),
            artifact_uri: StringBuilder::new(),
            cur_rows: 0,
            batches: Vec::new(),
        }
    }

    pub fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    pub fn push(&mut self, row: &CanonicalRunRow) {
        self.run_id.append_value(&row.run_id);
        self.schema_version.append_value(&row.schema_version);
        self.created_at.append_value(&row.created_at);
        self.tribunus_commit.append_option(row.tribunus_commit.as_deref());
        self.repo_dirty.append_option(row.repo_dirty);
        self.runner_os.append_option(row.runner_os.as_deref());
        self.runner_kernel.append_option(row.runner_kernel.as_deref());
        self.runner_hostname_hash.append_option(row.runner_hostname_hash.as_deref());
        self.hardware_id.append_option(row.hardware_id.as_deref());
        self.model_id.append_option(row.model_id.as_deref());
        self.model_revision.append_option(row.model_revision.as_deref());
        self.quantization.append_option(row.quantization.as_deref());
        self.workload_id.append_option(row.workload_id.as_deref());
        self.backend_policy_id.append_option(row.backend_policy_id.as_deref());
        self.result_status.append_option(row.result_status.as_deref());
        self.artifact_uri.append_option(row.artifact_uri.as_deref());
        self.cur_rows += 1;

        if self.cur_rows >= BATCH_SIZE {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
    }

    /// Build a single batch from current accumulators and reset.
    fn build_batch(&mut self) -> Option<RecordBatch> {
        if self.cur_rows == 0 {
            return None;
        }
        let batch = RecordBatch::try_new(
            self.schema.clone(),
            vec![
                Arc::new(self.run_id.finish()),
                Arc::new(self.schema_version.finish()),
                Arc::new(self.created_at.finish()),
                Arc::new(self.tribunus_commit.finish()),
                Arc::new(self.repo_dirty.finish()),
                Arc::new(self.runner_os.finish()),
                Arc::new(self.runner_kernel.finish()),
                Arc::new(self.runner_hostname_hash.finish()),
                Arc::new(self.hardware_id.finish()),
                Arc::new(self.model_id.finish()),
                Arc::new(self.model_revision.finish()),
                Arc::new(self.quantization.finish()),
                Arc::new(self.workload_id.finish()),
                Arc::new(self.backend_policy_id.finish()),
                Arc::new(self.result_status.finish()),
                Arc::new(self.artifact_uri.finish()),
            ],
        )
        .ok();
        self.reset_internals();
        batch
    }

    fn reset_internals(&mut self) {
        self.run_id = StringBuilder::new();
        self.schema_version = StringBuilder::new();
        self.created_at = StringBuilder::new();
        self.tribunus_commit = StringBuilder::new();
        self.repo_dirty = BooleanBuilder::new();
        self.runner_os = StringBuilder::new();
        self.runner_kernel = StringBuilder::new();
        self.runner_hostname_hash = StringBuilder::new();
        self.hardware_id = StringBuilder::new();
        self.model_id = StringBuilder::new();
        self.model_revision = StringBuilder::new();
        self.quantization = StringBuilder::new();
        self.workload_id = StringBuilder::new();
        self.backend_policy_id = StringBuilder::new();
        self.result_status = StringBuilder::new();
        self.artifact_uri = StringBuilder::new();
        self.cur_rows = 0;
    }

    /// Flush all accumulated batches including the current in-progress one.
    /// Returns the batches and resets the builder to empty.
    pub fn flush(&mut self) -> Vec<RecordBatch> {
        if self.cur_rows > 0 {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
        std::mem::take(&mut self.batches)
    }

    /// Write all accumulated batches to an Arrow IPC (Feather v2) file.
    pub fn write_to_file(&mut self, path: &str) -> std::io::Result<()> {
        let batches = self.flush();
        let file = std::fs::File::create(path)?;
        let mut writer =
            FileWriter::try_new(file, &self.schema).map_err(|e| io_error(e))?;
        for batch in &batches {
            writer.write(batch).map_err(|e| io_error(e))?;
        }
        writer.finish().map_err(|e| io_error(e))
    }
}

// ── CanonicalHardwareBatchBuilder ──────────────────────────────────────────

/// Batch builder for the `hardware_profiles` canonical table.
pub struct CanonicalHardwareBatchBuilder {
    schema: Arc<Schema>,
    hardware_id: StringBuilder,
    soc: StringBuilder,
    cpu_core_count: UInt32Builder,
    gpu_core_count: UInt32Builder,
    ram_gb: Float64Builder,
    os_version: StringBuilder,
    mlx_version: StringBuilder,
    coreml_version: StringBuilder,
    thermal_mode: StringBuilder,
    power_mode: StringBuilder,
    cur_rows: usize,
    batches: Vec<RecordBatch>,
}

impl CanonicalHardwareBatchBuilder {
    pub fn new() -> Self {
        let schema = Arc::new(Schema::new(vec![
            Field::new("hardware_id", DataType::Utf8, false),
            Field::new("soc", DataType::Utf8, true),
            Field::new("cpu_core_count", DataType::UInt32, true),
            Field::new("gpu_core_count", DataType::UInt32, true),
            Field::new("ram_gb", DataType::Float64, true),
            Field::new("os_version", DataType::Utf8, true),
            Field::new("mlx_version", DataType::Utf8, true),
            Field::new("coreml_version", DataType::Utf8, true),
            Field::new("thermal_mode", DataType::Utf8, true),
            Field::new("power_mode", DataType::Utf8, true),
        ]));

        Self {
            schema,
            hardware_id: StringBuilder::new(),
            soc: StringBuilder::new(),
            cpu_core_count: UInt32Builder::new(),
            gpu_core_count: UInt32Builder::new(),
            ram_gb: Float64Builder::new(),
            os_version: StringBuilder::new(),
            mlx_version: StringBuilder::new(),
            coreml_version: StringBuilder::new(),
            thermal_mode: StringBuilder::new(),
            power_mode: StringBuilder::new(),
            cur_rows: 0,
            batches: Vec::new(),
        }
    }

    pub fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    pub fn push(&mut self, row: &CanonicalHardwareRow) {
        self.hardware_id.append_value(&row.hardware_id);
        self.soc.append_option(row.soc.as_deref());
        self.cpu_core_count.append_option(row.cpu_core_count);
        self.gpu_core_count.append_option(row.gpu_core_count);
        self.ram_gb.append_option(row.ram_gb);
        self.os_version.append_option(row.os_version.as_deref());
        self.mlx_version.append_option(row.mlx_version.as_deref());
        self.coreml_version.append_option(row.coreml_version.as_deref());
        self.thermal_mode.append_option(row.thermal_mode.as_deref());
        self.power_mode.append_option(row.power_mode.as_deref());
        self.cur_rows += 1;

        if self.cur_rows >= BATCH_SIZE {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
    }

    fn build_batch(&mut self) -> Option<RecordBatch> {
        if self.cur_rows == 0 {
            return None;
        }
        let batch = RecordBatch::try_new(
            self.schema.clone(),
            vec![
                Arc::new(self.hardware_id.finish()),
                Arc::new(self.soc.finish()),
                Arc::new(self.cpu_core_count.finish()),
                Arc::new(self.gpu_core_count.finish()),
                Arc::new(self.ram_gb.finish()),
                Arc::new(self.os_version.finish()),
                Arc::new(self.mlx_version.finish()),
                Arc::new(self.coreml_version.finish()),
                Arc::new(self.thermal_mode.finish()),
                Arc::new(self.power_mode.finish()),
            ],
        )
        .ok();
        self.reset_internals();
        batch
    }

    fn reset_internals(&mut self) {
        self.hardware_id = StringBuilder::new();
        self.soc = StringBuilder::new();
        self.cpu_core_count = UInt32Builder::new();
        self.gpu_core_count = UInt32Builder::new();
        self.ram_gb = Float64Builder::new();
        self.os_version = StringBuilder::new();
        self.mlx_version = StringBuilder::new();
        self.coreml_version = StringBuilder::new();
        self.thermal_mode = StringBuilder::new();
        self.power_mode = StringBuilder::new();
        self.cur_rows = 0;
    }

    /// Flush all accumulated batches including the current in-progress one.
    pub fn flush(&mut self) -> Vec<RecordBatch> {
        if self.cur_rows > 0 {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
        std::mem::take(&mut self.batches)
    }

    /// Write all accumulated batches to an Arrow IPC (Feather v2) file.
    pub fn write_to_file(&mut self, path: &str) -> std::io::Result<()> {
        let batches = self.flush();
        let file = std::fs::File::create(path)?;
        let mut writer =
            FileWriter::try_new(file, &self.schema).map_err(|e| io_error(e))?;
        for batch in &batches {
            writer.write(batch).map_err(|e| io_error(e))?;
        }
        writer.finish().map_err(|e| io_error(e))
    }
}

// ── CanonicalBackendBatchBuilder ───────────────────────────────────────────

/// Batch builder for the `backend_observations` canonical table.
pub struct CanonicalBackendBatchBuilder {
    schema: Arc<Schema>,
    observation_id: StringBuilder,
    run_id: StringBuilder,
    backend: StringBuilder,
    placement: StringBuilder,
    compile_status: StringBuilder,
    load_status: StringBuilder,
    predict_status: StringBuilder,
    fallback_used: BooleanBuilder,
    fallback_reason: StringBuilder,
    tokens_per_second: Float64Builder,
    ttft_ms: Float64Builder,
    p50_latency_ms: Float64Builder,
    p95_latency_ms: Float64Builder,
    p99_latency_ms: Float64Builder,
    peak_memory_mb: Float64Builder,
    arena_residency_bytes: Int64Builder,
    numerical_max_abs_err: Float64Builder,
    cosine_similarity: Float64Builder,
    diagnostic_cluster: StringBuilder,
    cur_rows: usize,
    batches: Vec<RecordBatch>,
}

impl CanonicalBackendBatchBuilder {
    pub fn new() -> Self {
        let schema = Arc::new(Schema::new(vec![
            Field::new("observation_id", DataType::Utf8, false),
            Field::new("run_id", DataType::Utf8, false),
            Field::new("backend", DataType::Utf8, true),
            Field::new("placement", DataType::Utf8, true),
            Field::new("compile_status", DataType::Utf8, true),
            Field::new("load_status", DataType::Utf8, true),
            Field::new("predict_status", DataType::Utf8, true),
            Field::new("fallback_used", DataType::Boolean, true),
            Field::new("fallback_reason", DataType::Utf8, true),
            Field::new("tokens_per_second", DataType::Float64, true),
            Field::new("ttft_ms", DataType::Float64, true),
            Field::new("p50_latency_ms", DataType::Float64, true),
            Field::new("p95_latency_ms", DataType::Float64, true),
            Field::new("p99_latency_ms", DataType::Float64, true),
            Field::new("peak_memory_mb", DataType::Float64, true),
            Field::new("arena_residency_bytes", DataType::Int64, true),
            Field::new("numerical_max_abs_err", DataType::Float64, true),
            Field::new("cosine_similarity", DataType::Float64, true),
            Field::new("diagnostic_cluster", DataType::Utf8, true),
        ]));

        Self {
            schema,
            observation_id: StringBuilder::new(),
            run_id: StringBuilder::new(),
            backend: StringBuilder::new(),
            placement: StringBuilder::new(),
            compile_status: StringBuilder::new(),
            load_status: StringBuilder::new(),
            predict_status: StringBuilder::new(),
            fallback_used: BooleanBuilder::new(),
            fallback_reason: StringBuilder::new(),
            tokens_per_second: Float64Builder::new(),
            ttft_ms: Float64Builder::new(),
            p50_latency_ms: Float64Builder::new(),
            p95_latency_ms: Float64Builder::new(),
            p99_latency_ms: Float64Builder::new(),
            peak_memory_mb: Float64Builder::new(),
            arena_residency_bytes: Int64Builder::new(),
            numerical_max_abs_err: Float64Builder::new(),
            cosine_similarity: Float64Builder::new(),
            diagnostic_cluster: StringBuilder::new(),
            cur_rows: 0,
            batches: Vec::new(),
        }
    }

    pub fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    pub fn push(&mut self, row: &CanonicalBackendRow) {
        self.observation_id.append_value(&row.observation_id);
        self.run_id.append_value(&row.run_id);
        self.backend.append_option(row.backend.as_deref());
        self.placement.append_option(row.placement.as_deref());
        self.compile_status.append_option(row.compile_status.as_deref());
        self.load_status.append_option(row.load_status.as_deref());
        self.predict_status.append_option(row.predict_status.as_deref());
        self.fallback_used.append_option(row.fallback_used);
        self.fallback_reason.append_option(row.fallback_reason.as_deref());
        self.tokens_per_second.append_option(row.tokens_per_second);
        self.ttft_ms.append_option(row.ttft_ms);
        self.p50_latency_ms.append_option(row.p50_latency_ms);
        self.p95_latency_ms.append_option(row.p95_latency_ms);
        self.p99_latency_ms.append_option(row.p99_latency_ms);
        self.peak_memory_mb.append_option(row.peak_memory_mb);
        self.arena_residency_bytes.append_option(row.arena_residency_bytes);
        self.numerical_max_abs_err.append_option(row.numerical_max_abs_err);
        self.cosine_similarity.append_option(row.cosine_similarity);
        self.diagnostic_cluster.append_option(row.diagnostic_cluster.as_deref());
        self.cur_rows += 1;

        if self.cur_rows >= BATCH_SIZE {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
    }

    fn build_batch(&mut self) -> Option<RecordBatch> {
        if self.cur_rows == 0 {
            return None;
        }
        let batch = RecordBatch::try_new(
            self.schema.clone(),
            vec![
                Arc::new(self.observation_id.finish()),
                Arc::new(self.run_id.finish()),
                Arc::new(self.backend.finish()),
                Arc::new(self.placement.finish()),
                Arc::new(self.compile_status.finish()),
                Arc::new(self.load_status.finish()),
                Arc::new(self.predict_status.finish()),
                Arc::new(self.fallback_used.finish()),
                Arc::new(self.fallback_reason.finish()),
                Arc::new(self.tokens_per_second.finish()),
                Arc::new(self.ttft_ms.finish()),
                Arc::new(self.p50_latency_ms.finish()),
                Arc::new(self.p95_latency_ms.finish()),
                Arc::new(self.p99_latency_ms.finish()),
                Arc::new(self.peak_memory_mb.finish()),
                Arc::new(self.arena_residency_bytes.finish()),
                Arc::new(self.numerical_max_abs_err.finish()),
                Arc::new(self.cosine_similarity.finish()),
                Arc::new(self.diagnostic_cluster.finish()),
            ],
        )
        .ok();
        self.reset_internals();
        batch
    }

    fn reset_internals(&mut self) {
        self.observation_id = StringBuilder::new();
        self.run_id = StringBuilder::new();
        self.backend = StringBuilder::new();
        self.placement = StringBuilder::new();
        self.compile_status = StringBuilder::new();
        self.load_status = StringBuilder::new();
        self.predict_status = StringBuilder::new();
        self.fallback_used = BooleanBuilder::new();
        self.fallback_reason = StringBuilder::new();
        self.tokens_per_second = Float64Builder::new();
        self.ttft_ms = Float64Builder::new();
        self.p50_latency_ms = Float64Builder::new();
        self.p95_latency_ms = Float64Builder::new();
        self.p99_latency_ms = Float64Builder::new();
        self.peak_memory_mb = Float64Builder::new();
        self.arena_residency_bytes = Int64Builder::new();
        self.numerical_max_abs_err = Float64Builder::new();
        self.cosine_similarity = Float64Builder::new();
        self.diagnostic_cluster = StringBuilder::new();
        self.cur_rows = 0;
    }

    /// Flush all accumulated batches including the current in-progress one.
    pub fn flush(&mut self) -> Vec<RecordBatch> {
        if self.cur_rows > 0 {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
        std::mem::take(&mut self.batches)
    }

    /// Write all accumulated batches to an Arrow IPC (Feather v2) file.
    pub fn write_to_file(&mut self, path: &str) -> std::io::Result<()> {
        let batches = self.flush();
        let file = std::fs::File::create(path)?;
        let mut writer =
            FileWriter::try_new(file, &self.schema).map_err(|e| io_error(e))?;
        for batch in &batches {
            writer.write(batch).map_err(|e| io_error(e))?;
        }
        writer.finish().map_err(|e| io_error(e))
    }
}

// ── CanonicalCompilerBatchBuilder ──────────────────────────────────────────

/// Batch builder for the `compiler_manifests` canonical table.
pub struct CanonicalCompilerBatchBuilder {
    schema: Arc<Schema>,
    manifest_id: StringBuilder,
    graph_hash: StringBuilder,
    phase_count: Int32Builder,
    op_families: ListBuilder<StringBuilder>,
    shape_key: StringBuilder,
    dtype_policy: StringBuilder,
    kv_cache_policy: StringBuilder,
    backend_eligibility: ListBuilder<StringBuilder>,
    compile_cache_hit: BooleanBuilder,
    compile_timing_ms: Int64Builder,
    terminal_failure_phase: StringBuilder,
    compiler_diagnostics_hash: StringBuilder,
    cur_rows: usize,
    batches: Vec<RecordBatch>,
}

impl CanonicalCompilerBatchBuilder {
    pub fn new() -> Self {
        let schema = Arc::new(Schema::new(vec![
            Field::new("manifest_id", DataType::Utf8, false),
            Field::new("graph_hash", DataType::Utf8, true),
            Field::new("phase_count", DataType::Int32, true),
            Field::new(
                "op_families",
                DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
                true,
            ),
            Field::new("shape_key", DataType::Utf8, true),
            Field::new("dtype_policy", DataType::Utf8, true),
            Field::new("kv_cache_policy", DataType::Utf8, true),
            Field::new(
                "backend_eligibility",
                DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
                true,
            ),
            Field::new("compile_cache_hit", DataType::Boolean, true),
            Field::new("compile_timing_ms", DataType::Int64, true),
            Field::new("terminal_failure_phase", DataType::Utf8, true),
            Field::new("compiler_diagnostics_hash", DataType::Utf8, true),
        ]));

        Self {
            schema,
            manifest_id: StringBuilder::new(),
            graph_hash: StringBuilder::new(),
            phase_count: Int32Builder::new(),
            op_families: ListBuilder::new(StringBuilder::new()),
            shape_key: StringBuilder::new(),
            dtype_policy: StringBuilder::new(),
            kv_cache_policy: StringBuilder::new(),
            backend_eligibility: ListBuilder::new(StringBuilder::new()),
            compile_cache_hit: BooleanBuilder::new(),
            compile_timing_ms: Int64Builder::new(),
            terminal_failure_phase: StringBuilder::new(),
            compiler_diagnostics_hash: StringBuilder::new(),
            cur_rows: 0,
            batches: Vec::new(),
        }
    }

    pub fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    pub fn push(&mut self, row: &CanonicalCompilerRow) {
        self.manifest_id.append_value(&row.manifest_id);
        self.graph_hash.append_option(row.graph_hash.as_deref());
        self.phase_count.append_option(row.phase_count);
        let families = row.op_families.as_ref();
        let mut op_builder = self.op_families.values();
        Self::append_string_list_impl(&mut op_builder, families);
        self.op_families.append(true);
        self.shape_key.append_option(row.shape_key.as_deref());
        self.dtype_policy.append_option(row.dtype_policy.as_deref());
        self.kv_cache_policy.append_option(row.kv_cache_policy.as_deref());
        let eligibility = row.backend_eligibility.as_ref();
        let mut be_builder = self.backend_eligibility.values();
        Self::append_string_list_impl(&mut be_builder, eligibility);
        self.backend_eligibility.append(true);
        self.compile_cache_hit.append_option(row.compile_cache_hit);
        self.compile_timing_ms.append_option(row.compile_timing_ms);
        self.terminal_failure_phase.append_option(row.terminal_failure_phase.as_deref());
        self.compiler_diagnostics_hash.append_option(row.compiler_diagnostics_hash.as_deref());
        self.cur_rows += 1;

        if self.cur_rows >= BATCH_SIZE {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
    }

    /// Append list values (not self — no borrow conflict).
    fn append_string_list_impl(values: &mut StringBuilder, list: Option<&Vec<String>>) {
        match list {
            Some(items) => {
                for item in items {
                    values.append_value(item);
                }
            }
            None => {}
        }
                }

    fn build_batch(&mut self) -> Option<RecordBatch> {
        if self.cur_rows == 0 {
            return None;
        }
        let batch = RecordBatch::try_new(
            self.schema.clone(),
            vec![
                Arc::new(self.manifest_id.finish()),
                Arc::new(self.graph_hash.finish()),
                Arc::new(self.phase_count.finish()),
                Arc::new(self.op_families.finish()),
                Arc::new(self.shape_key.finish()),
                Arc::new(self.dtype_policy.finish()),
                Arc::new(self.kv_cache_policy.finish()),
                Arc::new(self.backend_eligibility.finish()),
                Arc::new(self.compile_cache_hit.finish()),
                Arc::new(self.compile_timing_ms.finish()),
                Arc::new(self.terminal_failure_phase.finish()),
                Arc::new(self.compiler_diagnostics_hash.finish()),
            ],
        )
        .ok();
        self.reset_internals();
        batch
    }

    fn reset_internals(&mut self) {
        self.manifest_id = StringBuilder::new();
        self.graph_hash = StringBuilder::new();
        self.phase_count = Int32Builder::new();
        self.op_families = ListBuilder::new(StringBuilder::new());
        self.shape_key = StringBuilder::new();
        self.dtype_policy = StringBuilder::new();
        self.kv_cache_policy = StringBuilder::new();
        self.backend_eligibility = ListBuilder::new(StringBuilder::new());
        self.compile_cache_hit = BooleanBuilder::new();
        self.compile_timing_ms = Int64Builder::new();
        self.terminal_failure_phase = StringBuilder::new();
        self.compiler_diagnostics_hash = StringBuilder::new();
        self.cur_rows = 0;
    }

    /// Flush all accumulated batches including the current in-progress one.
    pub fn flush(&mut self) -> Vec<RecordBatch> {
        if self.cur_rows > 0 {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
        std::mem::take(&mut self.batches)
    }

    /// Write all accumulated batches to an Arrow IPC (Feather v2) file.
    pub fn write_to_file(&mut self, path: &str) -> std::io::Result<()> {
        let batches = self.flush();
        let file = std::fs::File::create(path)?;
        let mut writer =
            FileWriter::try_new(file, &self.schema).map_err(|e| io_error(e))?;
        for batch in &batches {
            writer.write(batch).map_err(|e| io_error(e))?;
        }
        writer.finish().map_err(|e| io_error(e))
    }
}

// ── CanonicalArtifactBatchBuilder ──────────────────────────────────────────

/// Batch builder for the `artifacts` canonical table.
pub struct CanonicalArtifactBatchBuilder {
    schema: Arc<Schema>,
    artifact_id: StringBuilder,
    run_id: StringBuilder,
    kind: StringBuilder,
    path: StringBuilder,
    sha256: StringBuilder,
    size_bytes: Int64Builder,
    mime_type: StringBuilder,
    created_by: StringBuilder,
    retention_policy: StringBuilder,
    cur_rows: usize,
    batches: Vec<RecordBatch>,
}

impl CanonicalArtifactBatchBuilder {
    pub fn new() -> Self {
        let schema = Arc::new(Schema::new(vec![
            Field::new("artifact_id", DataType::Utf8, false),
            Field::new("run_id", DataType::Utf8, false),
            Field::new("kind", DataType::Utf8, true),
            Field::new("path", DataType::Utf8, true),
            Field::new("sha256", DataType::Utf8, true),
            Field::new("size_bytes", DataType::Int64, true),
            Field::new("mime_type", DataType::Utf8, true),
            Field::new("created_by", DataType::Utf8, true),
            Field::new("retention_policy", DataType::Utf8, true),
        ]));

        Self {
            schema,
            artifact_id: StringBuilder::new(),
            run_id: StringBuilder::new(),
            kind: StringBuilder::new(),
            path: StringBuilder::new(),
            sha256: StringBuilder::new(),
            size_bytes: Int64Builder::new(),
            mime_type: StringBuilder::new(),
            created_by: StringBuilder::new(),
            retention_policy: StringBuilder::new(),
            cur_rows: 0,
            batches: Vec::new(),
        }
    }

    pub fn schema(&self) -> SchemaRef {
        self.schema.clone()
    }

    pub fn push(&mut self, row: &CanonicalArtifactRow) {
        self.artifact_id.append_value(&row.artifact_id);
        self.run_id.append_value(&row.run_id);
        self.kind.append_option(row.kind.as_deref());
        self.path.append_option(row.path.as_deref());
        self.sha256.append_option(row.sha256.as_deref());
        self.size_bytes.append_option(row.size_bytes);
        self.mime_type.append_option(row.mime_type.as_deref());
        self.created_by.append_option(row.created_by.as_deref());
        self.retention_policy.append_option(row.retention_policy.as_deref());
        self.cur_rows += 1;

        if self.cur_rows >= BATCH_SIZE {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
    }

    fn build_batch(&mut self) -> Option<RecordBatch> {
        if self.cur_rows == 0 {
            return None;
        }
        let batch = RecordBatch::try_new(
            self.schema.clone(),
            vec![
                Arc::new(self.artifact_id.finish()),
                Arc::new(self.run_id.finish()),
                Arc::new(self.kind.finish()),
                Arc::new(self.path.finish()),
                Arc::new(self.sha256.finish()),
                Arc::new(self.size_bytes.finish()),
                Arc::new(self.mime_type.finish()),
                Arc::new(self.created_by.finish()),
                Arc::new(self.retention_policy.finish()),
            ],
        )
        .ok();
        self.reset_internals();
        batch
    }

    fn reset_internals(&mut self) {
        self.artifact_id = StringBuilder::new();
        self.run_id = StringBuilder::new();
        self.kind = StringBuilder::new();
        self.path = StringBuilder::new();
        self.sha256 = StringBuilder::new();
        self.size_bytes = Int64Builder::new();
        self.mime_type = StringBuilder::new();
        self.created_by = StringBuilder::new();
        self.retention_policy = StringBuilder::new();
        self.cur_rows = 0;
    }

    /// Flush all accumulated batches including the current in-progress one.
    pub fn flush(&mut self) -> Vec<RecordBatch> {
        if self.cur_rows > 0 {
            let batch = self.build_batch();
            if let Some(b) = batch {
                self.batches.push(b);
            }
        }
        std::mem::take(&mut self.batches)
    }

    /// Write all accumulated batches to an Arrow IPC (Feather v2) file.
    pub fn write_to_file(&mut self, path: &str) -> std::io::Result<()> {
        let batches = self.flush();
        let file = std::fs::File::create(path)?;
        let mut writer =
            FileWriter::try_new(file, &self.schema).map_err(|e| io_error(e))?;
        for batch in &batches {
            writer.write(batch).map_err(|e| io_error(e))?;
        }
        writer.finish().map_err(|e| io_error(e))
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn io_error(e: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, format!("{}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_run_row(id: &str) -> CanonicalRunRow {
        CanonicalRunRow {
            run_id: id.to_string(),
            schema_version: "v4.0".into(),
            created_at: "2026-06-19T00:00:00Z".into(),
            tribunus_commit: Some("abc123".into()),
            repo_dirty: Some(false),
            runner_os: Some("macOS 15.5".into()),
            runner_kernel: Some("Darwin 25.5.0".into()),
            runner_hostname_hash: Some("aabbcc".into()),
            hardware_id: Some("hw-001".into()),
            model_id: Some("llama-3.2-3b".into()),
            model_revision: Some("v1".into()),
            quantization: Some("4bit".into()),
            workload_id: Some("opt-001".into()),
            backend_policy_id: Some("exp-001".into()),
            result_status: Some("completed".into()),
            artifact_uri: Some("ipfs://Qm...".into()),
        }
    }

    fn sample_hardware_row(id: &str) -> CanonicalHardwareRow {
        CanonicalHardwareRow {
            hardware_id: id.to_string(),
            soc: Some("Apple M1".into()),
            cpu_core_count: Some(8),
            gpu_core_count: Some(8),
            ram_gb: Some(16.0),
            os_version: Some("macOS 15.5".into()),
            mlx_version: Some("0.22.0".into()),
            coreml_version: None,
            thermal_mode: None,
            power_mode: None,
        }
    }

    fn sample_backend_row(oid: &str, rid: &str) -> CanonicalBackendRow {
        CanonicalBackendRow {
            observation_id: oid.to_string(),
            run_id: rid.to_string(),
            backend: Some("mlx_generic_gpu".into()),
            placement: Some("gpu".into()),
            compile_status: Some("completed".into()),
            load_status: Some("loaded".into()),
            predict_status: Some("success".into()),
            fallback_used: Some(false),
            fallback_reason: None,
            tokens_per_second: Some(45.2),
            ttft_ms: Some(150.0),
            p50_latency_ms: Some(22.1),
            p95_latency_ms: Some(35.0),
            p99_latency_ms: Some(45.0),
            peak_memory_mb: Some(2048.0),
            arena_residency_bytes: Some(1_500_000_000),
            numerical_max_abs_err: Some(0.001),
            cosine_similarity: Some(0.999),
            diagnostic_cluster: None,
        }
    }

    fn sample_compiler_row(mid: &str) -> CanonicalCompilerRow {
        CanonicalCompilerRow {
            manifest_id: mid.to_string(),
            graph_hash: Some("gh-abc".into()),
            phase_count: Some(4),
            op_families: Some(vec!["q_proj".into(), "k_proj".into(), "v_proj".into()]),
            shape_key: Some("64x8".into()),
            dtype_policy: Some("U8/Uint32".into()),
            kv_cache_policy: Some("frozen".into()),
            backend_eligibility: Some(vec!["mlx_generic_gpu".into()]),
            compile_cache_hit: Some(true),
            compile_timing_ms: Some(1200),
            terminal_failure_phase: None,
            compiler_diagnostics_hash: None,
        }
    }

    fn sample_artifact_row(aid: &str, rid: &str) -> CanonicalArtifactRow {
        CanonicalArtifactRow {
            artifact_id: aid.to_string(),
            run_id: rid.to_string(),
            kind: Some("receipt".into()),
            path: Some("/data/receipt.ndjson".into()),
            sha256: Some("deadbeef".into()),
            size_bytes: Some(1024),
            mime_type: Some("application/x-ndjson".into()),
            created_by: Some("tribunus-v0.1".into()),
            retention_policy: Some("standard".into()),
        }
    }

    // ── Runs builder tests ────────────────────────────────────────────────

    #[test]
    fn test_run_builder_single() {
        let mut builder = CanonicalRunBatchBuilder::new();
        builder.push(&sample_run_row("run-001"));
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
        assert!(builder.flush().is_empty());
    }

    #[test]
    fn test_run_builder_batch_size_trigger() {
        let mut builder = CanonicalRunBatchBuilder::new();
        for i in 0..BATCH_SIZE + 100 {
            builder.push(&sample_run_row(&format!("run-{:04}", i)));
        }
        let batches = builder.flush();
        assert!(batches.len() >= 2);
        let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
        assert_eq!(total_rows, BATCH_SIZE + 100);
    }

    #[test]
    fn test_run_builder_empty_flush() {
        let mut builder = CanonicalRunBatchBuilder::new();
        assert!(builder.flush().is_empty());
    }

    #[test]
    fn test_run_builder_optional_fields() {
        let mut builder = CanonicalRunBatchBuilder::new();
        builder.push(&CanonicalRunRow {
            run_id: "run-min".into(),
            schema_version: "v4.0".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            tribunus_commit: None,
            repo_dirty: None,
            runner_os: None,
            runner_kernel: None,
            runner_hostname_hash: None,
            hardware_id: None,
            model_id: None,
            model_revision: None,
            quantization: None,
            workload_id: None,
            backend_policy_id: None,
            result_status: None,
            artifact_uri: None,
        });
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    // ── Hardware builder tests ────────────────────────────────────────────

    #[test]
    fn test_hardware_builder_single() {
        let mut builder = CanonicalHardwareBatchBuilder::new();
        builder.push(&sample_hardware_row("hw-001"));
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    #[test]
    fn test_hardware_builder_batch_size() {
        let mut builder = CanonicalHardwareBatchBuilder::new();
        for i in 0..BATCH_SIZE + 50 {
            builder.push(&sample_hardware_row(&format!("hw-{:04}", i)));
        }
        let batches = builder.flush();
        let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
        assert_eq!(total_rows, BATCH_SIZE + 50);
    }

    // ── Backend builder tests ─────────────────────────────────────────────

    #[test]
    fn test_backend_builder_single() {
        let mut builder = CanonicalBackendBatchBuilder::new();
        builder.push(&sample_backend_row("obs-001", "run-001"));
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    #[test]
    fn test_backend_builder_null_optional() {
        let mut builder = CanonicalBackendBatchBuilder::new();
        builder.push(&CanonicalBackendRow {
            observation_id: "obs-min".into(),
            run_id: "run-min".into(),
            backend: None,
            placement: None,
            compile_status: None,
            load_status: None,
            predict_status: None,
            fallback_used: None,
            fallback_reason: None,
            tokens_per_second: None,
            ttft_ms: None,
            p50_latency_ms: None,
            p95_latency_ms: None,
            p99_latency_ms: None,
            peak_memory_mb: None,
            arena_residency_bytes: None,
            numerical_max_abs_err: None,
            cosine_similarity: None,
            diagnostic_cluster: None,
        });
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    // ── Compiler builder tests ────────────────────────────────────────────

    #[test]
    fn test_compiler_builder_single() {
        let mut builder = CanonicalCompilerBatchBuilder::new();
        builder.push(&sample_compiler_row("manifest-001"));
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    #[test]
    fn test_compiler_builder_null_string_lists() {
        let mut builder = CanonicalCompilerBatchBuilder::new();
        builder.push(&CanonicalCompilerRow {
            manifest_id: "man-min".into(),
            graph_hash: None,
            phase_count: None,
            op_families: None,
            shape_key: None,
            dtype_policy: None,
            kv_cache_policy: None,
            backend_eligibility: None,
            compile_cache_hit: None,
            compile_timing_ms: None,
            terminal_failure_phase: None,
            compiler_diagnostics_hash: None,
        });
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    #[test]
    fn test_compiler_builder_empty_string_lists() {
        let mut builder = CanonicalCompilerBatchBuilder::new();
        builder.push(&CanonicalCompilerRow {
            manifest_id: "man-empty".into(),
            graph_hash: Some("gh".into()),
            phase_count: Some(0),
            op_families: Some(Vec::new()),
            shape_key: None,
            dtype_policy: None,
            kv_cache_policy: None,
            backend_eligibility: Some(Vec::new()),
            compile_cache_hit: None,
            compile_timing_ms: None,
            terminal_failure_phase: None,
            compiler_diagnostics_hash: None,
        });
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    // ── Artifact builder tests ────────────────────────────────────────────

    #[test]
    fn test_artifact_builder_single() {
        let mut builder = CanonicalArtifactBatchBuilder::new();
        builder.push(&sample_artifact_row("art-001", "run-001"));
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    #[test]
    fn test_artifact_builder_optional_fields() {
        let mut builder = CanonicalArtifactBatchBuilder::new();
        builder.push(&CanonicalArtifactRow {
            artifact_id: "art-min".into(),
            run_id: "run-min".into(),
            kind: None,
            path: None,
            sha256: None,
            size_bytes: None,
            mime_type: None,
            created_by: None,
            retention_policy: None,
        });
        let batches = builder.flush();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    // ── IPC write test ────────────────────────────────────────────────────

    #[test]
    fn test_write_to_file_roundtrip() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_runs.arrow");
        let path_str = path.to_str().unwrap().to_string();

        {
            let mut builder = CanonicalRunBatchBuilder::new();
            builder.push(&sample_run_row("run-rt-001"));
            builder.push(&sample_run_row("run-rt-002"));
            builder.write_to_file(&path_str).unwrap();
        }

        // Read back with Arrow IPC reader
        let file = std::fs::File::open(&path).unwrap();
        let reader = arrow::ipc::reader::FileReader::try_new(file, None).unwrap();
        let batches: Vec<_> = reader.collect::<Result<Vec<_>, _>>().unwrap();
        assert!(!batches.is_empty());
        let total: usize = batches.iter().map(|b| b.num_rows()).sum();
        assert_eq!(total, 2);

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn test_write_to_file_empty() {
        let dir = std::env::temp_dir();
        let path = dir.join("test_empty.arrow");
        let path_str = path.to_str().unwrap().to_string();

        {
            let mut builder = CanonicalHardwareBatchBuilder::new();
            builder.write_to_file(&path_str).unwrap();
        }

        let file = std::fs::File::open(&path).unwrap();
        let reader = arrow::ipc::reader::FileReader::try_new(file, None).unwrap();
        let batches: Vec<_> = reader.collect::<Result<Vec<_>, _>>().unwrap();
        assert!(batches.is_empty());

        std::fs::remove_file(&path).unwrap();
    }
}
