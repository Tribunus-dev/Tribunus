use std::sync::OnceLock;
use std::ffi::c_void;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CBLAS_ORDER {
    CblasRowMajor = 101,
    CblasColMajor = 102,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CBLAS_TRANSPOSE {
    CblasNoTrans = 111,
    CblasTrans = 112,
    CblasConjTrans = 113,
}

// Function pointer types
type CblasSgemmFn = unsafe extern "C" fn(
    CBLAS_ORDER, CBLAS_TRANSPOSE, CBLAS_TRANSPOSE,
    i32, i32, i32, f32, *const f32, i32, *const f32, i32, f32, *mut f32, i32
);

type CblasSgemvFn = unsafe extern "C" fn(
    CBLAS_ORDER, CBLAS_TRANSPOSE,
    i32, i32, f32, *const f32, i32, *const f32, i32, f32, *mut f32, i32
);

type CblasSaxpyFn = unsafe extern "C" fn(
    i32, f32, *const f32, i32, *mut f32, i32
);

type CblasScopyFn = unsafe extern "C" fn(
    i32, *const f32, i32, *mut f32, i32
);

type CblasSdotFn = unsafe extern "C" fn(
    i32, *const f32, i32, *const f32, i32
) -> f32;

pub struct OpenBlasApi {
    pub sgemm: CblasSgemmFn,
    pub sgemv: CblasSgemvFn,
    pub saxpy: CblasSaxpyFn,
    pub scopy: CblasScopyFn,
    pub sdot: CblasSdotFn,
}

static OPENBLAS_API: OnceLock<Option<OpenBlasApi>> = OnceLock::new();

#[cfg(target_os = "linux")]
fn load_openblas() -> Option<OpenBlasApi> {
    unsafe {
        let lib = libloading::Library::new("libopenblas.so").or_else(|_| libloading::Library::new("libopenblas.so.0")).ok()?;
        
        // We leak the library intentionally so it stays loaded for the lifetime of the program
        // This avoids use-after-free when we call the function pointers later
        let lib = Box::leak(Box::new(lib));
        
        let sgemm: libloading::Symbol<CblasSgemmFn> = lib.get(b"cblas_sgemm\0").ok()?;
        let sgemv: libloading::Symbol<CblasSgemvFn> = lib.get(b"cblas_sgemv\0").ok()?;
        let saxpy: libloading::Symbol<CblasSaxpyFn> = lib.get(b"cblas_saxpy\0").ok()?;
        let scopy: libloading::Symbol<CblasScopyFn> = lib.get(b"cblas_scopy\0").ok()?;
        let sdot: libloading::Symbol<CblasSdotFn> = lib.get(b"cblas_sdot\0").ok()?;

        Some(OpenBlasApi {
            sgemm: *sgemm,
            sgemv: *sgemv,
            saxpy: *saxpy,
            scopy: *scopy,
            sdot: *sdot,
        })
    }
}

#[cfg(not(target_os = "linux"))]
fn load_openblas() -> Option<OpenBlasApi> {
    None
}

pub fn get_openblas_api() -> Option<&'static OpenBlasApi> {
    OPENBLAS_API.get_or_init(load_openblas).as_ref()
}
