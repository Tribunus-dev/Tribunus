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
                "attention_cooperative".to_string(),
                "subgroup_online_softmax".to_string(),
                "matmul".to_string(),
                "sparse_ffn_swiglu".to_string(),
            ],
        }
    }

    /// Megakernel 3: Sampling (dropped when temp = 0)
    pub fn fuse_sampling(layer_idx: usize) -> Self {
        Self {
            name: format!("layer_{}_fused_sampling", layer_idx),
            operations: vec![
                "temperature_scaling".to_string(),
                "top_p".to_string(),
                "top_k".to_string(),
                "categorical_sample".to_string(),
            ],
        }
    }
}
