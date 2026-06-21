use serde::{Deserialize, Serialize};

use super::reference;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TolerancePolicy {
    pub max_absolute_error: f32,
    pub max_relative_error: f32,
    pub cosine_similarity: f32,
}

impl Default for TolerancePolicy {
    fn default() -> Self {
        Self {
            max_absolute_error: 1e-4,
            max_relative_error: 1e-3,
            cosine_similarity: 0.9999,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageFixture {
    pub name: String,
    pub input: Vec<f32>,
    pub weights: Vec<f32>,
    pub expected_output: Vec<f32>,
    pub tolerance: TolerancePolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionFixture {
    pub name: String,
    pub input: Vec<f32>,          // [1, hidden_size]
    pub qkv_weights: Vec<f32>,    // [hidden_size, (num_heads + 2 * num_kv_heads) * head_dim]
    pub o_weights: Vec<f32>,      // [num_heads * head_dim, hidden_size]
    pub kv_cache: Option<Vec<f32>>,
    pub expected_output: Vec<f32>, // [1, hidden_size]
    pub tolerance: TolerancePolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformerSliceFixture {
    pub hidden_size: usize,
    pub num_heads: usize,
    pub head_dim: usize,
    pub num_kv_heads: usize,
    pub ffn_hidden_size: usize,

    pub rms_norm: StageFixture,
    pub qkv_proj: StageFixture,
    pub attn_decode: AttentionFixture,
    pub mlp_proj: StageFixture,
    pub combined_block: StageFixture,
}

impl TransformerSliceFixture {
    /// Generate deterministic input values.
    fn seeded_f32(seed: u64, len: usize) -> Vec<f32> {
        let mut state = seed;
        let mut out = vec![0.0f32; len];
        for v in out.iter_mut() {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            // keep it relatively small but deterministic
            *v = ((state >> 32) as i32 as f32) * 1.0e-5_f32;
        }
        out
    }

    /// Build the standard model-slice fixture.
    pub fn new() -> Self {
        let hidden_size = 64; // downscaled for fixture
        let num_heads = 4;
        let head_dim = 16;
        let num_kv_heads = 2;
        let ffn_hidden_size = 128;

        // 1. RMSNorm
        let rms_input = Self::seeded_f32(1, hidden_size);
        let rms_weights = Self::seeded_f32(2, hidden_size);
        let rms_expected = reference::rms_norm(&rms_input, &rms_weights, 1e-5);
        let rms_norm = StageFixture {
            name: "RMSNorm".to_string(),
            input: rms_input.clone(),
            weights: rms_weights.clone(),
            expected_output: rms_expected.clone(),
            tolerance: TolerancePolicy::default(),
        };

        // 2. QKV Projection
        let qkv_input = rms_expected.clone();
        let qkv_out_dim = (num_heads + 2 * num_kv_heads) * head_dim;
        let qkv_weights = Self::seeded_f32(3, hidden_size * qkv_out_dim);
        let qkv_expected = reference::matmul(&qkv_input, &qkv_weights, 1, hidden_size, qkv_out_dim);
        let qkv_proj = StageFixture {
            name: "QKV Projection".to_string(),
            input: qkv_input.clone(),
            weights: qkv_weights.clone(),
            expected_output: qkv_expected.clone(),
            tolerance: TolerancePolicy::default(),
        };

        // 3. Attention Decode
        let attn_input = rms_expected.clone();
        let o_weights = Self::seeded_f32(4, (num_heads * head_dim) * hidden_size);
        let attn_expected = reference::attention_decode(
            &attn_input,
            &qkv_weights,
            &o_weights,
            None,
            num_heads,
            num_kv_heads,
            head_dim
        );
        let attn_decode = AttentionFixture {
            name: "Attention Decode".to_string(),
            input: attn_input.clone(),
            qkv_weights: qkv_weights.clone(),
            o_weights: o_weights.clone(),
            kv_cache: None,
            expected_output: attn_expected.clone(),
            tolerance: TolerancePolicy::default(),
        };

        // 4. MLP Projection (Gate + Up, SiLU, Down)
        let mlp_input = attn_expected.clone(); // Residual usually happens, but keeping it simple for isolation
        let gate_up_dim = ffn_hidden_size * 2;
        let gate_up_weights = Self::seeded_f32(5, hidden_size * gate_up_dim);
        let down_weights = Self::seeded_f32(6, ffn_hidden_size * hidden_size);

        let mut mlp_weights = gate_up_weights.clone();
        mlp_weights.extend(&down_weights);

        let mlp_expected = reference::mlp_proj(&mlp_input, &gate_up_weights, &down_weights, hidden_size, ffn_hidden_size);

        let mlp_proj = StageFixture {
            name: "MLP Projection".to_string(),
            input: mlp_input.clone(),
            weights: mlp_weights.clone(),
            expected_output: mlp_expected.clone(),
            tolerance: TolerancePolicy::default(),
        };

        // 5. Combined Block
        // Residual paths included
        let block_input = Self::seeded_f32(7, hidden_size);
        let block_expected = reference::combined_block(
            &block_input,
            &rms_weights,
            &qkv_weights,
            &o_weights,
            &rms_weights, // using same rms weights for post-attention norm
            &gate_up_weights,
            &down_weights,
            num_heads,
            num_kv_heads,
            head_dim,
            hidden_size,
            ffn_hidden_size
        );

        let mut combined_weights = rms_weights.clone();
        combined_weights.extend(&qkv_weights);
        combined_weights.extend(&o_weights);
        combined_weights.extend(&rms_weights);
        combined_weights.extend(&gate_up_weights);
        combined_weights.extend(&down_weights);

        let combined_block = StageFixture {
            name: "Combined Decoder Block".to_string(),
            input: block_input.clone(),
            weights: combined_weights,
            expected_output: block_expected,
            tolerance: TolerancePolicy::default(),
        };

        Self {
            hidden_size,
            num_heads,
            head_dim,
            num_kv_heads,
            ffn_hidden_size,
            rms_norm,
            qkv_proj,
            attn_decode,
            mlp_proj,
            combined_block,
        }
    }
}

impl Default for TransformerSliceFixture {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transformer_slice_fixture_consistency() {
        let fixture = TransformerSliceFixture::new();

        // Basic shape assertions
        assert_eq!(fixture.rms_norm.input.len(), fixture.hidden_size);
        assert_eq!(fixture.rms_norm.expected_output.len(), fixture.hidden_size);

        // Make sure CombinedBlock matches the expected dimension
        assert_eq!(fixture.combined_block.expected_output.len(), fixture.hidden_size);
    }
}
