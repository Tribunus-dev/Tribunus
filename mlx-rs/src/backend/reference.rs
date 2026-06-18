//! Naive CPU implementations of core ops for verification/conformance.
//! This module has zero dependency on MLX backend.

pub fn identity_f32(data: &[f32]) -> Vec<f32> {
    data.to_vec()
}

pub fn add_f32(a: &[f32], b: &[f32]) -> Vec<f32> {
    assert_eq!(a.len(), b.len(), "Reference Add requires same length");
    a.iter().zip(b.iter()).map(|(x, y)| x + y).collect()
}

pub fn mul_f32(a: &[f32], b: &[f32]) -> Vec<f32> {
    assert_eq!(a.len(), b.len(), "Reference Mul requires same length");
    a.iter().zip(b.iter()).map(|(x, y)| x * y).collect()
}

pub fn sigmoid_f32(data: &[f32]) -> Vec<f32> {
    data.iter().map(|&x| 1.0 / (1.0 + (-x).exp())).collect()
}

pub fn silu_f32(data: &[f32]) -> Vec<f32> {
    data.iter().map(|&x| x / (1.0 + (-x).exp())).collect()
}

/// Naive 2D Matrix multiplication.
/// `a` is [m, k], `b` is [k, n]. Result is [m, n].
pub fn matmul_f32(a: &[f32], b: &[f32], m: usize, k: usize, n: usize) -> Vec<f32> {
    assert_eq!(a.len(), m * k, "A shape mismatch");
    assert_eq!(b.len(), k * n, "B shape mismatch");
    let mut out = vec![0.0; m * n];
    for i in 0..m {
        for j in 0..n {
            let mut sum = 0.0;
            for p in 0..k {
                sum += a[i * k + p] * b[p * n + j];
            }
            out[i * n + j] = sum;
        }
    }
    out
}

pub fn reshape_f32(data: &[f32], new_len: usize) -> Vec<f32> {
    assert_eq!(
        data.len(),
        new_len,
        "Reshape requires same number of elements"
    );
    data.to_vec()
}

/// Naive 2D Transpose.
/// `data` is [r, c]. Result is [c, r].
pub fn transpose_f32(data: &[f32], r: usize, c: usize) -> Vec<f32> {
    assert_eq!(data.len(), r * c, "Shape mismatch");
    let mut out = vec![0.0; r * c];
    for i in 0..r {
        for j in 0..c {
            out[j * r + i] = data[i * c + j];
        }
    }
    out
}

/// Naive Softmax over the last dimension `c`.
/// `data` is considered to be [r, c].
pub fn softmax_f32(data: &[f32], r: usize, c: usize) -> Vec<f32> {
    assert_eq!(data.len(), r * c, "Shape mismatch");
    let mut out = vec![0.0; r * c];
    for i in 0..r {
        let row_start = i * c;
        let row_end = row_start + c;
        let row = &data[row_start..row_end];

        let max_val = row.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
        let mut sum_exp = 0.0;
        for j in 0..c {
            let exp_val = (row[j] - max_val).exp();
            out[row_start + j] = exp_val;
            sum_exp += exp_val;
        }
        for j in 0..c {
            out[row_start + j] /= sum_exp;
        }
    }
    out
}
