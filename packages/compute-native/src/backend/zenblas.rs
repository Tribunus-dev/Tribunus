use std::sync::OnceLock;
use crate::backend::zenblas_ffi::*;
use crate::backend::amx_intrinsics::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CPUDispatch {
    OpenBLAS,
    AmxTile,
    Avx2,
    Scalar,
}

static DISPATCH: OnceLock<CPUDispatch> = OnceLock::new();

fn detect_dispatch() -> CPUDispatch {
    // 1. Check AMX
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("amx-tile") && is_x86_feature_detected!("amx-int8") {
            return CPUDispatch::AmxTile;
        }
    }

    // 2. Check OpenBLAS dynamically (dlopen)
    if get_openblas_api().is_some() {
        return CPUDispatch::OpenBLAS;
    }

    // If we're linked via cfg_attr we could just check if symbol is resolvable,
    // but dlopen is safer for "does this exist at runtime".
    // Assuming if linked via -lopenblas, we might have it.
    
    // 3. Check AVX2
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma") {
            return CPUDispatch::Avx2;
        }
    }

    CPUDispatch::Scalar
}

pub fn get_dispatch() -> CPUDispatch {
    *DISPATCH.get_or_init(detect_dispatch)
}

pub fn matmul_f32(m: usize, n: usize, k: usize, a: &[f32], b: &[f32], c: &mut [f32]) {
    let dispatch = get_dispatch();
    match dispatch {
        CPUDispatch::AmxTile => {
            // Note: AMX usually for INT8/BF16, but if we route here, we'd fall back to AVX2 for f32
            matmul_avx2(m, n, k, a, b, c);
        }
        CPUDispatch::OpenBLAS => {
            if let Some(api) = get_openblas_api() {
                unsafe {
                    (api.sgemm)(
                        CBLAS_ORDER::CblasRowMajor,
                        CBLAS_TRANSPOSE::CblasNoTrans,
                        CBLAS_TRANSPOSE::CblasNoTrans,
                        m as i32,
                        n as i32,
                        k as i32,
                        1.0,
                        a.as_ptr(),
                        k as i32,
                        b.as_ptr(),
                        n as i32,
                        0.0,
                        c.as_mut_ptr(),
                        n as i32,
                    );
                }
            } else {
                matmul_avx2(m, n, k, a, b, c); // Fallback if API fails unexpectedly
            }
        }
        CPUDispatch::Avx2 => {
            matmul_avx2(m, n, k, a, b, c);
        }
        CPUDispatch::Scalar => {
            matmul_scalar(m, n, k, a, b, c);
        }
    }
}

pub fn matmul_int8(m: usize, n: usize, k: usize, a: &[i8], b: &[i8], c: &mut [i32]) {
    let dispatch = get_dispatch();
    
    // AMX tile limits
    if m <= 64 && n <= 64 && dispatch == CPUDispatch::AmxTile {
        unsafe {
            amx_matmul_int8(a.as_ptr(), b.as_ptr(), c.as_mut_ptr(), m, n, k);
        }
        return;
    }
    
    // Fallback int8 matmul
    for i in 0..m {
        for j in 0..n {
            let mut sum = 0i32;
            for l in 0..k {
                sum += (a[i * k + l] as i32) * (b[l * n + j] as i32);
            }
            c[i * n + j] = sum;
        }
    }
}

pub fn elementwise_add(n: usize, a: &[f32], b: &[f32], c: &mut [f32]) {
    let dispatch = get_dispatch();
    match dispatch {
        CPUDispatch::Avx2 | CPUDispatch::AmxTile => {
            add_avx2(n, a, b, c);
        }
        CPUDispatch::OpenBLAS => {
            if let Some(api) = get_openblas_api() {
                c.copy_from_slice(&a[..n]);
                unsafe {
                    (api.saxpy)(n as i32, 1.0, b.as_ptr(), 1, c.as_mut_ptr(), 1);
                }
            } else {
                add_avx2(n, a, b, c);
            }
        }
        CPUDispatch::Scalar => {
            for i in 0..n {
                c[i] = a[i] + b[i];
            }
        }
    }
}

pub fn dot_product(n: usize, a: &[f32], b: &[f32]) -> f32 {
    let dispatch = get_dispatch();
    match dispatch {
        CPUDispatch::OpenBLAS => {
            if let Some(api) = get_openblas_api() {
                unsafe {
                    (api.sdot)(n as i32, a.as_ptr(), 1, b.as_ptr(), 1)
                }
            } else {
                dot_avx2(n, a, b)
            }
        },
        CPUDispatch::Avx2 | CPUDispatch::AmxTile => {
            dot_avx2(n, a, b)
        }
        CPUDispatch::Scalar => {
            let mut sum = 0.0;
            for i in 0..n {
                sum += a[i] * b[i];
            }
            sum
        }
    }
}

// SIMD Fallbacks
#[cfg(target_arch = "x86_64")]
fn matmul_avx2(m: usize, n: usize, k: usize, a: &[f32], b: &[f32], c: &mut [f32]) {
    use core::arch::x86_64::*;
    unsafe {
        for i in 0..m {
            for j in (0..n).step_by(8) {
                if j + 7 < n {
                    let mut sum = _mm256_setzero_ps();
                    for l in 0..k {
                        let va = _mm256_set1_ps(a[i * k + l]);
                        let vb = _mm256_loadu_ps(b.as_ptr().add(l * n + j));
                        sum = _mm256_fmadd_ps(va, vb, sum);
                    }
                    _mm256_storeu_ps(c.as_mut_ptr().add(i * n + j), sum);
                } else {
                    // Scalar fallback for edge
                    for jj in j..n {
                        let mut sum = 0.0;
                        for l in 0..k {
                            sum += a[i * k + l] * b[l * n + jj];
                        }
                        c[i * n + jj] = sum;
                    }
                }
            }
        }
    }
}

#[cfg(not(target_arch = "x86_64"))]
fn matmul_avx2(m: usize, n: usize, k: usize, a: &[f32], b: &[f32], c: &mut [f32]) {
    matmul_scalar(m, n, k, a, b, c);
}

#[cfg(target_arch = "x86_64")]
fn add_avx2(n: usize, a: &[f32], b: &[f32], c: &mut [f32]) {
    use core::arch::x86_64::*;
    unsafe {
        let mut i = 0;
        while i + 7 < n {
            let va = _mm256_loadu_ps(a.as_ptr().add(i));
            let vb = _mm256_loadu_ps(b.as_ptr().add(i));
            let vc = _mm256_add_ps(va, vb);
            _mm256_storeu_ps(c.as_mut_ptr().add(i), vc);
            i += 8;
        }
        for j in i..n {
            c[j] = a[j] + b[j];
        }
    }
}

#[cfg(not(target_arch = "x86_64"))]
fn add_avx2(n: usize, a: &[f32], b: &[f32], c: &mut [f32]) {
    for i in 0..n {
        c[i] = a[i] + b[i];
    }
}

#[cfg(target_arch = "x86_64")]
fn dot_avx2(n: usize, a: &[f32], b: &[f32]) -> f32 {
    use core::arch::x86_64::*;
    unsafe {
        let mut sum8 = _mm256_setzero_ps();
        let mut i = 0;
        while i + 7 < n {
            let va = _mm256_loadu_ps(a.as_ptr().add(i));
            let vb = _mm256_loadu_ps(b.as_ptr().add(i));
            sum8 = _mm256_fmadd_ps(va, vb, sum8);
            i += 8;
        }
        
        let mut arr = [0.0; 8];
        _mm256_storeu_ps(arr.as_mut_ptr(), sum8);
        let mut sum = arr.iter().sum();
        
        for j in i..n {
            sum += a[j] * b[j];
        }
        sum
    }
}

#[cfg(not(target_arch = "x86_64"))]
fn dot_avx2(n: usize, a: &[f32], b: &[f32]) -> f32 {
    let mut sum = 0.0;
    for i in 0..n {
        sum += a[i] * b[i];
    }
    sum
}

fn matmul_scalar(m: usize, n: usize, k: usize, a: &[f32], b: &[f32], c: &mut [f32]) {
    for i in 0..m {
        for j in 0..n {
            let mut sum = 0.0;
            for l in 0..k {
                sum += a[i * k + l] * b[l * n + j];
            }
            c[i * n + j] = sum;
        }
    }
}
