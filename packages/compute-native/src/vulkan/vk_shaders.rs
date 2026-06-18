use ash::{vk, Device};
use std::sync::Arc;
use std::collections::HashMap;

pub struct PrecompiledKernelCache {
    cache: HashMap<String, Vec<u8>>,
    max_size: usize,
}

impl PrecompiledKernelCache {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
            max_size: 256,
        }
    }
}

pub struct VkShaderManager {
    device: Arc<Device>,
    shader_modules: HashMap<String, vk::ShaderModule>,
    pub kernel_cache: PrecompiledKernelCache,
}

impl VkShaderManager {
    pub fn new(device: Arc<Device>) -> Self {
        Self {
            device,
            shader_modules: HashMap::new(),
            kernel_cache: PrecompiledKernelCache::new(),
        }
    }

    pub fn load_shader(&mut self, name: &str, spv_code: &[u32]) -> Result<vk::ShaderModule, String> {
        let create_info = vk::ShaderModuleCreateInfo::builder().code(spv_code);
        let shader_module = unsafe { self.device.create_shader_module(&create_info, None).map_err(|e| e.to_string())? };
        self.shader_modules.insert(name.to_string(), shader_module);
        Ok(shader_module)
    }

    pub fn get_shader(&self, name: &str) -> Option<vk::ShaderModule> {
        self.shader_modules.get(name).copied()
    }
}
