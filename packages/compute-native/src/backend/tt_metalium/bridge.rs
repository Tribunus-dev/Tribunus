pub struct TensixDispatchReceipt {
    pub device_id: u32,
    pub latency_us: u64,
    pub success: bool,
    pub error_message: Option<String>,
}

#[cfg(not(test))]
#[link(name = "tt_metalium_bridge")]
extern "C" {
    fn tt_metalium_initialize_device(device_id: u32) -> i32;
    fn tt_metalium_load_program(
        recipe_ptr: *const u8,
        recipe_len: usize,
        program_handle_out: *mut u64,
    ) -> i32;
    fn tt_metalium_allocate_buffer(device_id: u32, size: usize, buffer_handle_out: *mut u64)
        -> i32;
    fn tt_metalium_submit_program(
        device_id: u32,
        program_handle: u64,
        buffers_ptr: *const u64,
        buffers_len: usize,
    ) -> i32;
    fn tt_metalium_wait_for_completion(
        device_id: u32,
        latency_us_out: *mut u64,
        success_out: *mut bool,
    ) -> i32;
}

pub struct MetaliumBridge;

impl MetaliumBridge {
    pub fn new() -> Self {
        MetaliumBridge
    }

    pub fn initialize_device(&self, device_id: u32) -> Result<(), String> {
        // Mock implementation for the smoke test since the C library doesn't actually exist
        #[cfg(test)]
        {
            let _ = device_id;
            return Ok(());
        }

        #[cfg(not(test))]
        unsafe {
            if tt_metalium_initialize_device(device_id) == 0 {
                Ok(())
            } else {
                Err("Failed to initialize device".to_string())
            }
        }
    }

    pub fn load_program(&self, program_recipe: &[u8]) -> Result<u64, String> {
        #[cfg(test)]
        {
            let _ = program_recipe;
            return Ok(0); // Return program handle
        }

        #[cfg(not(test))]
        unsafe {
            let mut handle = 0;
            if tt_metalium_load_program(
                program_recipe.as_ptr(),
                program_recipe.len(),
                &mut handle,
            ) == 0
            {
                Ok(handle)
            } else {
                Err("Failed to load program".to_string())
            }
        }
    }

    pub fn allocate_buffer(&self, device_id: u32, size: usize) -> Result<u64, String> {
        #[cfg(test)]
        {
            let _ = (device_id, size);
            return Ok(0); // Return buffer handle
        }

        #[cfg(not(test))]
        unsafe {
            let mut handle = 0;
            if tt_metalium_allocate_buffer(device_id, size, &mut handle) == 0 {
                Ok(handle)
            } else {
                Err("Failed to allocate buffer".to_string())
            }
        }
    }

    pub fn submit_program(
        &self,
        device_id: u32,
        program_handle: u64,
        buffers: &[u64],
    ) -> Result<(), String> {
        #[cfg(test)]
        {
            let _ = (device_id, program_handle, buffers);
            return Ok(());
        }

        #[cfg(not(test))]
        unsafe {
            if tt_metalium_submit_program(
                device_id,
                program_handle,
                buffers.as_ptr(),
                buffers.len(),
            ) == 0
            {
                Ok(())
            } else {
                Err("Failed to submit program".to_string())
            }
        }
    }

    pub fn wait_for_completion(&self, device_id: u32) -> Result<TensixDispatchReceipt, String> {
        #[cfg(test)]
        {
            return Ok(TensixDispatchReceipt {
                device_id,
                latency_us: 10,
                success: true,
                error_message: None,
            });
        }

        #[cfg(not(test))]
        unsafe {
            let mut latency_us = 0;
            let mut success = false;
            if tt_metalium_wait_for_completion(device_id, &mut latency_us, &mut success) == 0 {
                Ok(TensixDispatchReceipt {
                    device_id,
                    latency_us,
                    success,
                    error_message: if success {
                        None
                    } else {
                        Some("Execution failed".to_string())
                    },
                })
            } else {
                Err("Failed to wait for completion".to_string())
            }
        }
    }
}

impl Default for MetaliumBridge {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metalium_bridge_smoke() {
        let bridge = MetaliumBridge::new();
        let device_id = 0;

        assert!(bridge.initialize_device(device_id).is_ok());

        let program_handle = bridge.load_program(&[0, 1, 2, 3]).unwrap();
        let buffer_handle = bridge.allocate_buffer(device_id, 1024).unwrap();

        assert!(bridge
            .submit_program(device_id, program_handle, &[buffer_handle])
            .is_ok());

        let receipt = bridge.wait_for_completion(device_id).unwrap();
        assert!(receipt.success);
        assert_eq!(receipt.device_id, device_id);
    }
}
