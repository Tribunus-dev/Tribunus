use super::error::{MlxError, MlxResult};
use crate::Array;

pub fn eval_array(array: &Array) -> MlxResult<()> {
    array.eval().map_err(|e| MlxError::EvaluationFailed(e.what))
}

pub fn eval_arrays(arrays: &[&Array]) -> MlxResult<()> {
    crate::transforms::eval(arrays.iter().map(|a| *a))
        .map_err(|e| MlxError::EvaluationFailed(e.what))
}

/// Reads back a Float32 array into a standard Rust Vec<f32> logically as a row-major format.
pub fn readback_f32(array: &Array) -> MlxResult<Vec<f32>> {
    if array.dtype() != crate::Dtype::Float32 {
        return Err(MlxError::UnsupportedDType);
    }

    // Materialize as a row-contiguous array first
    // If there are strides or views, we ensure we return logical storage
    // MLX ops::identity returns a new array, forcing the strided representation
    // to map down if MLX decides to. We could also just try `array.item::<f32>()` element-by-element but that's slow.
    // However, MLX C has `mlx_copy` or equivalent via `identity` but no explicit `contiguous` exposed.
    // For now we will rely on mlx array's internal layout unless it fails.

    // Attempting an op that forces materialization over views:
    // Adding 0.0 forces a contiguous new array in MLX if it was strided.
    // MLX flatten enforces contiguous materialization locally.
    let contiguous = match crate::ops::flatten(array, 0, array.ndim() as i32 - 1) {
        Ok(c) => c,
        Err(e) => {
            return Err(MlxError::ReadbackFailed(format!(
                "Failed to force materialization: {}",
                e.what
            )))
        }
    };

    eval_array(&contiguous)?;

    // as_slice() forces evaluation if not already evaluated.
    let slice: &[f32] = contiguous.as_slice();
    Ok(slice.to_vec())
}
