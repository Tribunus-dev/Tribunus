pub fn rms_norm(input: &[f32], weight: &[f32], eps: f32) -> Vec<f32> {
    let n = input.len();
    let mean_sq = input.iter().map(|x| x * x).sum::<f32>() / n as f32;
    let rsqrt = 1.0 / (mean_sq + eps).sqrt();
    input.iter().zip(weight.iter()).map(|(x, w)| x * rsqrt * w).collect()
}

pub fn matmul(input: &[f32], weight: &[f32], m: usize, k: usize, n: usize) -> Vec<f32> {
    let mut output = vec![0.0f32; m * n];
    for i in 0..m {
        for p in 0..k {
            let a_ip = input[i * k + p];
            for j in 0..n {
                output[i * n + j] += a_ip * weight[p * n + j];
            }
        }
    }
    output
}

pub fn silu(x: f32) -> f32 {
    x / (1.0 + (-x).exp())
}

pub fn elementwise_add(a: &[f32], b: &[f32]) -> Vec<f32> {
    a.iter().zip(b.iter()).map(|(x, y)| x + y).collect()
}

pub fn elementwise_mul(a: &[f32], b: &[f32]) -> Vec<f32> {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).collect()
}

pub fn attention_decode(
    input: &[f32],
    qkv_weights: &[f32],
    o_weights: &[f32],
    _kv_cache: Option<&[f32]>,
    num_heads: usize,
    num_kv_heads: usize,
    head_dim: usize,
) -> Vec<f32> {
    let hidden_size = input.len();
    let q_dim = num_heads * head_dim;
    let kv_dim = num_kv_heads * head_dim;
    let qkv_out_dim = q_dim + 2 * kv_dim;

    let qkv = matmul(input, qkv_weights, 1, hidden_size, qkv_out_dim);

    // For a pure single-token reference without cache, attention is trivial:
    // softmax([Q * K^T]) * V  =>  1.0 * V  =>  V
    // But we need to handle GQA properly.
    // Q: [num_heads, head_dim]
    // K: [num_kv_heads, head_dim]
    // V: [num_kv_heads, head_dim]

    let mut q = vec![0.0f32; q_dim];
    let mut k = vec![0.0f32; kv_dim];
    let mut v = vec![0.0f32; kv_dim];

    q.copy_from_slice(&qkv[0..q_dim]);
    k.copy_from_slice(&qkv[q_dim..q_dim + kv_dim]);
    v.copy_from_slice(&qkv[q_dim + kv_dim..]);

    let mut attn_out = vec![0.0f32; q_dim];
    let heads_per_kv = num_heads / num_kv_heads;

    for h in 0..num_heads {
        let kv_h = h / heads_per_kv;
        for d in 0..head_dim {
            // Simplified: dot product of query and key
            let mut _score = 0.0;
            for i in 0..head_dim {
                _score += q[h * head_dim + i] * k[kv_h * head_dim + i];
            }
            // For sequence length 1, softmax is 1.0
            attn_out[h * head_dim + d] = v[kv_h * head_dim + d];
        }
    }

    matmul(&attn_out, o_weights, 1, q_dim, hidden_size)
}

pub fn mlp_proj(
    input: &[f32],
    gate_up_weights: &[f32],
    down_weights: &[f32],
    hidden_size: usize,
    ffn_hidden_size: usize,
) -> Vec<f32> {
    let gate_up = matmul(input, gate_up_weights, 1, hidden_size, ffn_hidden_size * 2);

    let mut gate = vec![0.0f32; ffn_hidden_size];
    let mut up = vec![0.0f32; ffn_hidden_size];

    gate.copy_from_slice(&gate_up[0..ffn_hidden_size]);
    up.copy_from_slice(&gate_up[ffn_hidden_size..]);

    let silu_gate: Vec<f32> = gate.iter().map(|&x| silu(x)).collect();
    let activated = elementwise_mul(&silu_gate, &up);

    matmul(&activated, down_weights, 1, ffn_hidden_size, hidden_size)
}

pub fn combined_block(
    input: &[f32],
    rms_weights_1: &[f32],
    qkv_weights: &[f32],
    o_weights: &[f32],
    rms_weights_2: &[f32],
    gate_up_weights: &[f32],
    down_weights: &[f32],
    num_heads: usize,
    num_kv_heads: usize,
    head_dim: usize,
    hidden_size: usize,
    ffn_hidden_size: usize,
) -> Vec<f32> {
    // 1. RMSNorm
    let norm1 = rms_norm(input, rms_weights_1, 1e-5);

    // 2. Attention
    let attn_out = attention_decode(
        &norm1,
        qkv_weights,
        o_weights,
        None,
        num_heads,
        num_kv_heads,
        head_dim,
    );

    // 3. Residual
    let res1 = elementwise_add(input, &attn_out);

    // 4. RMSNorm
    let norm2 = rms_norm(&res1, rms_weights_2, 1e-5);

    // 5. MLP
    let mlp_out = mlp_proj(&norm2, gate_up_weights, down_weights, hidden_size, ffn_hidden_size);

    // 6. Residual
    elementwise_add(&res1, &mlp_out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rms_norm() {
        let input = vec![1.0, 2.0, 3.0, 4.0];
        let weights = vec![1.0, 1.0, 1.0, 1.0];
        let eps = 1e-5;
        let out = rms_norm(&input, &weights, eps);
        assert_eq!(out.len(), 4);

        let mean_sq = (1.0 + 4.0 + 9.0 + 16.0) / 4.0;
        let rsqrt = 1.0 / (mean_sq + eps).sqrt();
        assert!((out[0] - 1.0 * rsqrt).abs() < 1e-5);
    }
}
