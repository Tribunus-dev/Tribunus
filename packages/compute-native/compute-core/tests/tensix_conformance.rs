use tribunus_compute_core::backend::DType;
use tribunus_compute_core::contracts::transformer::{
    RmsNormContract, RopeContract, RopeRotationMode,
};
use tribunus_compute_core::tensix::admission::check_admission;
use tribunus_compute_core::tensix::cpu_ref::{cpu_rmsnorm, cpu_rope};
use tribunus_compute_core::tensix::rmsnorm::generate_rmsnorm_artifact;
use tribunus_compute_core::tensix::rope::generate_rope_artifact;

#[test]
fn test_rmsnorm_artifact_and_admission() {
    // Single decode
    let contract = RmsNormContract {
        input_shape: vec![1, 4096],
        weight_shape: vec![4096],
        output_shape: vec![1, 4096],
        dtype: DType::F16,
        eps: 1e-5,
    };
    let artifact = generate_rmsnorm_artifact(&contract).unwrap();
    assert_eq!(artifact.manifest_format, "session-17");
    let admission = check_admission(&artifact);
    assert!(admission.is_admitted);

    // Batch prefill
    let contract_batch = RmsNormContract {
        input_shape: vec![16, 4096],
        weight_shape: vec![4096],
        output_shape: vec![16, 4096],
        dtype: DType::F16,
        eps: 1e-5,
    };
    let artifact_batch = generate_rmsnorm_artifact(&contract_batch).unwrap();
    assert_eq!(artifact_batch.manifest_format, "session-17");
    let admission_batch = check_admission(&artifact_batch);
    assert!(admission_batch.is_admitted);
}

#[test]
fn test_rope_artifact_and_admission() {
    // Decode (1 seq)
    let contract = RopeContract {
        query_shape: vec![1, 32, 128],
        head_dim: 128,
        max_seq_len: 2048,
        dtype: DType::F16,
        mode: RopeRotationMode::FullNeox,
        position_index: 0,
        cos_table: vec![],
        sin_table: vec![],
    };
    let artifact = generate_rope_artifact(&contract).unwrap();
    assert_eq!(artifact.manifest_format, "session-17");
    let admission = check_admission(&artifact);
    assert!(admission.is_admitted);

    // Prefill (e.g. 16 seq)
    let contract_prefill = RopeContract {
        query_shape: vec![16, 32, 128],
        head_dim: 128,
        max_seq_len: 2048,
        dtype: DType::F16,
        mode: RopeRotationMode::FullNeox,
        position_index: 0,
        cos_table: vec![],
        sin_table: vec![],
    };
    let artifact_prefill = generate_rope_artifact(&contract_prefill).unwrap();
    assert_eq!(artifact_prefill.manifest_format, "session-17");
    let admission_prefill = check_admission(&artifact_prefill);
    assert!(admission_prefill.is_admitted);
}

#[test]
fn test_rmsnorm_cpu_ref_numerical() {
    // test with [1, 4] where we assume tile alignment checked at artifact generation level, but unit test checks logic
    let input = vec![1.0, 2.0, 3.0, 4.0];
    let weight = vec![1.0, 1.0, 1.0, 1.0];
    let eps = 1e-5;

    let out = cpu_rmsnorm(&input, &weight, eps);
    assert_eq!(out.len(), 4);

    let expected = vec![0.365148, 0.730296, 1.095445, 1.460593]; // derived from (x - 0) / sqrt((1^2+2^2+3^2+4^2)/4)

    for i in 0..4 {
        let diff = (out[i] - expected[i]).abs();
        assert!(
            diff < 1e-2,
            "RMSNorm mismatch outside 1e-2 tolerance: {} vs {}",
            out[i],
            expected[i]
        );
    }
}

#[test]
fn test_rope_cpu_ref_numerical() {
    let query = vec![1.0, 2.0, 3.0, 4.0]; // shape [1, 1, 4] -> head_dim = 4
    let cos = vec![0.8, 0.6];
    let sin = vec![0.6, 0.8];

    let out_half = cpu_rope(&query, &cos, &sin, 4, RopeRotationMode::HalfRotation, 0);
    let out_full = cpu_rope(&query, &cos, &sin, 4, RopeRotationMode::FullNeox, 0);

    assert_eq!(out_half.len(), 4);
    assert_eq!(out_full.len(), 4);

    // Expected for HalfRotation:
    let expected_half = vec![-0.4, 2.2, -1.4, 4.8];
    for i in 0..4 {
        assert!(
            (out_half[i] - expected_half[i]).abs() < 1e-2,
            "RoPE HalfRotation mismatch: expected {}, got {}",
            expected_half[i],
            out_half[i]
        );
    }

    // Expected for FullNeox (head_dim=4, half=2):
    let expected_full = vec![-1.0, -2.0, 3.0, 4.0];
    for i in 0..4 {
        assert!(
            (out_full[i] - expected_full[i]).abs() < 1e-2,
            "RoPE FullNeox mismatch: expected {}, got {}",
            expected_full[i],
            out_full[i]
        );
    }
}
