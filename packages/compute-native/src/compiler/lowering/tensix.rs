use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct TensixLayoutReceipt {
    pub logical_shape: Vec<usize>,
    pub physical_shape: Vec<usize>,
    pub source_segment_hash: String,
    pub transformed_segment_hash: String,
    pub layout_convention: String,
    pub memory_placement: String,
}

pub fn transform_tensix_bf16(
    source_bytes: &[u8],
    logical_shape: &[usize],
) -> Result<(Vec<u8>, TensixLayoutReceipt), String> {
    if logical_shape.len() != 2 {
        return Err("Only 2D tensors are supported for Tensix tiling".into());
    }

    let k = logical_shape[0];
    let n = logical_shape[1];

    let mut source_hasher = Sha256::new();
    source_hasher.update(source_bytes);
    let source_hash = format!("{:x}", source_hasher.finalize());

    let tile_size = 32;
    let k_padded = (k + tile_size - 1) / tile_size * tile_size;
    let n_padded = (n + tile_size - 1) / tile_size * tile_size;

    let k_tiles = k_padded / tile_size;
    let n_tiles = n_padded / tile_size;

    let mut dest_bytes = vec![0u8; k_padded * n_padded * 2]; // 2 bytes for BF16

    for kt in 0..k_tiles {
        for nt in 0..n_tiles {
            for ki in 0..tile_size {
                for ni in 0..tile_size {
                    let dest_idx =
                        ((kt * n_tiles + nt) * tile_size * tile_size + ki * tile_size + ni) * 2;
                    let src_k = kt * tile_size + ki;
                    let src_n = nt * tile_size + ni;

                    if src_k < k && src_n < n {
                        let src_idx = (src_k * n + src_n) * 2;
                        dest_bytes[dest_idx] = source_bytes[src_idx];
                        dest_bytes[dest_idx + 1] = source_bytes[src_idx + 1];
                    }
                }
            }
        }
    }

    let mut dest_hasher = Sha256::new();
    dest_hasher.update(&dest_bytes);
    let dest_hash = format!("{:x}", dest_hasher.finalize());

    let receipt = TensixLayoutReceipt {
        logical_shape: logical_shape.to_vec(),
        physical_shape: vec![k_tiles, n_tiles, tile_size, tile_size],
        source_segment_hash: source_hash,
        transformed_segment_hash: dest_hash,
        layout_convention: "tensix-tile-32x32".into(),
        memory_placement: "dram".into(),
    };

    Ok((dest_bytes, receipt))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tensix_transform() {
        let k = 64;
        let n = 64;
        let source_bytes = vec![1u8; k * n * 2];
        let shape = vec![k, n];

        let (transformed, receipt) = transform_tensix_bf16(&source_bytes, &shape).unwrap();

        assert_eq!(transformed.len(), 64 * 64 * 2);
        assert_eq!(receipt.logical_shape, vec![64, 64]);
        assert_eq!(receipt.physical_shape, vec![2, 2, 32, 32]);
        assert_eq!(receipt.layout_convention, "tensix-tile-32x32");
        assert_eq!(receipt.memory_placement, "dram");
    }

    #[test]
    fn test_tensix_transform_padded() {
        let k = 30;
        let n = 30;
        let source_bytes = vec![1u8; k * n * 2];
        let shape = vec![k, n];

        let (transformed, receipt) = transform_tensix_bf16(&source_bytes, &shape).unwrap();

        assert_eq!(transformed.len(), 32 * 32 * 2);
        assert_eq!(receipt.logical_shape, vec![30, 30]);
        assert_eq!(receipt.physical_shape, vec![1, 1, 32, 32]);
    }
}
