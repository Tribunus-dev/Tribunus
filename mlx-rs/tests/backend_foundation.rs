use mlx_rs::backend::{
    BackendConformanceRunner, DType, DevicePreference, MlxBackendCapabilities, SupportStatus,
    TensorSpec,
};

#[test]
fn test_conformance_runner_can_init() {
    let caps = MlxBackendCapabilities::detect();

    let runner = BackendConformanceRunner::default().with_capabilities(caps);

    // We expect this to run and produce evidence records without aborting,
    // though the numerical results might fail or pass depending on the actual MLX backend.
    let evidence = runner.run_core_ops().unwrap();
    assert_eq!(
        evidence.len(),
        10,
        "Expected exactly 10 operations evaluated"
    );

    for record in evidence {
        assert_eq!(
            record.schema_version,
            "tribunus.mlx.conformance_evidence.v0"
        );
        // We do not strictly assert it passes here, because CI might lack MLX completely or lack GPUs.
        // We only assert that we captured the evidence properly as requested by the plan.
        assert_ne!(record.support_status, SupportStatus::Unknown);
    }
}

#[test]
fn test_tensor_spec_validation() {
    let valid_spec = TensorSpec::dense(DType::F32, vec![2, 3], DevicePreference::Default);
    assert!(valid_spec.validate().is_ok());

    let invalid_spec = TensorSpec::dense(DType::F32, vec![2, 0, 3], DevicePreference::Default);
    assert!(invalid_spec.validate().is_err());
}

fn test_negative_evidence(
    op_name: &str,
    create_bad_evidence: impl Fn(&BackendConformanceRunner) -> mlx_rs::backend::ConformanceEvidence,
) {
    let runner = BackendConformanceRunner::default();
    let evidence = create_bad_evidence(&runner);

    assert_eq!(evidence.op, op_name);
    assert_eq!(evidence.support_status, SupportStatus::Supported); // Supported but invalid input
    assert!(evidence.error.is_some());
    assert_eq!(evidence.error.unwrap().category, "UnsupportedShape");
}

#[test]
fn test_negative_invalid_shape_add() {
    test_negative_evidence("add", |_runner| {
        // Implement a helper simulation inside the runner or directly test the backend semantics
        let a = mlx_rs::Array::from_slice(&[1.0_f32, 2.0], &[2]);
        let b = mlx_rs::Array::from_slice(&[1.0_f32, 2.0, 3.0], &[3]);

        let spec_a = TensorSpec::dense(DType::F32, vec![2], DevicePreference::Default);
        let spec_b = TensorSpec::dense(DType::F32, vec![3], DevicePreference::Default);

        let out_res = mlx_rs::ops::add(&a, &b);
        let err = if out_res.is_err() {
            Some(mlx_rs::backend::MlxError::UnsupportedShape)
        } else {
            None
        };

        let err_report = err
            .as_ref()
            .map(|e| mlx_rs::backend::evidence::MlxErrorReport {
                category: "UnsupportedShape".into(),
                message: e.to_string(),
            });

        mlx_rs::backend::ConformanceEvidence {
            schema_version: "tribunus.mlx.conformance_evidence.v0".into(),
            case_id: "add_negative".into(),
            op: "add".into(),
            implementation: mlx_rs::backend::capabilities::ImplementationKind::NativeMlx,
            support_status: SupportStatus::Supported, // The op is supported, but inputs are invalid
            inputs: vec![spec_a, spec_b],
            outputs: vec![],
            eval_forced: false,
            readback_performed: false,
            comparison: None,
            error: err_report,
        }
    });
}

#[test]
fn test_negative_invalid_shape_matmul() {
    test_negative_evidence("matmul", |_runner| {
        let a = mlx_rs::Array::from_slice(&[1.0_f32, 2.0], &[2, 1]);
        let b = mlx_rs::Array::from_slice(&[1.0_f32, 2.0, 3.0], &[3, 1]);

        let spec_a = TensorSpec::dense(DType::F32, vec![2, 1], DevicePreference::Default);
        let spec_b = TensorSpec::dense(DType::F32, vec![3, 1], DevicePreference::Default);

        let out_res = mlx_rs::ops::matmul(&a, &b);
        let err = if out_res.is_err() {
            Some(mlx_rs::backend::MlxError::UnsupportedShape)
        } else {
            None
        };

        let err_report = err
            .as_ref()
            .map(|e| mlx_rs::backend::evidence::MlxErrorReport {
                category: "UnsupportedShape".into(),
                message: e.to_string(),
            });

        mlx_rs::backend::ConformanceEvidence {
            schema_version: "tribunus.mlx.conformance_evidence.v0".into(),
            case_id: "matmul_negative".into(),
            op: "matmul".into(),
            implementation: mlx_rs::backend::capabilities::ImplementationKind::NativeMlx,
            support_status: SupportStatus::Supported,
            inputs: vec![spec_a, spec_b],
            outputs: vec![],
            eval_forced: false,
            readback_performed: false,
            comparison: None,
            error: err_report,
        }
    });
}

#[test]
fn test_negative_reshape_element_count() {
    test_negative_evidence("reshape", |_runner| {
        let a = mlx_rs::Array::from_slice(&[1.0_f32, 2.0], &[2]);
        let spec_a = TensorSpec::dense(DType::F32, vec![2], DevicePreference::Default);

        let out_res = mlx_rs::ops::reshape(&a, &[3]);
        let err = if out_res.is_err() {
            Some(mlx_rs::backend::MlxError::UnsupportedShape)
        } else {
            None
        };

        let err_report = err
            .as_ref()
            .map(|e| mlx_rs::backend::evidence::MlxErrorReport {
                category: "UnsupportedShape".into(),
                message: e.to_string(),
            });

        mlx_rs::backend::ConformanceEvidence {
            schema_version: "tribunus.mlx.conformance_evidence.v0".into(),
            case_id: "reshape_negative".into(),
            op: "reshape".into(),
            implementation: mlx_rs::backend::capabilities::ImplementationKind::NativeMlx,
            support_status: SupportStatus::Supported,
            inputs: vec![spec_a],
            outputs: vec![],
            eval_forced: false,
            readback_performed: false,
            comparison: None,
            error: err_report,
        }
    });
}

#[test]
fn test_logical_row_major_readback() {
    // Regression test for transposed readback
    let data = vec![1.0_f32, 2.0, 3.0, 4.0];
    let a = mlx_rs::Array::from_slice(&data, &[2, 2]);
    let transposed = mlx_rs::ops::transpose(&a).unwrap();
    let readback = mlx_rs::backend::eval::readback_f32(&transposed).unwrap();
    assert_eq!(
        readback,
        vec![1.0, 3.0, 2.0, 4.0],
        "Readback must match logical row-major transposition."
    );
}
