use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::graph_catalog::identity_baseline_family_name;
use super::lattice::COVERAGE_LATTICE_SCHEMA_VERSION;
use super::lattice_validation::{validate_lattice, LatticeValidationReceipt};
use super::receipt::DecodeAttributionReceipt;

/// Matrix summary for the report.
#[derive(Debug, Clone, Serialize)]
pub struct MatrixSummary {
    pub runs: usize,
    pub passed: usize,
    pub failed: usize,
}

/// Key finding in the report.
#[derive(Debug, Clone, Serialize)]
pub struct KeyFinding {
    pub question: String,
    pub answer: String,
    pub data: serde_json::Value,
}

/// Exclusion entry.
#[derive(Debug, Clone, Serialize)]
pub struct BaselineExclusion {
    pub graph_family: String,
    pub reason: String,
}

/// Failure entry.
#[derive(Debug, Clone, Serialize)]
pub struct FailureEntry {
    pub graph_family: String,
    pub shape_profile: String,
    pub runtime_compute_units: String,
    pub reason: String,
}

/// Decode attribution rollup report.
#[derive(Debug, Clone, Serialize)]
pub struct DecodeAttributionReport {
    pub report_id: String,
    pub generated_at: String,
    pub commit_sha: String,
    pub schema_version: String,
    pub percentile_method: String,
    pub host: HostInfo,
    pub config: ReportConfig,
    pub matrices: BTreeMap<String, MatrixSummary>,
    pub key_findings: Vec<KeyFinding>,
    pub baseline_exclusions: Vec<BaselineExclusion>,
    pub failures: Vec<FailureEntry>,
    pub backend_support_matrix: BTreeMap<String, Vec<String>>,
    pub break_even_analysis: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostInfo {
    pub chip: String,
    pub macos: String,
    pub xcode: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportConfig {
    pub warmup_iterations: u32,
    pub steady_iterations: u32,
    pub tolerance: f64,
}

/// Generate a rollup report from collected receipts.
pub fn generate_report(
    report_id: &str,
    matrix_receipts: Vec<(&'static str, Vec<DecodeAttributionReceipt>)>,
    warmup_iters: u32,
    steady_iters: u32,
    tolerance: f64,
) -> DecodeAttributionReport {
    let ts = iso_timestamp();

    let mut matrices = BTreeMap::new();
    let mut failures = Vec::new();
    let mut backend_support_matrix: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut host_info = HostInfo {
        chip: "unknown".into(),
        macos: "unknown".into(),
        xcode: "unknown".into(),
    };

    for (name, receipts) in &matrix_receipts {
        let total = receipts.len();
        let passed = receipts.iter().filter(|r| r.status == "pass").count();
        let failed = total - passed;
        matrices.insert(
            name.to_string(),
            MatrixSummary {
                runs: total,
                passed,
                failed,
            },
        );

        // Extract host info from first receipt
        if let Some(first) = receipts.first() {
            if host_info.chip == "unknown" {
                host_info = HostInfo {
                    chip: first.host_chip.clone(),
                    macos: first.macos_version.clone(),
                    xcode: first.xcode_version.clone(),
                };
            }
        }

        // Collect failures
        for r in receipts {
            if r.status != "pass" {
                failures.push(FailureEntry {
                    graph_family: r.graph_family.clone(),
                    shape_profile: r.shape_profile.clone(),
                    runtime_compute_units: r.runtime_compute_units.clone(),
                    reason: r.failure_reason.clone().unwrap_or_default(),
                });
            }
            // Build backend support matrix
            let key = format!("{}/{}", r.backend, r.graph_family);
            backend_support_matrix
                .entry(key)
                .or_default()
                .push(r.backend_support_status.clone());
        }
    }

    let commit = matrix_receipts
        .first()
        .and_then(|(_, rs)| rs.first())
        .map(|r| r.commit_sha.clone())
        .unwrap_or_default();

    DecodeAttributionReport {
        report_id: report_id.to_string(),
        generated_at: ts,
        commit_sha: commit,
        schema_version: "decode-attribution.v1".to_string(),
        percentile_method: "nearest_rank".to_string(),
        host: host_info,
        config: ReportConfig {
            warmup_iterations: warmup_iters,
            steady_iterations: steady_iters,
            tolerance,
        },
        matrices,
        backend_support_matrix,
        break_even_analysis: generate_break_even(&matrix_receipts),
        key_findings: generate_key_findings(&matrix_receipts),
        baseline_exclusions: vec![BaselineExclusion {
            graph_family: identity_baseline_family_name().to_string(),
            reason: "bridge/load/predict overhead baseline; excluded from scaling conclusions"
                .into(),
        }],
        failures,
    }
}

/// Generate key findings from collected receipts.
fn generate_key_findings(
    matrix_receipts: &[(&'static str, Vec<DecodeAttributionReceipt>)],
) -> Vec<KeyFinding> {
    let mut findings = Vec::new();

    // Collect all matmul rows across backends
    let mut matmul_rows: Vec<&DecodeAttributionReceipt> = Vec::new();
    for (_, receipts) in matrix_receipts {
        for r in receipts {
            if r.graph_family == "matmul" && r.status == "pass" && r.steady_p50_ns > 0 {
                matmul_rows.push(r);
            }
        }
    }

    if !matmul_rows.is_empty() {
        // Group by backend
        use std::collections::BTreeMap;
        let mut by_backend: BTreeMap<String, Vec<serde_json::Value>> = BTreeMap::new();
        for r in &matmul_rows {
            let entry = serde_json::json!({
                "shape": r.shape_profile,
                "cold_ns": r.cold_first_predict_ns,
                "steady_p50_ns": r.steady_p50_ns,
                "compile_duration_ns": r.compile_duration_ns,
                "load_duration_ns": r.load_duration_ns,
            });
            by_backend.entry(r.backend.clone()).or_default().push(entry);
        }
        findings.push(KeyFinding {
            question: "steady_state_latency_by_backend".into(),
            answer: format!("{} backends produced matmul data", by_backend.len()),
            data: serde_json::to_value(by_backend).unwrap_or_default(),
        });
    }

    findings
}

/// Generate break-even analysis from matrix_a receipts.
fn generate_break_even(
    matrix_receipts: &[(&'static str, Vec<DecodeAttributionReceipt>)],
) -> Vec<serde_json::Value> {
    let mut results = Vec::new();

    // Find matrix_a rows
    let mut coreml_rows: Vec<&DecodeAttributionReceipt> = Vec::new();
    let mut direct_rows: Vec<&DecodeAttributionReceipt> = Vec::new();

    for (name, receipts) in matrix_receipts {
        if *name != "matrix_a" {
            continue;
        }
        for r in receipts {
            if r.status != "pass" || r.steady_p50_ns == 0 {
                continue;
            }
            match r.backend.as_str() {
                "coreml" => coreml_rows.push(r),
                "accelerate" | "mlx" => direct_rows.push(r),
                _ => {}
            }
        }
    }

    for cm in &coreml_rows {
        for d in &direct_rows {
            if cm.shape_profile != d.shape_profile {
                continue;
            }
            let lifecycle_tax =
                cm.materialize_duration_ns + cm.compile_duration_ns + cm.load_duration_ns;
            let prepare_tax = d.backend_prepare_duration_ns;
            let cm_steady = cm.steady_p50_ns;
            let d_steady = d.steady_p50_ns;

            let numerator = (lifecycle_tax as i64) - (prepare_tax as i64);
            let denominator = (d_steady as i64) - (cm_steady as i64);

            let break_even = if numerator <= 0 {
                "coreml_ahead_at_n0".to_string()
            } else if denominator <= 0 {
                "no_break_even".to_string()
            } else {
                let be = (numerator as f64 / denominator as f64).ceil() as u64;
                format!("{}", be)
            };

            results.push(serde_json::json!({
                "shape": cm.shape_profile,
                "coreml_backend": cm.backend_runtime_policy,
                "direct_backend": d.backend,
                "coreml_lifecycle_tax_ns": lifecycle_tax,
                "direct_prepare_tax_ns": prepare_tax,
                "coreml_steady_p50_ns": cm_steady,
                "direct_steady_p50_ns": d_steady,
                "break_even_iterations": break_even,
            }));
        }
    }

    results
}
fn iso_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let h = time_secs / 3600;
    let m = (time_secs % 3600) / 60;
    let s = time_secs % 60;
    let y400 = days / 146097;
    let d400 = days % 146097;
    let y100 = d400 / 36524;
    let d100 = d400 % 36524;
    let y4 = d100 / 1461;
    let d4 = d100 % 1461;
    let y1 = d4 / 365;
    let d1 = d4 % 365;
    let y = 1970 + (y400 * 400 + y100 * 100 + y4 * 4 + y1) as u16;
    let leap = if y1 > 0 && (y1 % 4 == 0) { 1 } else { 0 };
    let doy = (d1 + 1) as u16;
    let months_days: [u16; 12] = [31, 28 + leap, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut accum = 0u16;
    let mut month = 1u16;
    for (i, &md) in months_days.iter().enumerate() {
        if doy <= accum + md {
            month = (i + 1) as u16;
            break;
        }
        accum += md;
    }
    let day = doy - accum;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, month, day, h, m, s
    )
}

// ── Coverage Lattice ────────────────────────────────────────────────────────

/// A single row in the coverage lattice.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageLatticeRow {
    pub run_id: String,
    pub commit_sha: String,
    pub dirty_tree: bool,
    pub backend: String,
    pub graph_family: String,
    pub shape_profile: String,
    pub runtime_policy: String,
    pub lattice_cell_id: String,
    pub support_tier: String,
    pub predict_status: String,
    pub predict_failure_classification: String,
    pub max_absolute_error: f64,
    pub steady_p50_ns: u64,
    pub materialize_duration_ns: u64,
    pub compile_duration_ns: u64,
    pub load_duration_ns: u64,
    pub cold_first_predict_ns: u64,
    pub reference_output_hashes_populated: bool,
    pub reference_status: String,
    pub terminal_phase: String,
    pub backend_support_status: String,
    pub materialize_status: String,
    pub compile_status: String,
    pub load_status: String,
    pub reference_output_hashes: Vec<String>,
    pub backend_output_hashes: Vec<String>,
    pub matches_tolerance: bool,
    pub execution_proof_summary: String,
    pub execution_proof_cpu_glue_ops: Vec<String>,
    pub mlx_compile_attempted: bool,
}

/// The full coverage lattice artifact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageLattice {
    pub run_id: String,
    pub commit_sha: String,
    pub dirty_tree: bool,
    pub repo_dirty_tree_global: bool,
    pub compute_dirty_tree: bool,
    pub dependency_scope_dirty: bool,
    pub provenance: String,       // "clean", "tainted", or "dependency_dirty"
    pub provenance_scope: String, // "compute-native"
    pub dirty_paths_sample: Vec<String>,
    pub schema_version: String,
    pub generated_at: String,
    pub total_rows: usize,
    pub rows: Vec<CoverageLatticeRow>,
    pub validation: LatticeValidationReceipt,
}

/// Generate a coverage lattice JSON artifact from a collection of receipts.
///
/// Validates:
/// - All receipts share the same `run_id` and `commit_sha`
/// - Rejects empty or mixed-provenance inputs
/// - Provenance is computed from three scoped flags
pub fn generate_coverage_json(
    run_id: &str,
    repo_dirty: bool,
    compute_dirty: bool,
    dep_dirty: bool,
    dirty_paths: Vec<String>,
    receipts: &[DecodeAttributionReceipt],
) -> CoverageLattice {
    let ts = iso_timestamp();

    let validation = validate_lattice(run_id, receipts);

    let commit_sha = receipts
        .first()
        .map(|r| r.commit_sha.clone())
        .unwrap_or_default();

    let provenance = if compute_dirty || dep_dirty {
        "tainted".to_string()
    } else {
        "clean".to_string()
    };
    let provenance_scope = "compute-native".to_string();

    let rows: Vec<CoverageLatticeRow> = receipts
        .iter()
        .map(|r| CoverageLatticeRow {
            run_id: r.run_id.clone(),
            commit_sha: r.commit_sha.clone(),
            dirty_tree: repo_dirty,
            backend: r.backend.clone(),
            graph_family: r.graph_family.clone(),
            shape_profile: r.shape_profile.clone(),
            runtime_policy: r.backend_runtime_policy.clone(),
            lattice_cell_id: r.lattice_cell_id.clone(),
            support_tier: r.support_tier.clone(),
            predict_status: r.predict_status.clone(),
            predict_failure_classification: r.predict_failure_classification.clone(),
            max_absolute_error: r.max_absolute_error,
            steady_p50_ns: r.steady_p50_ns,
            materialize_duration_ns: r.materialize_duration_ns,
            compile_duration_ns: r.compile_duration_ns,
            load_duration_ns: r.load_duration_ns,
            cold_first_predict_ns: r.cold_first_predict_ns,
            reference_output_hashes_populated: r.reference_output_hashes_populated,
            reference_status: r.reference_status.clone(),
            terminal_phase: if r.terminal_phase.is_empty() {
                r.pipeline_phase
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string())
            } else {
                r.terminal_phase.clone()
            },
            backend_support_status: r.backend_support_status.clone(),
            materialize_status: r.materialize_status.clone(),
            compile_status: r.compile_status.clone(),
            load_status: r.load_status.clone(),
            reference_output_hashes: r.reference_output_hashes.clone(),
            backend_output_hashes: r.cold_output_hashes.clone(),
            matches_tolerance: r.matches_tolerance,
            execution_proof_summary: r.execution_proof.notes.clone().unwrap_or_default(),
            execution_proof_cpu_glue_ops: r.execution_proof.cpu_glue_ops.clone(),
            mlx_compile_attempted: r.mlx_compile_attempted,
        })
        .collect();

    let total_rows = rows.len();

    CoverageLattice {
        run_id: run_id.to_string(),
        commit_sha,
        dirty_tree: repo_dirty,
        repo_dirty_tree_global: repo_dirty,
        compute_dirty_tree: compute_dirty,
        dependency_scope_dirty: dep_dirty,
        provenance,
        provenance_scope,
        dirty_paths_sample: dirty_paths,
        schema_version: COVERAGE_LATTICE_SCHEMA_VERSION.to_string(),
        generated_at: ts,
        total_rows,
        rows,
        validation,
    }
}

/// Generate a human-readable coverage table from the lattice.
pub fn generate_coverage_table(lattice: &CoverageLattice) -> String {
    let mut lines = Vec::new();
    lines.push(format!("Coverage Lattice: run_id={} commit={} compute_dirty={} dep_dirty={} global_dirty={} provenance={} scope={} rows={}",
        lattice.run_id, lattice.commit_sha, lattice.compute_dirty_tree, lattice.dependency_scope_dirty, lattice.repo_dirty_tree_global, lattice.provenance, lattice.provenance_scope, lattice.total_rows));
    lines.push(String::new());
    lines.push(format!(
        "{:<22} {:<12} {:<12} {:<18} {:<18} {:<14} ref_hashes",
        "Graph", "Shape", "Backend", "SupportTier", "PredictStatus", "P50(ns)"
    ));
    lines.push("-".repeat(100));

    let mut sorted = lattice.rows.clone();
    sorted.sort_by(|a, b| {
        a.backend
            .cmp(&b.backend)
            .then(a.graph_family.cmp(&b.graph_family))
            .then(a.shape_profile.cmp(&b.shape_profile))
    });

    for row in &sorted {
        let support_tier = if row.support_tier.is_empty() {
            "unknown"
        } else {
            row.support_tier.as_str()
        };
        let predict_status = if row.predict_status.is_empty() {
            "not_run"
        } else {
            row.predict_status.as_str()
        };
        let p50 = if matches!(row.predict_status.as_str(), "pass" | "passed") {
            format!("{}", row.steady_p50_ns)
        } else {
            "-".to_string()
        };
        lines.push(format!(
            "{:<22} {:<12} {:<12} {:<18} {:<18} {:<14} {}",
            row.graph_family,
            row.shape_profile,
            row.backend,
            support_tier,
            predict_status,
            p50,
            row.reference_output_hashes_populated,
        ));
    }

    lines.push(String::new());
    lines.push(format!(
        "Validation: schema={} passed={} expected={} observed={} unique={} missing={} duplicates={} invalid={} aggregate_exclusions={}",
        lattice.validation.schema_version,
        lattice.validation.passed,
        lattice.validation.expected_cell_count,
        lattice.validation.observed_row_count,
        lattice.validation.unique_cell_count,
        lattice.validation.missing_cells.len(),
        lattice.validation.duplicate_cells.len(),
        lattice.validation.invalid_cells.len(),
        lattice.validation.aggregate_exclusions.len(),
    ));
    lines.push(String::new());
    let elig = if lattice.provenance == "clean" {
        "eligible for optimization decisions"
    } else {
        "NOT eligible"
    };
    lines.push(format!("Provenance: {} — {}", lattice.provenance, elig));
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_validation(run_id: &str, rows: usize) -> LatticeValidationReceipt {
        LatticeValidationReceipt {
            schema_version: "coverage-lattice.validation.v2".to_string(),
            validator_version: "coverage-lattice-validator.v2".to_string(),
            run_id: run_id.to_string(),
            passed: true,
            observed_row_count: rows,
            expected_cell_count: rows,
            unique_cell_count: rows,
            missing_cells: vec![],
            duplicate_cells: vec![],
            invalid_cells: vec![],
            aggregate_input_summary: super::super::lattice_validation::AggregateInputSummary {
                valid_rows: rows,
                included_rows: rows.saturating_sub(1),
                excluded_rows: 1,
            },
            aggregate_exclusions: vec![super::super::lattice_validation::AggregateExclusion {
                row_index: 1,
                lattice_cell_id: "coverage-lattice.v2/coreml/matmul/medium/cpuOnly".to_string(),
                reason: "identity_passthrough".to_string(),
                detail: "identity rows are excluded from latency aggregates".to_string(),
            }],
        }
    }

    fn dummy_row(run_id: &str, lattice_cell_id: &str, predict_status: &str) -> CoverageLatticeRow {
        CoverageLatticeRow {
            run_id: run_id.to_string(),
            commit_sha: "commit-sha-1".to_string(),
            dirty_tree: false,
            backend: if lattice_cell_id.contains("mlx") {
                "mlx".to_string()
            } else {
                "coreml".to_string()
            },
            graph_family: if lattice_cell_id.contains("identity") {
                "identity_passthrough".to_string()
            } else {
                "matmul".to_string()
            },
            shape_profile: "small".to_string(),
            runtime_policy: if lattice_cell_id.contains("mlx") {
                "mlx_default".to_string()
            } else {
                "cpuOnly".to_string()
            },
            lattice_cell_id: lattice_cell_id.to_string(),
            support_tier: if predict_status == "skipped_by_support" {
                "unsupported_graph".to_string()
            } else {
                "supported_native".to_string()
            },
            predict_status: predict_status.to_string(),
            predict_failure_classification: if predict_status == "pass" {
                String::new()
            } else {
                predict_status.to_string()
            },
            max_absolute_error: 0.0,
            steady_p50_ns: if predict_status == "pass" { 10 } else { 0 },
            materialize_duration_ns: 1,
            compile_duration_ns: 1,
            load_duration_ns: 1,
            cold_first_predict_ns: 1,
            reference_output_hashes_populated: true,
            reference_status: "pass".to_string(),
            terminal_phase: "complete".to_string(),
            backend_support_status: "supported".to_string(),
            materialize_status: "pass".to_string(),
            compile_status: "pass".to_string(),
            load_status: "pass".to_string(),
            reference_output_hashes: vec!["hash1".to_string()],
            backend_output_hashes: vec!["hash1".to_string()],
            matches_tolerance: true,
            execution_proof_summary: "execution proof".to_string(),
            execution_proof_cpu_glue_ops: vec![],
            mlx_compile_attempted: false,
        }
    }

    #[test]
    fn coverage_lattice_round_trip_preserves_validation() {
        let run_id = "DA-ROUNDTRIP-0001";
        let lattice = CoverageLattice {
            run_id: run_id.to_string(),
            commit_sha: "commit-sha-1".to_string(),
            dirty_tree: false,
            repo_dirty_tree_global: false,
            compute_dirty_tree: false,
            dependency_scope_dirty: false,
            provenance: "clean".to_string(),
            provenance_scope: "compute-native".to_string(),
            dirty_paths_sample: vec![],
            schema_version: COVERAGE_LATTICE_SCHEMA_VERSION.to_string(),
            generated_at: "2026-06-13T00:00:00Z".to_string(),
            total_rows: 2,
            rows: vec![
                dummy_row(
                    run_id,
                    "coverage-lattice.v2/coreml/matmul/small/cpuOnly",
                    "pass",
                ),
                dummy_row(
                    run_id,
                    "coverage-lattice.v2/mlx/identity_passthrough/small/mlx_default",
                    "skipped_by_support",
                ),
            ],
            validation: dummy_validation(run_id, 2),
        };

        let json = serde_json::to_string(&lattice).expect("serialize coverage lattice");
        assert!(json.contains("\"validation\""));

        let round_trip: CoverageLattice = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(round_trip.run_id, lattice.run_id);
        assert_eq!(round_trip.rows.len(), 2);
        assert_eq!(round_trip.validation.observed_row_count, 2);
        assert_eq!(round_trip.validation.aggregate_exclusions.len(), 1);
        assert_eq!(
            round_trip.validation.aggregate_input_summary.excluded_rows,
            1
        );
    }
}
