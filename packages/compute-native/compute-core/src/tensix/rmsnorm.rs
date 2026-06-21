use super::artifact::{TensixComputeArtifact, TensixKernelOp};
use crate::backend::DType;
use crate::contracts::transformer::RmsNormContract;

pub fn generate_rmsnorm_artifact(
    contract: &RmsNormContract,
) -> Result<TensixComputeArtifact, String> {
    // Check DType
    if contract.dtype != DType::F16 && contract.dtype != DType::Bf16 {
        return Err("RMSNorm requires FP16 or BF16 DType".into());
    }

    // Shape coverage check for RMSNorm: [1, d] and [B, d]
    if contract.input_shape.len() != 2
        || contract.weight_shape.len() != 1
        || contract.output_shape.len() != 2
    {
        return Err("RMSNorm shapes must be 2D [B, d_model] and 1D [d_model]".into());
    }

    let d_model = contract.input_shape[1];

    // Check multiple of 32
    if d_model % 32 != 0 {
        return Err("RMSNorm dimensions must be multiples of 32 for tile alignment".into());
    }

    Ok(TensixComputeArtifact {
        manifest_format: "session-17".into(),
        op_type: "rmsnorm".into(),
        input_cb_depth: 2,
        output_cb_depth: 2,
        grid_size: (1, 1),
        hash: format!(
            "rmsnorm-{}-{}-{}",
            d_model, contract.eps, contract.input_shape[0]
        ),
        kernel: TensixKernelOp {
            name: "rmsnorm".into(),
            reader_kernel: "read_interleaved_rmsnorm".into(),
            compute_kernel: "compute_rmsnorm_tile".into(),
            writer_kernel: "write_interleaved_rmsnorm".into(),
        },
    })
}
