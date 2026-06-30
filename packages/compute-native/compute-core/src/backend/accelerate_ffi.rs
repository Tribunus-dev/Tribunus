//! Direct FFI bindings to Accelerate BLAS (cblas_sgemm) and vDSP.
//!
//! Accelerate is a system framework on macOS only.
//! The entire extern block is gated behind #[cfg(target_os = "macos")].

#[cfg(target_os = "macos")]
use core::ffi::c_void;

#[cfg(target_os = "macos")]
#[link(name = "Accelerate", kind = "framework")]
extern "C" {
    /// Single-precision general matrix multiply: C = alpha * op(A) * op(B) + beta * C.
    /// cblas_sgemm uses column-major storage by default.
    ///
    /// Parameters:
    ///   Order: CblasRowMajor (101) or CblasColMajor (102)
    ///   TransA, TransB: CblasNoTrans (111) or CblasTrans (112)
    ///   M: rows of op(A) and C
    ///   N: cols of op(B) and C
    ///   K: cols of op(A) / rows of op(B)
    ///   alpha: scalar multiplier
    ///   A: matrix A
    ///   lda: leading dimension of A
    ///   B: matrix B
    ///   ldb: leading dimension of B
    ///   beta: scalar multiplier for C
    ///   C: result matrix
    ///   ldc: leading dimension of C
    pub fn cblas_sgemm(
        order: i32,
        trans_a: i32,
        trans_b: i32,
        m: i32,
        n: i32,
        k: i32,
        alpha: f32,
        a: *const f32,
        lda: i32,
        b: *const f32,
        ldb: i32,
        beta: f32,
        c: *mut f32,
        ldc: i32,
    );

    // ── vDSP ─────────────────────────────────────────────────────────────

    /// Vector square: C[i] = A[i]^2
    pub fn vDSP_vsq(a: *const f32, ia: isize, c: *mut f32, ic: isize, n: usize);

    /// Vector sum: *C = sum(A[i])
    pub fn vDSP_sve(a: *const f32, ia: isize, c: *mut f32, n: usize);

    /// Vector square root: A[i] = sqrt(B[i])
    pub fn vvsqrt(a: *mut f32, b: *const f32, n: *const i32);

    /// Vector divide: C[i] = B[i] / A[i]
    pub fn vDSP_vdiv(
        a: *const f32,
        ia: isize,
        b: *const f32,
        ib: isize,
        c: *mut f32,
        ic: isize,
        n: usize,
    );

    /// Vector multiply: C[i] = A[i] * B[i]
    pub fn vDSP_vmul(
        a: *const f32,
        ia: isize,
        b: *const f32,
        ib: isize,
        c: *mut f32,
        ic: isize,
        n: usize,
    );

    /// Vector add: C[i] = A[i] + B[i]
    pub fn vDSP_vadd(
        a: *const f32,
        ia: isize,
        b: *const f32,
        ib: isize,
        c: *mut f32,
        ic: isize,
        n: usize,
    );

    /// Vector scalar multiply: C[i] = A[i] * B
    pub fn vDSP_vsmul(a: *const f32, ia: isize, b: *const f32, c: *mut f32, ic: isize, n: usize);

    /// Vector exponential: A[i] = exp(B[i])
    pub fn vvexp(a: *mut f32, b: *const f32, n: *const i32);

    /// Create an FFT setup object (opaque).
    /// Log2n: log2 of max FFT length; Radix: 0=kFFTRadix2, 1=kFFTRadix3, 2=kFFTRadix5.
    pub fn vDSP_create_fftsetup(log2n: usize, radix: u32) -> *mut c_void;

    /// Destroy an FFT setup object.
    pub fn vDSP_destroy_fftsetup(setup: *mut c_void);
}

// BLAS constants
// These are platform-independent integer constants, always available.
pub const CBLAS_ROW_MAJOR: i32 = 101;
pub const CBLAS_NO_TRANS: i32 = 111;
pub const CBLAS_TRANS: i32 = 112;
