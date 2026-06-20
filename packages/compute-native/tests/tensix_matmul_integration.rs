use tribunus_compute_native::tensix::matmul::MatmulProvider;
use tribunus_compute_native::tensix::weight_loader::{DeviceWeightResidency, ResidencyHandle};

#[test]
fn test_matmul_with_device_weight_residency() {
    let mut residency = DeviceWeightResidency::new(
        "model_weights_v1".into(),
        "mock_checksum_123".into(),
        1024 * 1024 * 1024,
    );

    residency.insert_segment("weight_proj_1".into(), ResidencyHandle(0x1000));
    residency.insert_segment("weight_proj_2".into(), ResidencyHandle(0x2000));

    let matmul = MatmulProvider::new(vec!["weight_proj_1".into(), "weight_proj_2".into()]);

    let result = matmul.execute(&residency);
    assert!(result.is_ok(), "Matmul execution failed: {:?}", result);
}
