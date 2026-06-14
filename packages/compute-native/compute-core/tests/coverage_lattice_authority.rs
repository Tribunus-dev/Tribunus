use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use tribunus_compute_native::decode_attribution::lattice::expected_lattice_cells;
use tribunus_compute_native::decode_attribution::report::generate_coverage_json;
use tribunus_compute_native::decode_attribution::receipt::DecodeAttributionReceipt;
fn unique_run_id(tag: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    format!("DA-TEST-{}-{}", tag, nanos)
}

fn receipt_for_cell(run_id: &str, cell: &tribunus_compute_native::decode_attribution::lattice::LatticeCellKey) -> DecodeAttributionReceipt {
    let mut receipt = DecodeAttributionReceipt::default();
    receipt.run_id = run_id.to_string();
    receipt.commit_sha = "commit-sha-1".to_string();
    receipt.branch = "main".to_string();
    receipt.timestamp = "2026-06-13T00:00:00Z".to_string();
    receipt.schema_version = "decode-attribution.v1".to_string();
    receipt.graph_family = cell.graph_family.clone();
    receipt.shape_profile = cell.shape_profile.clone();
    receipt.backend = cell.backend.clone();
    receipt.backend_runtime_policy = cell.runtime_policy.clone();
    receipt.lattice_cell_id = cell.to_cell_id();
    receipt.backend_support_status = "supported".to_string();
    receipt.support_tier = if cell.backend == "coreml" {
        "supported_native".to_string()
    } else {
        "supported_composed".to_string()
    };
    receipt.materialize_status = if cell.backend == "coreml" {
        "ok".to_string()
    } else {
        "not_applicable".to_string()
    };
    receipt.compile_status = if cell.backend == "coreml" {
        "ok".to_string()
    } else {
        "not_applicable".to_string()
    };
    receipt.load_status = if cell.backend == "coreml" {
        "ok".to_string()
    } else {
        "not_applicable".to_string()
    };
    receipt.terminal_phase = "complete".to_string();
    receipt.predict_status = "pass".to_string();
    receipt.predict_failure_classification = String::new();
    receipt.reference_output_hashes_populated = true;
    receipt.reference_output_hashes = vec![format!("ref-{}", cell.to_cell_id())];
    receipt.cold_output_hashes = vec![format!("backend-{}", cell.to_cell_id())];
    receipt.cold_first_predict_ns = 10;
    receipt.steady_p50_ns = 20;
    receipt.steady_total_ns = 20;
    receipt.steady_iterations = 1;
    receipt.steady_sample_ns = vec![20];
    receipt.steady_status = "ok".to_string();
    receipt.cold_status = "ok".to_string();
    receipt.warmup_status = "skipped".to_string();
    receipt.warmup_iterations = 0;
    receipt.load_duration_ns = 1;
    receipt.compile_duration_ns = 1;
    receipt.materialize_duration_ns = 1;
    receipt.max_absolute_error = 0.0;
    receipt.matches_tolerance = true;
    receipt.status = "pass".to_string();
    receipt.reference_status = "ok".to_string();
    receipt
}

fn valid_lattice_json(run_id: &str) -> String {
    let receipts = expected_lattice_cells()
        .into_iter()
        .map(|cell| receipt_for_cell(run_id, &cell))
        .collect::<Vec<_>>();
    let coverage = generate_coverage_json(run_id, false, false, false, vec![], &receipts);
    serde_json::to_string_pretty(&coverage).expect("serialize coverage")
}

fn write_fixture(tag: &str, json: &str) -> String {
    let dir = std::env::temp_dir().join(format!("tribunus-coverage-{tag}-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("create temp dir");
    let path = dir.join("coverage-lattice.json");
    fs::write(&path, json).expect("write coverage lattice json");
    path.to_string_lossy().to_string()
}

fn validate_path(path: &str) -> (bool, String) {
    let bin = env!("CARGO_BIN_EXE_tribunus-coreml-decode-attribution");
    let output = Command::new(bin)
        .args(["--validate-coverage-lattice", path, "--authority-mode"])
        .output()
        .expect("run validation-only binary");
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    (output.status.success(), stderr)
}

#[test]
fn authority_mode_accepts_clean_emitted_lattice() {
    let run_id = unique_run_id("clean");
    let path = write_fixture("clean", &valid_lattice_json(&run_id));
    let (success, stderr) = validate_path(&path);
    assert!(success, "{stderr}");
    assert!(stderr.contains("coverage lattice validation passed"), "{stderr}");
}

#[test]
fn authority_mode_rejects_mutated_cell_id() {
    let run_id = unique_run_id("cell-id");
    let mut json: serde_json::Value = serde_json::from_str(&valid_lattice_json(&run_id)).expect("parse json");
    let rows = json["rows"].as_array_mut().expect("rows array");
    rows[0]["lattice_cell_id"] = serde_json::Value::String("coverage-lattice.v2/coreml/matmul/small/cpuOnly-mutated".to_string());
    let path = write_fixture("cell-id", &serde_json::to_string_pretty(&json).expect("serialize mutated json"));
    let (success, stderr) = validate_path(&path);
    assert!(!success, "{stderr}");
    assert!(stderr.contains("coverage lattice validation failed"), "{stderr}");
}

#[test]
fn authority_mode_rejects_missing_row() {
    let run_id = unique_run_id("missing-row");
    let mut json: serde_json::Value = serde_json::from_str(&valid_lattice_json(&run_id)).expect("parse json");
    let rows = json["rows"].as_array_mut().expect("rows array");
    rows.pop();
    let rows_len = rows.len();
    json["total_rows"] = serde_json::Value::from(rows_len);
    json["validation"]["observed_row_count"] = serde_json::Value::from(rows_len);
    let path = write_fixture("missing-row", &serde_json::to_string_pretty(&json).expect("serialize mutated json"));
    let (success, stderr) = validate_path(&path);
    assert!(!success, "{stderr}");
    assert!(stderr.contains("coverage lattice validation failed"), "{stderr}");
}

#[test]
fn authority_mode_rejects_predict_status_typo() {
    let run_id = unique_run_id("typo");
    let mut json: serde_json::Value = serde_json::from_str(&valid_lattice_json(&run_id)).expect("parse json");
    let rows = json["rows"].as_array_mut().expect("rows array");
    rows[0]["predict_status"] = serde_json::Value::String("passs".to_string());
    let path = write_fixture("typo", &serde_json::to_string_pretty(&json).expect("serialize mutated json"));
    let (success, stderr) = validate_path(&path);
    assert!(!success, "{stderr}");
    assert!(stderr.contains("coverage lattice validation failed"), "{stderr}");
}
