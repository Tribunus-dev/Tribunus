
pub struct VkInventory {}
pub struct ArcInventory {}
pub struct XdnaBridge {}
pub struct OpenvinoBridge {}

pub fn detect_amd_vulkan() -> Result<VkInventory, String> {
    if super::device::is_amd_gpu_present() {
        Ok(VkInventory {})
    } else {
        Err("AMD GPU not found for Vulkan".to_string())
    }
}

pub fn detect_intel_level_zero() -> Result<ArcInventory, String> {
    if super::device::is_intel_gpu_present() {
        Ok(ArcInventory {})
    } else {
        Err("Intel GPU not found for Level Zero".to_string())
    }
}

pub fn detect_amd_xdna() -> Result<XdnaBridge, String> {
    let result = unsafe { libc::dlopen(b"libonnxruntime.so\0".as_ptr() as *const i8, libc::RTLD_LAZY) };
    if !result.is_null() {
        unsafe { libc::dlclose(result) };
        Ok(XdnaBridge {})
    } else {
        Err("AMD XDNA (libonnxruntime.so) not found via dlopen".to_string())
    }
}

pub fn detect_intel_openvino() -> Result<OpenvinoBridge, String> {
    let result = unsafe { libc::dlopen(b"libopenvino.so\0".as_ptr() as *const i8, libc::RTLD_LAZY) };
    if !result.is_null() {
        unsafe { libc::dlclose(result) };
        Ok(OpenvinoBridge {})
    } else {
        Err("Intel OpenVINO (libopenvino.so) not found via dlopen".to_string())
    }
}

pub fn detect_amx() -> bool {
    super::device::cpu_has_amx()
}

pub fn detect_openblas() -> bool {
    let result = unsafe { libc::dlopen(b"libopenblas.so\0".as_ptr() as *const i8, libc::RTLD_LAZY) };
    if !result.is_null() {
        unsafe { libc::dlclose(result) };
        true
    } else {
        false
    }
}

pub fn detect_onednn() -> bool {
    let result = unsafe { libc::dlopen(b"libdnnl.so\0".as_ptr() as *const i8, libc::RTLD_LAZY) };
    if !result.is_null() {
        unsafe { libc::dlclose(result) };
        true
    } else {
        false
    }
}
