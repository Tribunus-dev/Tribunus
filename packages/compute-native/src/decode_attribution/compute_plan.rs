use crate::coreml_bridge::{tribunus_coreml_free_string, tribunus_coreml_inspect_compute_plan};

    let c_path = std::ffi::CString::new(_mlmodelc_path).unwrap_or_default();
    let mut out_summary: *mut i8 = std::ptr::null_mut();

    let status = unsafe { tribunus_coreml_inspect_compute_plan(c_path.as_ptr(), &mut out_summary) };

    if status == 0 && !out_summary.is_null() {
        let c_str = unsafe { std::ffi::CStr::from_ptr(out_summary) };
        let summary_str = c_str.to_string_lossy().into_owned();
        unsafe { tribunus_coreml_free_string(out_summary) };
        ComputePlanResult {
            status: "available".to_string(),
            summary: Some(summary_str),
        }
    } else {
        ComputePlanResult {
            status: "unavailable".to_string(),
            summary: Some(format!(
                "Failed to load compute plan, status code: {}",
                status
            )),
        }
