use crate::compiler::lowering::tensix::{transform_tensix_bf16, TensixLayoutReceipt};

#[derive(Debug, Clone)]
pub struct TensixWeightLayout {
    pub receipt: TensixLayoutReceipt,
    pub original_size_bytes: usize,
    pub transformed_size_bytes: usize,
}

/// A compilation pass/hook for lowering weights to a Tensix-friendly layout.
/// Consumes raw tensor bytes and logical shape, and produces transformed
/// bytes along with a `TensixWeightLayout` receipt.
pub fn lower_weight_to_tensix(
    source_bytes: &[u8],
    logical_shape: &[usize],
) -> Result<(Vec<u8>, TensixWeightLayout), String> {
    let original_size_bytes = source_bytes.len();

    let (transformed_bytes, layout_receipt) = transform_tensix_bf16(source_bytes, logical_shape)?;
    let transformed_size_bytes = transformed_bytes.len();

    let weight_layout = TensixWeightLayout {
        receipt: layout_receipt,
        original_size_bytes,
        transformed_size_bytes,
    };

    Ok((transformed_bytes, weight_layout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lower_weight_to_tensix() {
        let k = 64;
        let n = 64;
        let source_bytes = vec![1u8; k * n * 2]; // Dummy BF16 tensor
        let shape = vec![k, n];

        let (transformed_bytes, layout) = lower_weight_to_tensix(&source_bytes, &shape).unwrap();

        assert_eq!(layout.original_size_bytes, 8192); // 64 * 64 * 2
        assert_eq!(layout.transformed_size_bytes, 8192); // 32x32 tiles require exact same space
        assert_eq!(transformed_bytes.len(), 8192);
        assert_eq!(layout.receipt.logical_shape, vec![64, 64]);
        assert_eq!(layout.receipt.physical_shape, vec![2, 2, 32, 32]);
        assert_eq!(layout.receipt.layout_convention, "tensix-tile-32x32");
        assert_eq!(layout.receipt.memory_placement, "dram");
    }

    #[test]
    fn test_lower_weight_to_tensix_with_padding() {
        let k = 30;
        let n = 30;
        let source_bytes = vec![1u8; k * n * 2];
        let shape = vec![k, n];

        let (transformed_bytes, layout) = lower_weight_to_tensix(&source_bytes, &shape).unwrap();

        assert_eq!(layout.original_size_bytes, 1800); // 30 * 30 * 2
        assert_eq!(layout.transformed_size_bytes, 2048); // (32 * 32) * 2
        assert_eq!(transformed_bytes.len(), 2048);
        assert_eq!(layout.receipt.logical_shape, vec![30, 30]);
        assert_eq!(layout.receipt.physical_shape, vec![1, 1, 32, 32]);
    }
}
