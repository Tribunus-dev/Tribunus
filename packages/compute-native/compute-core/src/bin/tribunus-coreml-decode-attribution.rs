//! Tribunus Core ML Decode Attribution Harness.
//!
//! Measures materialization, compilation, load, warmup, and prediction
//! timing across two primary matrices and one optional matrix.
//!
//! Usage:
//!   cargo run --bin tribunus-coreml-decode-attribution --profile inference-evidence
//!   cargo run --bin tribunus-coreml-decode-attribution --profile inference-evidence -- --include-gpu-shape-matrix
//!   cargo run --bin tribunus-coreml-decode-attribution --profile inference-evidence -- --full-catalog --run-id LATTICE-0001
//!
//! Output: JSONL receipts in decode_attribution_runs/ plus rollup report.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;

use tribunus_compute_native::decode_attribution::matrices::{
    run_matrix1, run_matrix2, run_matrix2b, run_matrix_a, run_matrix_lattice,
    run_negative_evidence_fixture, RunConfig,
};
use tribunus_compute_native::decode_attribution::graph_catalog::{
    canonical_family_name, identity_baseline_family_name,
};
use tribunus_compute_native::decode_attribution::lattice::{
    expected_lattice_cells, parse_lattice_cell_id, LatticeCellKey,
};
use tribunus_compute_native::decode_attribution::lattice_validation::{
    AggregateExclusion, AggregateInputSummary, DuplicateCellReport, InvalidCellReport,
    LatticeValidationReceipt,
};
use tribunus_compute_native::decode_attribution::report::{
    CoverageLattice, CoverageLatticeRow, generate_coverage_json, generate_coverage_table,
    generate_report,
};

const DEFAULT_WARMUP: u32 = 10;
const DEFAULT_STEADY: u32 = 100;
const DEFAULT_TOLERANCE: f64 = 1e-4;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let include_gpu = args.contains(&"--include-gpu-shape-matrix".to_string());
    let full_catalog = args.contains(&"--full-catalog".to_string());
    let authority_mode = args.contains(&"--authority-mode".to_string());
    let validate_coverage_lattice = args
        .iter()
        .position(|a| a == "--validate-coverage-lattice")
        .and_then(|i| args.get(i + 1))
        .cloned();

    // Parse --run-id if provided.
    let custom_run_id = args
        .iter()
        .position(|a| a == "--run-id")
        .and_then(|i| args.get(i + 1))
        .cloned();

    // Check dirty-tree state.
    let (repo_dirty, compute_dirty, dep_dirty, sample_paths) = check_provenance();

    let run_id = custom_run_id.unwrap_or_else(|| {
        format!("DA-{:04}-{:06}", 1, {
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                % 1_000_000
        })
    });

    let output_dir = format!("decode_attribution_runs/{}", run_id);
    fs::create_dir_all(&output_dir).expect("create output dir");

    let config = RunConfig {
        run_id: run_id.clone(),
        output_dir: output_dir.clone(),
        warmup_iterations: DEFAULT_WARMUP,
        steady_iterations: DEFAULT_STEADY,
        tolerance: DEFAULT_TOLERANCE,
    };

    eprintln!("=== Decode Attribution Data Collection Gate ===");
    eprintln!("Run ID: {}", run_id);
    eprintln!("Output: {}", output_dir);
    eprintln!(
        "Dirty tree: global={} compute={} dep={}",
        repo_dirty, compute_dirty, dep_dirty
    );
    eprintln!(
        "Warmup: {} iters, Steady: {} iters",
        DEFAULT_WARMUP, DEFAULT_STEADY
    );
    eprintln!("");

    if let Some(path) = validate_coverage_lattice {
        let (coverage, validation) = match validate_coverage_lattice_file(&path) {
            Ok(res) => res,
            Err(e) => {
                eprintln!("coverage lattice validation failed: {}", e);
                if authority_mode {
                    std::process::exit(2);
                } else {
                    return;
                }
            }
        };
        if validation.passed {
            eprintln!(
                "coverage lattice validation passed: schema={} expected={} observed={} unique={} missing={} duplicates={} invalid={} aggregate_exclusions={}",
                coverage.schema_version,
                validation.expected_cell_count,
                validation.observed_row_count,
                validation.unique_cell_count,
                validation.missing_cells.len(),
                validation.duplicate_cells.len(),
                validation.invalid_cells.len(),
                validation.aggregate_exclusions.len(),
            );
        } else {
            eprintln!(
                "coverage lattice validation failed: schema={} expected={} observed={} unique={} missing={} duplicates={} invalid={}",
                coverage.schema_version,
                validation.expected_cell_count,
                validation.observed_row_count,
                validation.unique_cell_count,
                validation.missing_cells.len(),
                validation.duplicate_cells.len(),
                validation.invalid_cells.len(),
            );
            if authority_mode {
                std::process::exit(2);
            }
        }
        return;
    }

    // ── Full Catalog Lattice Run (if requested) ──
    if full_catalog {
        eprintln!("=== Full Catalog Lattice Run ===");
        let lattice = run_matrix_lattice(&config);
        eprintln!("  {} total rows", lattice.len());

        // Validate row count expectation: 48 Core ML + 24 MLX + 24 Accelerate = 96
        let coreml_count = lattice.iter().filter(|r| r.backend == "coreml").count();
        let mlx_count = lattice.iter().filter(|r| r.backend == "mlx").count();
        let accel_count = lattice.iter().filter(|r| r.backend == "accelerate").count();
        eprintln!("  Core ML: {} rows", coreml_count);
        eprintln!("  MLX: {} rows", mlx_count);
        eprintln!("  Accelerate: {} rows", accel_count);

        // Write lattice rows as JSONL
        write_jsonl(&output_dir, "matrix_lattice", &lattice);

        // Generate coverage lattice JSON artifact
        let generated_coverage = generate_coverage_json(
            &run_id,
            repo_dirty,
            compute_dirty,
            dep_dirty,
            sample_paths,
            &lattice,
        );
        let coverage_path = format!("{}/coverage-lattice.json", output_dir);
        let coverage_json = serde_json::to_string_pretty(&generated_coverage).expect("serialize coverage");
        let mut cf = fs::File::create(&coverage_path).expect("create coverage file");
        cf.write_all(coverage_json.as_bytes())
            .expect("write coverage");
        eprintln!("  Coverage JSON: {}", coverage_path);

        let (coverage, validation) = match validate_coverage_lattice_file(&coverage_path) {
            Ok(res) => res,
            Err(e) => {
                eprintln!("coverage lattice validation failed: artifact corruption detected: {}", e);
                if authority_mode {
                    std::process::exit(2);
                } else {
                    // Fallback to in-memory summary if disk reread fails for some reason
                    (generated_coverage.clone(), generated_coverage.validation.clone())
                }
            }
        };

        if validation.passed {
            eprintln!(
                "coverage lattice validation passed: schema={} expected={} observed={} unique={} missing={} duplicates={} invalid={} aggregate_exclusions={}",
                coverage.schema_version,
                validation.expected_cell_count,
                validation.observed_row_count,
                validation.unique_cell_count,
                validation.missing_cells.len(),
                validation.duplicate_cells.len(),
                validation.invalid_cells.len(),
                validation.aggregate_exclusions.len(),
            );
        } else {
            eprintln!(
                "coverage lattice validation failed: schema={} expected={} observed={} unique={} missing={} duplicates={} invalid={}",
                coverage.schema_version,
                validation.expected_cell_count,
                validation.observed_row_count,
                validation.unique_cell_count,
                validation.missing_cells.len(),
                validation.duplicate_cells.len(),
                validation.invalid_cells.len(),
            );
            if authority_mode {
                std::process::exit(2);
            }
        }

        // Print human-readable coverage table
        eprintln!("");
        eprintln!("Coverage Table:");
        let table = generate_coverage_table(&coverage);
        eprintln!("{}", table);

        // Do not run standard matrices when --full-catalog is specified.
        eprintln!("");
        eprintln!("=== Coverage Lattice Gate Complete ===");
        eprintln!("Rows: {}", lattice.len());
        eprintln!("Coverage: {}", coverage_path);
        return;
    }

    // ── Matrix 1: Compute Unit × Graph Family ──
    eprintln!("--- Matrix 1: Compute Unit × Graph Family ---");
    let m1 = run_matrix1(&config);
    eprintln!(
        "  {} runs ({} pass, {} fail)",
        m1.len(),
        m1.iter().filter(|r| r.status == "pass").count(),
        m1.iter().filter(|r| r.status != "pass").count()
    );
    write_jsonl(&output_dir, "matrix1", &m1);

    // ── Matrix 2: Shape × Graph Family (CPU-only) ──
    eprintln!("--- Matrix 2: Shape × Graph Family (CPU-only) ---");
    let m2 = run_matrix2(&config);
    eprintln!(
        "  {} runs ({} pass, {} fail)",
        m2.len(),
        m2.iter().filter(|r| r.status == "pass").count(),
        m2.iter().filter(|r| r.status != "pass").count()
    );
    write_jsonl(&output_dir, "matrix2", &m2);

    // ── Negative evidence ──
    eprintln!("--- Negative Evidence Fixture ---");
    let neg = run_negative_evidence_fixture(&config);
    eprintln!("  status: {}", neg.status);
    write_jsonl(&output_dir, "negative_evidence", &[neg.clone()]);

    // ── Matrix A: Three-way matmul baseline ──
    eprintln!("--- Matrix A: Three-way matmul baseline ---");
    let ma = run_matrix_a(&config);
    eprintln!(
        "  {} runs ({} pass, {} fail)",
        ma.len(),
        ma.iter().filter(|r| r.status == "pass").count(),
        ma.iter().filter(|r| r.status != "pass").count()
    );
    write_jsonl(&output_dir, "matrix_a", &ma);

    // ── Matrix 2b: Shape × Graph Family (GPU, optional) ──
    let mut m2b = Vec::new();
    if include_gpu {
        eprintln!("--- Matrix 2b: Shape × Graph Family (GPU) ---");
        m2b = run_matrix2b(&config);
        eprintln!(
            "  {} runs ({} pass, {} fail)",
            m2b.len(),
            m2b.iter().filter(|r| r.status == "pass").count(),
            m2b.iter().filter(|r| r.status != "pass").count()
        );
        write_jsonl(&output_dir, "matrix2b", &m2b);
    } else {
        eprintln!("--- Matrix 2b: SKIPPED (pass --include-gpu-shape-matrix to enable) ---");
    }

    // ── Report ──
    eprintln!("--- Generating Report ---");
    let mut all_matrices = vec![
        ("matrix_a", ma),
        ("matrix1_compute_units", m1),
        ("matrix2_shape_scaling_cpu", m2),
    ];

    if include_gpu {
        all_matrices.push(("matrix2b_shape_scaling_gpu", m2b));
    }
    all_matrices.push(("negative_evidence", vec![neg]));

    let report = generate_report(
        &run_id,
        all_matrices.iter().map(|(n, r)| (*n, r.clone())).collect(),
        DEFAULT_WARMUP,
        DEFAULT_STEADY,
        DEFAULT_TOLERANCE,
    );

    let report_path = format!("{}/decode_attribution_report.json", output_dir);
    let report_json = serde_json::to_string_pretty(&report).expect("serialize report");
    let mut f = fs::File::create(&report_path).expect("create report file");
    f.write_all(report_json.as_bytes()).expect("write report");
    eprintln!("  Report: {}", report_path);

    eprintln!("");
    eprintln!("=== Decode Attribution Gate Complete ===");
    eprintln!("Receipts: {}/", output_dir);
    eprintln!("Report:  {}", report_path);
}

fn write_jsonl(
    dir: &str,
    name: &str,
    receipts: &[tribunus_compute_native::decode_attribution::receipt::DecodeAttributionReceipt],
) {
    let path = format!("{}/{}.jsonl", dir, name);
    let mut f = fs::File::create(&path).expect("create jsonl file");
    for r in receipts {
        let line = serde_json::to_string(r).expect("serialize receipt");
        writeln!(f, "{}", line).expect("write jsonl line");
    }
    eprintln!("  JSONL: {}", path);
}

/// Check provenance across three scopes.
/// Returns (global_dirty, compute_dirty, dep_dirty, dirty_paths_sample).
fn check_provenance() -> (bool, bool, bool, Vec<String>) {
    use std::process::Command;

    fn run_git(args: &[&str]) -> (String, bool) {
        match Command::new("git").args(args).output() {
            Ok(out) => (
                String::from_utf8_lossy(&out.stdout).trim().to_string(),
                false,
            ),
            Err(_) => (String::new(), true),
        }
    }

    let (global_out, _) = run_git(&["status", "--porcelain"]);
    let (compute_out, compute_err) =
        run_git(&["status", "--porcelain", "--", "packages/compute-native/"]);
    let (dep_out, dep_err) = run_git(&[
        "status",
        "--porcelain",
        "--",
        "Cargo.toml",
        "Cargo.lock",
        ".cargo/",
        "rust-toolchain",
        "rust-toolchain.toml",
        "build.rs",
    ]);

    let repo_dirty = !global_out.is_empty();
    let compute_dirty = !compute_out.is_empty();
    let dep_dirty = !dep_out.is_empty();

    let mut sample: Vec<String> = Vec::new();
    for line in global_out.lines().take(10) {
        sample.push(line.to_string());
    }

    if compute_err || dep_err {
        eprintln!("  [warn] could not check scoped git status; assuming dirty");
        return (true, true, true, sample);
    }

    (repo_dirty, compute_dirty, dep_dirty, sample)
}

const COVERAGE_PASS_STATUSES: &[&str] = &["pass", "passed"];
const COVERAGE_SUPPORT_TIERS: &[&str] = &[
    "supported_native",
    "supported_composed",
    "unsupported_graph",
    "not_implemented",
];
const COVERAGE_PREDICT_STATUSES: &[&str] = &[
    "pass",
    "passed",
    "skipped_by_support",
    "skipped_by_policy",
    "not_attempted",
    "materialize_limited",
    "compile_limited",
    "load_blocked",
    "predict_blocked",
    "numerical_divergence",
    "timeout",
    "memory_oom",
];
const COVERAGE_PREDICT_FAILURE_CLASSES: &[&str] = &[
    "skipped_by_support",
    "skipped_by_policy",
    "not_attempted",
    "materialize_limited",
    "compile_limited",
    "load_blocked",
    "predict_blocked",
    "numerical_divergence",
    "timeout",
    "memory_oom",
];

fn is_coverage_pass_status(status: &str) -> bool {
    COVERAGE_PASS_STATUSES.contains(&status)
}

fn validate_coverage_lattice_file(path: &str) -> Result<(CoverageLattice, LatticeValidationReceipt), String> {
    let json = fs::read_to_string(path)
        .map_err(|e| format!("read coverage lattice {}: {e}", path))?;
    let coverage: CoverageLattice = serde_json::from_str(&json)
        .map_err(|e| format!("deserialize coverage lattice {}: {e}", path))?;
    let validation = validate_coverage_lattice(&coverage);

    let embedded = &coverage.validation;
    if embedded.schema_version != validation.schema_version
        || embedded.validator_version != validation.validator_version
        || embedded.run_id != validation.run_id
        || embedded.passed != validation.passed
        || embedded.observed_row_count != validation.observed_row_count
        || embedded.expected_cell_count != validation.expected_cell_count
        || embedded.unique_cell_count != validation.unique_cell_count
        || embedded.missing_cells.len() != validation.missing_cells.len()
        || embedded.duplicate_cells.len() != validation.duplicate_cells.len()
        || embedded.invalid_cells.len() != validation.invalid_cells.len()
        || embedded.aggregate_input_summary.valid_rows != validation.aggregate_input_summary.valid_rows
        || embedded.aggregate_input_summary.included_rows != validation.aggregate_input_summary.included_rows
        || embedded.aggregate_input_summary.excluded_rows != validation.aggregate_input_summary.excluded_rows
        || embedded.aggregate_exclusions.len() != validation.aggregate_exclusions.len()
    {
        return Err(format!(
            "embedded validation receipt does not match serialized coverage rows in {}",
            path
        ));
    }

    Ok((coverage, validation))
}

fn validate_coverage_lattice(coverage: &CoverageLattice) -> LatticeValidationReceipt {
    let expected_cells = expected_lattice_cells();
    let expected_cell_count = expected_cells.len();
    let observed_row_count = coverage.rows.len();
    let baseline_commit_sha = coverage
        .rows
        .first()
        .map(|row| row.commit_sha.clone())
        .unwrap_or_default();

    let mut seen_cells: BTreeMap<LatticeCellKey, Vec<usize>> = BTreeMap::new();
    let mut invalid_cells = Vec::new();
    let mut aggregate_exclusions = Vec::new();
    let mut valid_row_count = 0usize;

    for (row_index, row) in coverage.rows.iter().enumerate() {
        match validate_coverage_row(row_index, &coverage.run_id, &baseline_commit_sha, row, &expected_cells) {
            Ok(validated) => {
                valid_row_count += 1;
                seen_cells
                    .entry(validated.cell_key.clone())
                    .or_default()
                    .push(row_index);
                if let Some(exclusion) = validated.aggregate_exclusion {
                    aggregate_exclusions.push(exclusion);
                }
            }
            Err(invalid) => invalid_cells.push(invalid),
        }
    }

    let seen_valid_cells: BTreeSet<LatticeCellKey> = seen_cells.keys().cloned().collect();
    let unique_cell_count = seen_valid_cells.len();
    let missing_cells = expected_cells
        .difference(&seen_valid_cells)
        .map(LatticeCellKey::to_cell_id)
        .collect::<Vec<_>>();
    let duplicate_cells = seen_cells
        .iter()
        .filter(|(_, row_indices)| row_indices.len() > 1)
        .map(|(cell_key, row_indices)| DuplicateCellReport {
            lattice_cell_id: cell_key.to_cell_id(),
            observed_count: row_indices.len(),
            row_indices: row_indices.clone(),
        })
        .collect::<Vec<_>>();

    let aggregate_input_summary = AggregateInputSummary {
        valid_rows: valid_row_count,
        included_rows: valid_row_count.saturating_sub(aggregate_exclusions.len()),
        excluded_rows: aggregate_exclusions.len(),
    };

    LatticeValidationReceipt {
        schema_version: "coverage-lattice.validation.v2".to_string(),
        validator_version: "coverage-lattice-validator.v2".to_string(),
        run_id: coverage.run_id.clone(),
        passed: invalid_cells.is_empty() && duplicate_cells.is_empty() && missing_cells.is_empty(),
        observed_row_count,
        expected_cell_count,
        unique_cell_count,
        missing_cells,
        duplicate_cells,
        invalid_cells,
        aggregate_input_summary,
        aggregate_exclusions,
    }
}

struct ValidatedCoverageRow {
    cell_key: LatticeCellKey,
    aggregate_exclusion: Option<AggregateExclusion>,
}

fn validate_coverage_row(
    row_index: usize,
    expected_run_id: &str,
    expected_commit_sha: &str,
    row: &CoverageLatticeRow,
    expected_cells: &BTreeSet<LatticeCellKey>,
) -> Result<ValidatedCoverageRow, InvalidCellReport> {
    let lattice_cell_id = if row.lattice_cell_id.is_empty() {
        return Err(InvalidCellReport {
            row_index,
            lattice_cell_id: None,
            reason: "missing_lattice_cell_id".to_string(),
            detail: "lattice_cell_id was empty".to_string(),
        });
    } else {
        row.lattice_cell_id.clone()
    };

    let parsed = parse_lattice_cell_id(&lattice_cell_id).map_err(|err| InvalidCellReport {
        row_index,
        lattice_cell_id: Some(lattice_cell_id.clone()),
        reason: "malformed_lattice_cell_id".to_string(),
        detail: format!("{err:?}"),
    })?;

    let expected_key = LatticeCellKey::new(
        &row.backend,
        &row.graph_family,
        &row.shape_profile,
        &row.runtime_policy,
    );
    if parsed != expected_key {
        return Err(InvalidCellReport {
            row_index,
            lattice_cell_id: Some(lattice_cell_id),
            reason: "lattice_cell_id_row_field_mismatch".to_string(),
            detail: format!(
                "expected {}, observed {}",
                expected_key.to_cell_id(),
                parsed.to_cell_id(),
            ),
        });
    }

    if !expected_cells.contains(&parsed) {
        return Err(InvalidCellReport {
            row_index,
            lattice_cell_id: Some(lattice_cell_id),
            reason: "unexpected_lattice_cell".to_string(),
            detail: format!("{} is outside the canonical coverage universe", parsed.to_cell_id()),
        });
    }

    if row.run_id != expected_run_id {
        return Err(InvalidCellReport {
            row_index,
            lattice_cell_id: Some(lattice_cell_id),
            reason: "mixed_run_id".to_string(),
            detail: format!("expected {}, observed {}", expected_run_id, row.run_id),
        });
    }

    if row.commit_sha != expected_commit_sha {
        return Err(InvalidCellReport {
            row_index,
            lattice_cell_id: Some(lattice_cell_id),
            reason: "mixed_commit_sha".to_string(),
            detail: format!("expected {}, observed {}", expected_commit_sha, row.commit_sha),
        });
    }

    if !COVERAGE_SUPPORT_TIERS.contains(&row.support_tier.as_str()) {
        return Err(InvalidCellReport {
            row_index,
            lattice_cell_id: Some(lattice_cell_id),
            reason: "unknown_support_tier".to_string(),
            detail: format!("support_tier={} is not in the canonical lattice vocabulary", row.support_tier),
        });
    }

    if !COVERAGE_PREDICT_STATUSES.contains(&row.predict_status.as_str()) {
        return Err(InvalidCellReport {
            row_index,
            lattice_cell_id: Some(lattice_cell_id),
            reason: "unknown_predict_status".to_string(),
            detail: format!("predict_status={} is not in the canonical lattice vocabulary", row.predict_status),
        });
    }

    if is_coverage_pass_status(&row.predict_status) {
        if !row.predict_failure_classification.is_empty() {
            return Err(InvalidCellReport {
                row_index,
                lattice_cell_id: Some(lattice_cell_id),
                reason: "pass_with_failure_classification".to_string(),
                detail: "passed rows must leave predict_failure_classification empty".to_string(),
            });
        }
        if matches!(row.support_tier.as_str(), "unsupported_graph" | "not_implemented") {
            return Err(InvalidCellReport {
                row_index,
                lattice_cell_id: Some(lattice_cell_id),
                reason: "unsupported_graph_with_passed_status".to_string(),
                detail: "unsupported rows cannot report pass".to_string(),
            });
        }
    } else {
        if row.predict_failure_classification.is_empty() {
            return Err(InvalidCellReport {
                row_index,
                lattice_cell_id: Some(lattice_cell_id),
                reason: "failed_without_failure_classification".to_string(),
                detail: "non-pass rows must set predict_failure_classification".to_string(),
            });
        }
        if !COVERAGE_PREDICT_FAILURE_CLASSES.contains(&row.predict_failure_classification.as_str()) {
            return Err(InvalidCellReport {
                row_index,
                lattice_cell_id: Some(lattice_cell_id),
                reason: "unknown_predict_failure_classification".to_string(),
                detail: format!(
                    "predict_failure_classification={} is not in the canonical lattice vocabulary",
                    row.predict_failure_classification
                ),
            });
        }
        if matches!(row.support_tier.as_str(), "unsupported_graph" | "not_implemented")
            && row.predict_status != "skipped_by_support"
        {
            return Err(InvalidCellReport {
                row_index,
                lattice_cell_id: Some(lattice_cell_id),
                reason: "unsupported_graph_with_passed_status".to_string(),
                detail: "unsupported rows must be skipped_by_support".to_string(),
            });
        }
        if !matches!(row.support_tier.as_str(), "unsupported_graph" | "not_implemented")
            && row.predict_status == "skipped_by_support"
        {
            return Err(InvalidCellReport {
                row_index,
                lattice_cell_id: Some(lattice_cell_id),
                reason: "unsupported_graph_with_passed_status".to_string(),
                detail: "skipped_by_support requires unsupported or not_implemented support".to_string(),
            });
        }
    }

    if !row.reference_output_hashes_populated {
        return Err(InvalidCellReport {
            row_index,
            lattice_cell_id: Some(lattice_cell_id),
            reason: "missing_reference_hashes".to_string(),
            detail: "reference_output_hashes_populated must be true for every row".to_string(),
        });
    }

    let aggregate_exclusion = if canonical_family_name(row.graph_family.as_str()) == "identity_passthrough" {
        Some(AggregateExclusion {
            row_index,
            lattice_cell_id: lattice_cell_id.clone(),
            reason: identity_baseline_family_name().to_string(),
            detail: "identity rows are excluded from latency aggregates".to_string(),
        })
    } else if is_coverage_pass_status(&row.predict_status) {
        None
    } else {
        Some(AggregateExclusion {
            row_index,
            lattice_cell_id: lattice_cell_id.clone(),
            reason: row.predict_status.clone(),
            detail: "non-pass rows are excluded from aggregate timing calculations".to_string(),
        })
    };

    Ok(ValidatedCoverageRow {
        cell_key: parsed,
        aggregate_exclusion,
    })
}
