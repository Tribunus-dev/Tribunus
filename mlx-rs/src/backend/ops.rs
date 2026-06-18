use super::capabilities::{ImplementationKind, MlxBackendCapabilities, SupportStatus};
use super::dtype::DType;
use super::error::{MlxError, MlxResult};
use super::evidence::{ConformanceEvidence, MlxErrorReport, NumericalComparison};
use super::reference;
use super::tensor::{DevicePreference, TensorSpec};
use crate::Array;

/// Runs conformance tests for MLX backend.
#[derive(Debug, Default)]
pub struct BackendConformanceRunner {
    /// Associated backend capabilities
    pub caps: Option<MlxBackendCapabilities>,
}

fn array_to_spec(_name: &str, arr: &Array) -> TensorSpec {
    TensorSpec::dense(
        super::dtype::DType::try_from(arr.dtype()).unwrap_or(DType::F32),
        arr.shape().iter().map(|&x| x as usize).collect(),
        DevicePreference::Default,
    )
}

fn compare_f32(
    actual: &[f32],
    expected: &[f32],
    tol_abs: f64,
) -> (bool, Option<NumericalComparison>) {
    if actual.len() != expected.len() {
        return (false, None);
    }

    let mut max_abs = 0.0_f64;
    let mut mean_abs = 0.0_f64;
    let mut max_rel = 0.0_f64;
    let mut nan_count = 0;
    let mut inf_count = 0;
    let mut first_mismatch = None;

    for i in 0..actual.len() {
        let a = actual[i] as f64;
        let e = expected[i] as f64;

        if a.is_nan() {
            nan_count += 1;
        }
        if a.is_infinite() {
            inf_count += 1;
        }

        if a.is_nan() || e.is_nan() {
            if first_mismatch.is_none() {
                first_mismatch = Some(i);
            }
            continue;
        }

        let abs_diff = (a - e).abs();
        let rel_diff = if e.abs() > 0.0 {
            abs_diff / e.abs()
        } else {
            0.0
        };

        if abs_diff > max_abs {
            max_abs = abs_diff;
        }
        mean_abs += abs_diff;
        if rel_diff > max_rel {
            max_rel = rel_diff;
        }

        if abs_diff > tol_abs && first_mismatch.is_none() {
            first_mismatch = Some(i);
        }
    }
    mean_abs /= actual.len() as f64;

    let passed = nan_count == 0 && inf_count == 0 && max_abs <= tol_abs;

    (
        passed,
        Some(NumericalComparison {
            reference: "CPU F32".to_string(),
            tolerance_abs: tol_abs,
            tolerance_rel: 0.0,
            max_abs_error: max_abs,
            mean_abs_error: mean_abs,
            max_rel_error: max_rel,
            nan_count,
            inf_count,
            first_mismatch_index: first_mismatch,
            passed,
        }),
    )
}

impl BackendConformanceRunner {
    /// Attaches capabilities
    pub fn with_capabilities(mut self, caps: MlxBackendCapabilities) -> Self {
        self.caps = Some(caps);
        self
    }

    /// Runs all core ops tests
    pub fn run_core_ops(&self) -> MlxResult<Vec<ConformanceEvidence>> {
        let mut evidence = Vec::new();

        // 1. Identity Float32
        evidence.push(self.test_identity());

        // 2. Constant creation Float32
        evidence.push(self.test_constant());

        // 3. Add Float32
        evidence.push(self.test_add());

        // 4. Multiply Float32
        evidence.push(self.test_mul());

        // 5. Sigmoid Float32
        evidence.push(self.test_sigmoid());

        // 6. SiLU Float32
        evidence.push(self.test_silu());

        // 7. Matmul Float32
        evidence.push(self.test_matmul());

        // 8. Reshape Float32
        evidence.push(self.test_reshape());

        // 9. Transpose Float32
        evidence.push(self.test_transpose());

        // 10. Softmax Float32
        evidence.push(self.test_softmax());

        Ok(evidence)
    }

    fn build_evidence(
        &self,
        case_id: &str,
        op_name: &str,
        impl_kind: ImplementationKind,
        inputs: Vec<TensorSpec>,
        outputs: Vec<TensorSpec>,
        eval_forced: bool,
        readback_performed: bool,
        comparison: Option<NumericalComparison>,
        err: Option<MlxError>,
    ) -> ConformanceEvidence {
        let err_report = err.as_ref().map(|e| MlxErrorReport {
            category: match e {
                MlxError::UnsupportedOp => "UnsupportedOp".into(),
                MlxError::UnsupportedShape => "UnsupportedShape".into(),
                MlxError::EvaluationFailed(_) => "EvaluationFailed".into(),
                MlxError::ReadbackFailed(_) => "ReadbackFailed".into(),
                MlxError::NumericalMismatch => "NumericalMismatch".into(),
                _ => "Other".into(),
            },
            message: e.to_string(),
        });

        let support = match err {
            Some(MlxError::UnsupportedOp) => SupportStatus::Unsupported,
            Some(MlxError::UnsupportedShape) => SupportStatus::Supported, // Operation is supported, but input was invalid
            Some(_) => SupportStatus::Supported, // Runtime failures mean it attempted to run
            None => SupportStatus::Supported,
        };

        ConformanceEvidence {
            schema_version: "tribunus.mlx.conformance_evidence.v0".into(),
            case_id: case_id.into(),
            op: op_name.into(),
            implementation: impl_kind,
            support_status: support,
            inputs,
            outputs,
            eval_forced,
            readback_performed,
            comparison,
            error: err_report,
        }
    }

    fn test_identity(&self) -> ConformanceEvidence {
        let data = vec![1.0_f32, 2.0, 3.0, 4.0, 5.0, 6.0];
        let shape = vec![2, 3];
        let arr = Array::from_slice(&data, &shape);
        let spec_in = array_to_spec("input", &arr);

        let out = &arr;
        let spec_out = array_to_spec("output", out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::identity_f32(&data);
                let (passed, c) = compare_f32(&actual, &expected, 1e-5);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "identity_f32",
            "identity",
            ImplementationKind::NativeMlx,
            vec![spec_in],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_constant(&self) -> ConformanceEvidence {
        let data = vec![7.0_f32, 8.0, 9.0, 10.0, 11.0, 12.0];
        let shape = vec![2, 3];

        let out = Array::from_slice(&data, &shape);
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = data.clone();
                let (passed, c) = compare_f32(&actual, &expected, 1e-5);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "constant_f32",
            "constant",
            ImplementationKind::NativeMlx,
            vec![],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_add(&self) -> ConformanceEvidence {
        let a_data = vec![1.0_f32, 2.0, 3.0, 4.0, 5.0, 6.0];
        let b_data = vec![1.0_f32, 1.0, 1.0, 1.0, 1.0, 1.0];
        let shape = vec![2, 3];

        let a_arr = Array::from_slice(&a_data, &shape);
        let b_arr = Array::from_slice(&b_data, &shape);
        let spec_a = array_to_spec("a", &a_arr);
        let spec_b = array_to_spec("b", &b_arr);

        if spec_a.shape != spec_b.shape {
            return self.build_evidence(
                "add_f32",
                "add",
                ImplementationKind::NativeMlx,
                vec![spec_a, spec_b],
                vec![],
                false,
                false,
                None,
                Some(MlxError::UnsupportedShape),
            );
        }

        let out = match crate::ops::add(&a_arr, &b_arr) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "add_f32",
                    "add",
                    ImplementationKind::NativeMlx,
                    vec![spec_a, spec_b],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::add_f32(&a_data, &b_data);
                let (passed, c) = compare_f32(&actual, &expected, 1e-5);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "add_f32",
            "add",
            ImplementationKind::NativeMlx,
            vec![spec_a, spec_b],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_mul(&self) -> ConformanceEvidence {
        let a_data = vec![1.0_f32, 2.0, 3.0, 4.0, 5.0, 6.0];
        let b_data = vec![2.0_f32, 2.0, 2.0, 2.0, 2.0, 2.0];
        let shape = vec![2, 3];

        let a_arr = Array::from_slice(&a_data, &shape);
        let b_arr = Array::from_slice(&b_data, &shape);
        let spec_a = array_to_spec("a", &a_arr);
        let spec_b = array_to_spec("b", &b_arr);

        if spec_a.shape != spec_b.shape {
            return self.build_evidence(
                "mul_f32",
                "multiply",
                ImplementationKind::NativeMlx,
                vec![spec_a, spec_b],
                vec![],
                false,
                false,
                None,
                Some(MlxError::UnsupportedShape),
            );
        }

        let out = match crate::ops::multiply(&a_arr, &b_arr) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "mul_f32",
                    "multiply",
                    ImplementationKind::NativeMlx,
                    vec![spec_a, spec_b],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::mul_f32(&a_data, &b_data);
                let (passed, c) = compare_f32(&actual, &expected, 1e-5);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "mul_f32",
            "multiply",
            ImplementationKind::NativeMlx,
            vec![spec_a, spec_b],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_sigmoid(&self) -> ConformanceEvidence {
        let data = vec![-1.0_f32, 0.0, 1.0, 2.0];
        let shape = vec![4];
        let arr = Array::from_slice(&data, &shape);
        let spec_in = array_to_spec("input", &arr);

        let out = match crate::ops::sigmoid(&arr) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "sigmoid_f32",
                    "sigmoid",
                    ImplementationKind::NativeMlx,
                    vec![spec_in.clone()],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::sigmoid_f32(&data);
                let (passed, c) = compare_f32(&actual, &expected, 1e-4);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "sigmoid_f32",
            "sigmoid",
            ImplementationKind::NativeMlx,
            vec![spec_in],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_silu(&self) -> ConformanceEvidence {
        let data = vec![-1.0_f32, 0.0, 1.0, 2.0];
        let shape = vec![4];
        let arr = Array::from_slice(&data, &shape);
        let spec_in = array_to_spec("input", &arr);

        let sig = match crate::ops::sigmoid(&arr) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "silu_f32",
                    "silu",
                    ImplementationKind::ComposedMlx,
                    vec![spec_in.clone()],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let out = match crate::ops::multiply(&arr, &sig) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "silu_f32",
                    "silu",
                    ImplementationKind::ComposedMlx,
                    vec![spec_in.clone()],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::silu_f32(&data);
                let (passed, c) = compare_f32(&actual, &expected, 1e-4);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "silu_f32",
            "silu",
            ImplementationKind::ComposedMlx,
            vec![spec_in],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_matmul(&self) -> ConformanceEvidence {
        let a_data = vec![1.0_f32, 2.0, 3.0, 4.0, 5.0, 6.0]; // 2x3
        let b_data = vec![
            1.0_f32, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0,
        ]; // 3x4

        let a_arr = Array::from_slice(&a_data, &[2, 3]);
        let b_arr = Array::from_slice(&b_data, &[3, 4]);
        let spec_a = array_to_spec("a", &a_arr);
        let spec_b = array_to_spec("b", &b_arr);

        if spec_a.shape.len() != 2 || spec_b.shape.len() != 2 || spec_a.shape[1] != spec_b.shape[0]
        {
            return self.build_evidence(
                "matmul_f32",
                "matmul",
                ImplementationKind::NativeMlx,
                vec![spec_a, spec_b],
                vec![],
                false,
                false,
                None,
                Some(MlxError::UnsupportedShape),
            );
        }

        let out = match crate::ops::matmul(&a_arr, &b_arr) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "matmul_f32",
                    "matmul",
                    ImplementationKind::NativeMlx,
                    vec![spec_a, spec_b],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::matmul_f32(&a_data, &b_data, 2, 3, 4);
                let (passed, c) = compare_f32(&actual, &expected, 1e-4);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "matmul_f32",
            "matmul",
            ImplementationKind::NativeMlx,
            vec![spec_a, spec_b],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_reshape(&self) -> ConformanceEvidence {
        let data = vec![1.0_f32, 2.0, 3.0, 4.0, 5.0, 6.0];
        let arr = Array::from_slice(&data, &[2, 3]);
        let spec_in = array_to_spec("input", &arr);

        let new_shape: Vec<i32> = vec![3, 2];
        let old_count = spec_in.shape.iter().product::<usize>();
        let new_count = new_shape.iter().map(|&x| x as usize).product::<usize>();
        if old_count != new_count {
            return self.build_evidence(
                "reshape_f32",
                "reshape",
                ImplementationKind::NativeMlx,
                vec![spec_in.clone()],
                vec![],
                false,
                false,
                None,
                Some(MlxError::UnsupportedShape),
            );
        }

        let out = match crate::ops::reshape(&arr, &new_shape) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "reshape_f32",
                    "reshape",
                    ImplementationKind::NativeMlx,
                    vec![spec_in.clone()],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::reshape_f32(&data, 6);
                let (passed, c) = compare_f32(&actual, &expected, 1e-5);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "reshape_f32",
            "reshape",
            ImplementationKind::NativeMlx,
            vec![spec_in],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_transpose(&self) -> ConformanceEvidence {
        let data = vec![1.0_f32, 2.0, 3.0, 4.0, 5.0, 6.0]; // 2x3
        let arr = Array::from_slice(&data, &[2, 3]);
        let spec_in = array_to_spec("input", &arr);

        let out = match crate::ops::transpose(&arr) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "transpose_f32",
                    "transpose",
                    ImplementationKind::NativeMlx,
                    vec![spec_in.clone()],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::transpose_f32(&data, 2, 3);
                let (passed, c) = compare_f32(&actual, &expected, 1e-5);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "transpose_f32",
            "transpose",
            ImplementationKind::NativeMlx,
            vec![spec_in],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }

    fn test_softmax(&self) -> ConformanceEvidence {
        let data = vec![1.0_f32, 2.0, 3.0, 4.0, 1.0, 2.0, 3.0, 4.0]; // 2x4
        let arr = Array::from_slice(&data, &[2, 4]);
        let spec_in = array_to_spec("input", &arr);

        let out = match crate::ops::softmax_axes(&arr, &[-1], None) {
            Ok(val) => val,
            Err(e) => {
                return self.build_evidence(
                    "softmax_f32",
                    "softmax",
                    ImplementationKind::NativeMlx,
                    vec![spec_in.clone()],
                    vec![],
                    false,
                    false,
                    None,
                    Some(MlxError::EvaluationFailed(e.what)),
                )
            }
        };
        let spec_out = array_to_spec("output", &out);

        let mut eval_forced = false;
        let mut readback = false;
        let mut comp = None;
        let mut err_opt = None;

        match super::eval::readback_f32(&out) {
            Ok(actual) => {
                eval_forced = true;
                readback = true;
                let expected = reference::softmax_f32(&data, 2, 4);
                let (passed, c) = compare_f32(&actual, &expected, 1e-4);
                comp = c;
                if !passed {
                    err_opt = Some(MlxError::NumericalMismatch);
                }
            }
            Err(e) => {
                err_opt = Some(e);
            }
        }

        self.build_evidence(
            "softmax_f32",
            "softmax",
            ImplementationKind::NativeMlx,
            vec![spec_in],
            vec![spec_out],
            eval_forced,
            readback,
            comp,
            err_opt,
        )
    }
}
