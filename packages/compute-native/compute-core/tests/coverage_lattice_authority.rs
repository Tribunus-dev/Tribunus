use std::fs;
use std::process::Command;
use tempfile::tempdir;
use tribunus_compute_core::decode_attribution::lattice::expected_lattice_cells;
use tribunus_compute_core::decode_attribution::receipt::DecodeAttributionReceipt;
use tribunus_compute_core::decode_attribution::report::{generate_coverage_json, CoverageLattice};

fn create_valid_lattice() -> (CoverageLattice, Vec<DecodeAttributionReceipt>) {
    let run_id = "TEST-RUN-1";
    let mut receipts = Vec::new();
    for cell in expected_lattice_cells() {
        let mut r = DecodeAttributionReceipt::default();
        r.run_id = run_id.to_string();
        r.commit_sha = "commit-sha-1".to_string();
        r.backend = cell.backend.clone();
        r.graph_family = cell.graph_family.clone();
        r.shape_profile = cell.shape_profile.clone();
        r.backend_runtime_policy = cell.runtime_policy.clone();
        r.lattice_cell_id = cell.to_cell_id();
        r.mark_passed();
        r.set_supported_native();
        r.reference_output_hashes_populated = true;
        r.reference_output_hashes = vec!["hash1".to_string()];
        r.cold_output_hashes = vec!["hash1".to_string()];
        r.steady_p50_ns = 1000;
        r.matches_tolerance = true;
        receipts.push(r);
    }

    let lattice = generate_coverage_json(run_id, false, false, false, vec![], &receipts);
    (lattice, receipts)
}

fn run_validator(path: &std::path::Path) -> bool {
    let output = Command::new("cargo")
        .args([
            "run",
            "-p",
            "tribunus-compute-core",
            "--bin",
            "tribunus-coreml-decode-attribution",
            "--",
            "--validate-coverage-lattice",
            path.to_str().unwrap(),
            "--authority-mode",
        ])
        .output()
        .expect("failed to execute validator");

    output.status.success()
}

#[test]
fn test_authority_rejects_corrupted_terminal_phase() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Mutate: Change terminal phase from complete to predict on a pass row
    lattice.rows[0].terminal_phase = "predict".to_string();

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected corrupted terminal phase"
    );
}

#[test]
fn test_authority_rejects_missing_reference_hashes() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Mutate: Remove reference hashes while populated=true
    lattice.rows[0].reference_output_hashes.clear();

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected missing reference hashes"
    );
}

#[test]
fn test_authority_rejects_pass_without_tolerance_match() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Mutate: matches_tolerance=false on a pass row
    lattice.rows[0].matches_tolerance = false;

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected pass without tolerance match"
    );
}

#[test]
fn test_authority_rejects_pass_without_timing() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Mutate: steady_p50_ns=0 on a pass row
    lattice.rows[0].steady_p50_ns = 0;

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected pass without timing"
    );
}

#[test]
fn test_authority_rejects_supported_native_with_cpu_glue() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Mutate: support_tier=supported_native with execution proof showing CPU glue
    lattice.rows[0].support_tier = "supported_native".to_string();
    lattice.rows[0].execution_proof_cpu_glue_ops = vec!["negate".to_string()];

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected supported_native with CPU glue"
    );
}

#[test]
fn test_authority_rejects_mlx_compile_attempted() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Find MLX row
    let mlx_row = lattice
        .rows
        .iter_mut()
        .find(|r| r.backend == "mlx")
        .expect("mlx row");
    mlx_row.mlx_compile_attempted = true;

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected MLX compile attempt"
    );
}

#[test]
fn test_authority_rejects_accelerate_unsupported_with_hashes() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Find Accelerate row and make it unsupported
    let accel_row = lattice
        .rows
        .iter_mut()
        .find(|r| r.backend == "accelerate")
        .expect("accel row");
    accel_row.support_tier = "unsupported_graph".to_string();
    accel_row.backend_support_status = "unsupported_graph".to_string();
    accel_row.predict_status = "skipped_by_support".to_string();
    accel_row.predict_failure_classification = "skipped_by_support".to_string();
    accel_row.terminal_phase = "skipped_by_support".to_string();
    // But give it hashes
    accel_row.backend_output_hashes = vec!["hash1".to_string()];

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected Accelerate unsupported row with hashes"
    );
}

#[test]
fn test_authority_rejects_unsupported_row_with_pass_status() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Mutate: unsupported row changed to predict_status=pass
    lattice.rows[0].support_tier = "unsupported_graph".to_string();
    lattice.rows[0].backend_support_status = "unsupported_graph".to_string();
    lattice.rows[0].predict_status = "pass".to_string();
    lattice.rows[0].predict_failure_classification.clear();

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected unsupported row with pass status"
    );
}

#[test]
fn test_authority_rejects_numerical_divergence_without_backend_hashes() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Mutate: numerical divergence row without backend hashes
    lattice.rows[0].predict_status = "numerical_divergence".to_string();
    lattice.rows[0].predict_failure_classification = "numerical_divergence".to_string();
    lattice.rows[0].terminal_phase = "conformance".to_string();
    lattice.rows[0].backend_output_hashes.clear();

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected numerical divergence without hashes"
    );
}

#[test]
fn test_authority_rejects_artifact_receipt_mismatch() {
    let tmp = tempdir().unwrap();
    let (mut lattice, _) = create_valid_lattice();

    // Mutate: Change observed_row_count in embedded validation receipt
    lattice.validation.observed_row_count += 1;

    let path = tmp.path().join("corrupted.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        !run_validator(&path),
        "Validator should have rejected manifest/receipt mismatch"
    );
}

#[test]
fn test_authority_accepts_valid_lattice() {
    let tmp = tempdir().unwrap();
    let (lattice, _) = create_valid_lattice();

    let path = tmp.path().join("valid.json");
    fs::write(&path, serde_json::to_string_pretty(&lattice).unwrap()).unwrap();

    assert!(
        run_validator(&path),
        "Validator should have accepted valid lattice"
    );
}
