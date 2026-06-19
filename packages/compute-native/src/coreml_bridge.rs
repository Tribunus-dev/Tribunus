    pub(crate) ptr: *mut std::ffi::c_void,
    pub fn load_with_compute_units(
        path: &str,
        compute_units: CoreMlComputeUnits,
    ) -> Result<Self, String> {
        let status =
            unsafe { tribunus_coreml_load_model(&mut ptr, c_path.as_ptr(), compute_units as i64) };
        let c_in_name =
            std::ffi::CString::new(input_name).map_err(|e| format!("CString: {}", e))?;
        let c_out_name =
            std::ffi::CString::new(output_name).map_err(|e| format!("CString: {}", e))?;
        let c_in_name =
            std::ffi::CString::new(input_name).map_err(|e| format!("CString: {}", e))?;
        let c_out_name =
            std::ffi::CString::new(output_name).map_err(|e| format!("CString: {}", e))?;
            return Err(format!(
                "tribunus_coreml_predict_pixelbuffer failed: {}",
                status
            ));
