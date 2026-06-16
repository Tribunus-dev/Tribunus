//! Compatibility layer for MLX backend API shims (MlxApiCompat).
//! Handles attention-mask API migration and optional int/dtype shapes for quantization.

use mlx_rs::Array;
use std::ffi::CStr;

pub struct MlxApiCompat;

/// Enum representing the attention mask strategy.
pub enum CompatAttentionMask<'a> {
    None,
    Causal,
    Array(&'a Array),
}

impl MlxApiCompat {
    /// Return the mode and raw MLX array pointer for Scaled Dot Product Attention (SDPA).
    /// Handles the API change from VectorArray to a single Array pointer.
    pub fn get_sdpa_mask_params<'a>(
        mask: &CompatAttentionMask<'a>,
    ) -> (&'static CStr, mlx_sys::mlx_array) {
        const DEFAULT_MASK_MODE: &[u8] = b"default\0";
        const CAUSAL_MASK_MODE: &[u8] = b"causal\0";

        let default_mode = unsafe { CStr::from_bytes_with_nul_unchecked(DEFAULT_MASK_MODE) };
        let causal_mode = unsafe { CStr::from_bytes_with_nul_unchecked(CAUSAL_MASK_MODE) };

        match mask {
            CompatAttentionMask::None => (default_mode, unsafe { mlx_sys::mlx_array_new() }),
            CompatAttentionMask::Causal => (causal_mode, unsafe { mlx_sys::mlx_array_new() }),
            CompatAttentionMask::Array(arr) => (default_mode, arr.as_ptr()),
        }
    }

    /// Construct the optional int type for quantization parameters, adapting to raw vs optional wrappers.
    pub fn optional_int(value: i32) -> mlx_sys::mlx_optional_int_ {
        mlx_sys::mlx_optional_int_ {
            value,
            has_value: true,
        }
    }

    /// Construct the optional dtype none placeholder.
    pub fn optional_dtype_none() -> mlx_sys::mlx_optional_dtype_ {
        mlx_sys::mlx_optional_dtype_ {
            value: 0,
            has_value: false,
        }
    }
}
