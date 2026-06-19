/// Represents a fused megakernel
pub struct Megakernel {
    pub name: String,
    pub operations: Vec<String>,
}

impl Megakernel {
    /// Megakernel 1: RMS norm + QKV matmul + RoPE
    /// All kept in registers
    pub fn fuse_qkv(layer_idx: usize) -> Self {
        Self {
            name: format!("layer_{}_fused_qkv", layer_idx),
            operations: vec![
                "rms_norm".to_string(),
                "qkv_matmul".to_string(),
                "rope".to_string(),
            ],
        }
    }

    /// Megakernel 2: Attention + Matmul + SwiGLU
    pub fn fuse_attn_mlp(layer_idx: usize) -> Self {
        Self {
            name: format!("layer_{}_fused_attn_mlp", layer_idx),
            operations: vec![
                "attention".to_string(),
                "matmul".to_string(),
                "swiglu".to_string(),
            ],
        }
    }
}
