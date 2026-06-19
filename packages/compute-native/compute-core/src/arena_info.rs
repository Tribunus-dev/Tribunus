use std::ffi::c_void;

/// C-compatible struct mirrored from coreml_arena.mm.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ArenaInfo {
    pub width: i32,
    pub height: i32,
    pub logical_dim0: i32,
    pub logical_dim1: i32,
    pub pixel_format: i32,
    pub byte_size: i32,
    pub bytes_per_row: i32,
    pub base_address: *mut c_void,
    pub(crate) cv_buffer: *mut c_void,
    pub(crate) io_surface: *mut c_void,
}

// Safety: ArenaInfo contains raw pointers. It is safe to send between threads
// only if the caller guarantees exclusive access or synchronises at the
// lease-transfer boundary.
unsafe impl Send for ArenaInfo {}
unsafe impl Sync for ArenaInfo {}
