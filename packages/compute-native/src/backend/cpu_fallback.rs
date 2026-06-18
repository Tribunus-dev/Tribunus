use std::ptr;

pub fn transpose_f32(m: usize, n: usize, src: &[f32], dst: &mut [f32]) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx2") {
            transpose_avx2(m, n, src, dst);
            return;
        }
    }
    transpose_scalar(m, n, src, dst);
}

#[cfg(target_arch = "x86_64")]
fn transpose_avx2(m: usize, n: usize, src: &[f32], dst: &mut [f32]) {
    use core::arch::x86_64::*;
    // Naive AVX2 4x4 transpose if m and n are multiples of 4
    if m % 4 == 0 && n % 4 == 0 {
        unsafe {
            for i in (0..m).step_by(4) {
                for j in (0..n).step_by(4) {
                    let mut row0 = _mm_loadu_ps(src.as_ptr().add(i * n + j));
                    let mut row1 = _mm_loadu_ps(src.as_ptr().add((i + 1) * n + j));
                    let mut row2 = _mm_loadu_ps(src.as_ptr().add((i + 2) * n + j));
                    let mut row3 = _mm_loadu_ps(src.as_ptr().add((i + 3) * n + j));

                    _MM_TRANSPOSE4_PS!(row0, row1, row2, row3);

                    _mm_storeu_ps(dst.as_mut_ptr().add(j * m + i), row0);
                    _mm_storeu_ps(dst.as_mut_ptr().add((j + 1) * m + i), row1);
                    _mm_storeu_ps(dst.as_mut_ptr().add((j + 2) * m + i), row2);
                    _mm_storeu_ps(dst.as_mut_ptr().add((j + 3) * m + i), row3);
                }
            }
        }
    } else {
        transpose_scalar(m, n, src, dst);
    }
}

fn transpose_scalar(m: usize, n: usize, src: &[f32], dst: &mut [f32]) {
    for i in 0..m {
        for j in 0..n {
            dst[j * m + i] = src[i * n + j];
        }
    }
}

pub fn reshape_f32(src: &[f32], dst: &mut [f32]) {
    // Reshape is usually just a memcpy or viewing with new shape
    if src.len() == dst.len() {
        dst.copy_from_slice(src);
    }
}

pub fn concat_f32(axis: usize, a: &[f32], shape_a: &[usize], b: &[f32], shape_b: &[usize], dst: &mut [f32]) {
    // simplified concat along axis 0 or 1 for 2D tensors
    if shape_a.len() != 2 || shape_b.len() != 2 {
        // Fallback or panic for unsupported
        return;
    }
    
    if axis == 0 {
        // Vertical concat
        let size_a = shape_a[0] * shape_a[1];
        let size_b = shape_b[0] * shape_b[1];
        if dst.len() >= size_a + size_b {
            dst[..size_a].copy_from_slice(&a[..size_a]);
            dst[size_a..size_a+size_b].copy_from_slice(&b[..size_b]);
        }
    } else if axis == 1 {
        // Horizontal concat
        if shape_a[0] != shape_b[0] {
            return;
        }
        let rows = shape_a[0];
        let cols_a = shape_a[1];
        let cols_b = shape_b[1];
        let cols_dst = cols_a + cols_b;
        
        for i in 0..rows {
            dst[i * cols_dst .. i * cols_dst + cols_a]
                .copy_from_slice(&a[i * cols_a .. i * cols_a + cols_a]);
            dst[i * cols_dst + cols_a .. i * cols_dst + cols_dst]
                .copy_from_slice(&b[i * cols_b .. i * cols_b + cols_b]);
        }
    }
}

pub fn split_f32(src: &[f32], shape: &[usize], axis: usize, a: &mut [f32], b: &mut [f32], split_idx: usize) {
    if shape.len() != 2 {
        return;
    }
    
    if axis == 0 {
        let cols = shape[1];
        let size_a = split_idx * cols;
        let size_b = (shape[0] - split_idx) * cols;
        a[..size_a].copy_from_slice(&src[..size_a]);
        b[..size_b].copy_from_slice(&src[size_a..size_a+size_b]);
    } else if axis == 1 {
        let rows = shape[0];
        let cols = shape[1];
        let cols_a = split_idx;
        let cols_b = cols - split_idx;
        
        for i in 0..rows {
            a[i * cols_a .. i * cols_a + cols_a]
                .copy_from_slice(&src[i * cols .. i * cols + cols_a]);
            b[i * cols_b .. i * cols_b + cols_b]
                .copy_from_slice(&src[i * cols + cols_a .. i * cols + cols]);
        }
    }
}
