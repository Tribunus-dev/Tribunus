use super::artifact::{TensixComputeArtifact, TensixKernelOp};
use crate::backend::DType;
use crate::contracts::transformer::RopeContract;

pub fn generate_rope_artifact(contract: &RopeContract) -> Result<TensixComputeArtifact, String> {
    // Check DType
    if contract.dtype != DType::F16 && contract.dtype != DType::Bf16 {
        return Err("RoPE requires FP16 or BF16 DType".into());
    }

    // Rope shape check: single-position decode and short-sequence prefill
    // Decode: [1, n_heads, d_head] or Prefill: [seq_len, n_heads, d_head]
    if contract.query_shape.len() != 3 {
        return Err("RoPE query shape must be 3D [seq_len, n_heads, d_head]".into());
    }

    let d_head = contract.query_shape[2];

    // Check multiple of 32
    if d_head % 32 != 0 {
        return Err("RoPE head dimension must be multiple of 32 for tile alignment".into());
    }

    Ok(TensixComputeArtifact {
        manifest_format: "session-17".into(),
        op_type: "rope".into(),
        input_cb_depth: 2,
        output_cb_depth: 2,
        grid_size: (1, 1),
        hash: format!("rope-{}-{}", d_head, contract.max_seq_len),
        kernel: TensixKernelOp {
            name: "rope".into(),
            reader_kernel: "read_rope_inputs_with_tables".into(),
            compute_kernel: "compute_rope_rotation".into(),
            writer_kernel: "write_rope_outputs".into(),
        },
    })
}
