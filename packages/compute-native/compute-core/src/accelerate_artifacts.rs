//! Accelerate artifact types — sealed CPU execution recipes.
//!
//! An Accelerate artifact is not a compiled binary. It is a validated
//! execution recipe: operation family, dtype, shape constraints, scalar
//! parameters, and framework ABI assumptions. The worker resolves the
//! recipe into a pre-verified dispatch handle at model load.
//!
//! The graph dispatches Accelerate artifacts exactly like Core ML or
//! Metal artifacts — through a Dispatch node with artifact_id and hash.

#[cfg(target_os = "macos")]
use crate::backend::accelerate_ffi;
use serde::{Deserialize, Serialize};

/// Which CPU library backs this artifact's execution.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum CpuImplementation {
    /// Plain Rust scalar loops — correct but not optimized.
    ScalarReference,
    /// Apple vDSP framework.
    AccelerateVdsp,
    /// Apple BLAS (cblas).
    AccelerateCblas,
    /// Apple BNNS.
    AccelerateBnns,
}

/// Accelerate operation family.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum AccelerateOp {
    /// RMSNorm: x / sqrt(mean(x^2) + eps) * weight
    RmsNorm { eps: f64 },
    /// Element-wise add: a + b
    Add,
    /// Element-wise multiply: a * b
    Mul,
    /// SiLU: x * sigmoid(x)
    Silu,
}

/// Shape contract for CPU artifacts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuShapeContract {
    pub rows: u64,
    pub cols: u64,
    pub dims: Vec<u64>,
}

/// Layout contract for CPU artifacts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuLayoutContract {
    pub row_major: bool,
    pub contiguous: bool,
    pub alignment: usize,
}

/// A scalar parameter value that can be f32, f64, i64, or bool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScalarValue {
    F32(f32),
    F64(f64),
    I64(i64),
    Bool(bool),
}

/// Framework assumptions for a CPU artifact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuFrameworkContract {
    pub platform: String,
    pub accelerate_framework_version: Option<String>,
    pub routine: String,
    pub vectorization_policy: String,
    pub deterministic_mode: bool,
}

/// Admission status for a CPU artifact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuArtifactAdmission {
    pub admitted: bool,
    pub admission_timestamp: Option<String>,
    pub qualified_by: Option<String>,
}

/// Sealed Accelerate artifact — a validated CPU execution recipe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccelerateArtifact {
    pub artifact_id: String,
    pub artifact_hash: String,
    pub abi_version: u32,
    /// Which CPU implementation backs this artifact.
    pub implementation: CpuImplementation,
    pub op: AccelerateOp,
    pub dtype: String,
    /// Shape contract for the primary operand.
    pub shape_contract: CpuShapeContract,
    /// Layout contract — row major, contiguous, alignment.
    pub layout_contract: CpuLayoutContract,
    /// Scalar parameters keyed by name (e.g. epsilon).
    pub scalar_params: std::collections::BTreeMap<String, ScalarValue>,
    /// Required element alignment in bytes.
    pub alignment: usize,
    /// Framework assumptions for this artifact.
    pub framework_contract: CpuFrameworkContract,
    /// Admission status.
    pub admission: CpuArtifactAdmission,
}

// ── CPU kernel implementations ─────────────────────────────────────────────

/// Execute an Accelerate RMSNorm on raw f32 buffers.
///
/// out[i] = x[i] / sqrt(mean(x^2) + eps) * w[i / stride]
/// where stride = hidden_size (weight is per-element, reshaped).
pub fn rms_norm_f32(x: &[f32], weight: &[f32], eps: f64) -> Result<Vec<f32>, String> {
    let n = x.len();
    if n == 0 {
        return Err("rms_norm: empty input".into());
    }
    if weight.len() != n {
        return Err(format!(
            "rms_norm: x len {} != weight len {}",
            n,
            weight.len()
        ));
    }

    let mean_sq: f32 = x.iter().map(|&v| v * v).sum::<f32>() / n as f32;
    let rstd = (1.0 / (mean_sq as f64 + eps).sqrt()) as f32;

    let out: Vec<f32> = x
        .iter()
        .zip(weight.iter())
        .map(|(&xi, &wi)| xi * rstd * wi)
        .collect();
    Ok(out)
}

/// Execute an element-wise add on raw f32 buffers.
pub fn add_f32(a: &[f32], b: &[f32]) -> Result<Vec<f32>, String> {
    if a.len() != b.len() {
        return Err(format!("add: a len {} != b len {}", a.len(), b.len()));
    }
    Ok(a.iter().zip(b.iter()).map(|(&x, &y)| x + y).collect())
}

/// Execute an element-wise multiply on raw f32 buffers.
pub fn mul_f32(a: &[f32], b: &[f32]) -> Result<Vec<f32>, String> {
    if a.len() != b.len() {
        return Err(format!("mul: a len {} != b len {}", a.len(), b.len()));
    }
    Ok(a.iter().zip(b.iter()).map(|(&x, &y)| x * y).collect())
}

/// Execute SiLU on raw f32 buffers.
pub fn silu_f32(x: &[f32]) -> Vec<f32> {
    x.iter().map(|&v| v / (1.0 + (-v).exp())).collect()
}

// ── vDSP-accelerated kernel implementations ────────────────────────────────

/// Execute an RMSNorm on raw f32 buffers using vDSP primitives.
///
/// out[i] = x[i] / sqrt(mean(x^2) + eps) * w[i]
/// On non-macOS platforms this falls back to the scalar reference.
pub fn vdsp_rms_norm_f32(x: &[f32], weight: &[f32], eps: f64) -> Result<Vec<f32>, String> {
    let n = x.len();
    if n == 0 {
        return Err("rms_norm: empty input".into());
    }
    if weight.len() != n {
        return Err(format!(
            "rms_norm: x len {} != weight len {}",
            n,
            weight.len()
        ));
    }

    #[cfg(target_os = "macos")]
    {
        // Allocate scratch buffers
        let mut squares = vec![0.0f32; n];
        let mut scaled = vec![0.0f32; n];
        let mut out = vec![0.0f32; n];
        let mut sum: f32 = 0.0;

        unsafe {
            // squares[i] = x[i]^2
            accelerate_ffi::vDSP_vsq(x.as_ptr(), 1, squares.as_mut_ptr(), 1, n);

            // *sum = sum(squares)
            accelerate_ffi::vDSP_sve(squares.as_ptr(), 1, &mut sum, n);
        }

        let mean_sq = sum / n as f32;
        let rstd = (1.0 / (mean_sq as f64 + eps).sqrt()) as f32;

        unsafe {
            // scaled[i] = x[i] * rstd
            accelerate_ffi::vDSP_vsmul(x.as_ptr(), 1, &rstd, scaled.as_mut_ptr(), 1, n);

            // out[i] = scaled[i] * weight[i]
            accelerate_ffi::vDSP_vmul(
                scaled.as_ptr(),
                1,
                weight.as_ptr(),
                1,
                out.as_mut_ptr(),
                1,
                n,
            );
        }

        Ok(out)
    }

    #[cfg(not(target_os = "macos"))]
    {
        rms_norm_f32(x, weight, eps)
    }
}

/// Execute an element-wise add on raw f32 buffers using vDSP.
/// On non-macOS platforms this falls back to the scalar reference.
pub fn vdsp_add_f32(a: &[f32], b: &[f32]) -> Result<Vec<f32>, String> {
    if a.len() != b.len() {
        return Err(format!("add: a len {} != b len {}", a.len(), b.len()));
    }

    #[cfg(target_os = "macos")]
    {
        let mut out = vec![0.0f32; a.len()];
        unsafe {
            accelerate_ffi::vDSP_vadd(a.as_ptr(), 1, b.as_ptr(), 1, out.as_mut_ptr(), 1, a.len());
        }
        Ok(out)
    }

    #[cfg(not(target_os = "macos"))]
    {
        add_f32(a, b)
    }
}

/// Execute an element-wise multiply on raw f32 buffers using vDSP.
/// On non-macOS platforms this falls back to the scalar reference.
pub fn vdsp_mul_f32(a: &[f32], b: &[f32]) -> Result<Vec<f32>, String> {
    if a.len() != b.len() {
        return Err(format!("mul: a len {} != b len {}", a.len(), b.len()));
    }

    #[cfg(target_os = "macos")]
    {
        let mut out = vec![0.0f32; a.len()];
        unsafe {
            accelerate_ffi::vDSP_vmul(a.as_ptr(), 1, b.as_ptr(), 1, out.as_mut_ptr(), 1, a.len());
        }
        Ok(out)
    }

    #[cfg(not(target_os = "macos"))]
    {
        mul_f32(a, b)
    }
}

/// Execute SiLU on raw f32 buffers using vDSP.
///
/// siLU(x) = x * sigmoid(x) where sigmoid(x) = 1 / (1 + exp(-x))
/// On non-macOS platforms this falls back to the scalar reference.
pub fn vdsp_silu_f32(x: &[f32]) -> Vec<f32> {
    #[cfg(target_os = "macos")]
    {
        let n = x.len();
        let n_i32 = n as i32;
        let mut neg_x = vec![0.0f32; n];
        let mut exp_neg = vec![0.0f32; n];
        let mut sigmoid = vec![0.0f32; n];
        let one: f32 = 1.0;
        let neg_one: f32 = -1.0;

        unsafe {
            // neg_x[i] = x[i] * (-1)
            accelerate_ffi::vDSP_vsmul(x.as_ptr(), 1, &neg_one, neg_x.as_mut_ptr(), 1, n);

            // exp_neg[i] = exp(-x[i])
            accelerate_ffi::vvexp(exp_neg.as_mut_ptr(), neg_x.as_ptr(), &n_i32);

            // sigmoid[i] = 1.0 + exp_neg[i]
            accelerate_ffi::vDSP_vadd(&one, 0, exp_neg.as_ptr(), 1, sigmoid.as_mut_ptr(), 1, n);

            // sigmoid[i] = 1.0 / (1.0 + exp_neg[i])  (in-place divide)
            accelerate_ffi::vDSP_vdiv(sigmoid.as_ptr(), 1, &one, 0, sigmoid.as_mut_ptr(), 1, n);
        }

        let mut out = vec![0.0f32; n];
        unsafe {
            // out[i] = x[i] * sigmoid[i]
            accelerate_ffi::vDSP_vmul(x.as_ptr(), 1, sigmoid.as_ptr(), 1, out.as_mut_ptr(), 1, n);
        }

        out
    }

    #[cfg(not(target_os = "macos"))]
    {
        silu_f32(x)
    }
}

/// Dispatch an Accelerate artifact on raw CPU buffers.
///
/// Reads input from `input_data`, writes output to the returned Vec,
/// which the graph executor copies to the output region.
pub fn dispatch_accelerate_artifact(
    artifact: &AccelerateArtifact,
    input_data: &[f32],
    weight_data: Option<&[f32]>,
) -> Result<Vec<f32>, String> {
    match artifact.implementation {
        CpuImplementation::AccelerateVdsp => match artifact.op {
            AccelerateOp::RmsNorm { eps } => {
                let w = weight_data.ok_or_else(|| "RMSNorm requires weight data".to_string())?;
                vdsp_rms_norm_f32(input_data, w, eps)
            }
            AccelerateOp::Add => {
                let b = weight_data.ok_or_else(|| "Add requires second operand".to_string())?;
                vdsp_add_f32(input_data, b)
            }
            AccelerateOp::Mul => {
                let b = weight_data.ok_or_else(|| "Mul requires second operand".to_string())?;
                vdsp_mul_f32(input_data, b)
            }
            AccelerateOp::Silu => Ok(vdsp_silu_f32(input_data)),
        },
        _ => match artifact.op {
            AccelerateOp::RmsNorm { eps } => {
                let w = weight_data.ok_or_else(|| "RMSNorm requires weight data".to_string())?;
                rms_norm_f32(input_data, w, eps)
            }
            AccelerateOp::Add => {
                let b = weight_data.ok_or_else(|| "Add requires second operand".to_string())?;
                add_f32(input_data, b)
            }
            AccelerateOp::Mul => {
                let b = weight_data.ok_or_else(|| "Mul requires second operand".to_string())?;
                mul_f32(input_data, b)
            }
            AccelerateOp::Silu => Ok(silu_f32(input_data)),
        },
    }
}
// ── Artifact factory ──────────────────────────────────────────────────────

/// Build an Accelerate RMSNorm artifact.
pub fn build_rmsnorm_artifact(artifact_id: &str, hidden_size: i64) -> AccelerateArtifact {
    let mut scalar_params = std::collections::BTreeMap::new();
    scalar_params.insert("epsilon".into(), ScalarValue::F64(1e-6));
    AccelerateArtifact {
        artifact_id: artifact_id.to_string(),
        artifact_hash: String::new(),
        abi_version: 1,
        implementation: CpuImplementation::ScalarReference,
        op: AccelerateOp::RmsNorm { eps: 1e-6 },
        dtype: "float32".into(),
        shape_contract: CpuShapeContract {
            rows: 1,
            cols: hidden_size as u64,
            dims: vec![1, hidden_size as u64],
        },
        layout_contract: CpuLayoutContract {
            row_major: true,
            contiguous: true,
            alignment: 64,
        },
        scalar_params,
        alignment: 64,
        framework_contract: CpuFrameworkContract {
            platform: "macos".into(),
            accelerate_framework_version: None,
            routine: "scalar".into(),
            vectorization_policy: "none".into(),
            deterministic_mode: true,
        },
        admission: CpuArtifactAdmission {
            admitted: false,
            admission_timestamp: None,
            qualified_by: None,
        },
    }
}

/// Build an Accelerate residual-add artifact.
pub fn build_residual_add_artifact(artifact_id: &str, hidden_size: i64) -> AccelerateArtifact {
    AccelerateArtifact {
        artifact_id: artifact_id.to_string(),
        artifact_hash: String::new(),
        abi_version: 1,
        implementation: CpuImplementation::ScalarReference,
        op: AccelerateOp::Add,
        dtype: "float32".into(),
        shape_contract: CpuShapeContract {
            rows: 1,
            cols: hidden_size as u64,
            dims: vec![1, hidden_size as u64],
        },
        layout_contract: CpuLayoutContract {
            row_major: true,
            contiguous: true,
            alignment: 64,
        },
        scalar_params: std::collections::BTreeMap::new(),
        alignment: 64,
        framework_contract: CpuFrameworkContract {
            platform: "macos".into(),
            accelerate_framework_version: None,
            routine: "scalar".into(),
            vectorization_policy: "none".into(),
            deterministic_mode: true,
        },
        admission: CpuArtifactAdmission {
            admitted: false,
            admission_timestamp: None,
            qualified_by: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_norm_known_values() {
        let x = vec![1.0f32, 2.0, 3.0, 4.0];
        let w = vec![0.5f32; 4];
        let result = rms_norm_f32(&x, &w, 1e-6).unwrap();
        assert_eq!(result.len(), 4);
        // Expected: x / sqrt(mean_sq + eps) * w
        let mean_sq: f64 = (1.0f64 + 4.0 + 9.0 + 16.0) / 4.0; // 7.5
        let rstd = (1.0f64 / (mean_sq + 1e-6).sqrt()) as f32;
        for i in 0..4 {
            let expected = x[i] * rstd * 0.5f32;
            assert!(
                (result[i] - expected).abs() < 1e-5,
                "mismatch at {i}: got {}, expected {}",
                result[i],
                expected
            );
        }
    }

    #[test]
    fn add_known_values() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![4.0, 5.0, 6.0];
        let result = add_f32(&a, &b).unwrap();
        assert_eq!(result, vec![5.0, 7.0, 9.0]);
    }

    #[test]
    fn silu_known_values() {
        let x = vec![0.0, 1.0, -1.0, 2.0];
        let result = silu_f32(&x);
        // siLU(0) = 0
        assert!((result[0] - 0.0).abs() < 1e-5);
        // siLU(1) = 1 / (1 + e^-1) ≈ 0.731
        assert!((result[1] - (1.0 / (1.0 + (-1.0f32).exp()))).abs() < 1e-5);
        // siLU(-1) = -1 / (1 + e^1) ≈ -0.269
        assert!((result[2] - (-1.0 / (1.0 + 1.0f32.exp()))).abs() < 1e-5);
    }
}
