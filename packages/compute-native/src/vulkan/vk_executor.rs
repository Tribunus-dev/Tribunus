use ash::{vk, Device};
use std::sync::Arc;
use super::vk_inventory::VkInventory;
use super::vk_memory::{VkMemoryAllocator, DeviceBuffer};
use super::vk_shaders::VkShaderManager;

pub struct VkExecutor {
    inventory: Arc<VkInventory>,
    allocator: Arc<VkMemoryAllocator>,
    shader_manager: Arc<VkShaderManager>,
}

impl VkExecutor {
    pub fn new(inventory: Arc<VkInventory>) -> Self {
        let allocator = Arc::new(VkMemoryAllocator::new(&inventory));
        let shader_manager = Arc::new(VkShaderManager::new(Arc::new(inventory.device.clone())));
        Self {
            inventory,
            allocator,
            shader_manager,
        }
    }
    
    pub fn create_f32(&self, size: u64) -> Result<DeviceBuffer, String> {
        self.allocator.allocate_buffer(size * 4, vk::BufferUsageFlags::STORAGE_BUFFER, vk::MemoryPropertyFlags::DEVICE_LOCAL, "f32")
    }

    pub fn create_f16(&self, size: u64) -> Result<DeviceBuffer, String> {
        self.allocator.allocate_buffer(size * 2, vk::BufferUsageFlags::STORAGE_BUFFER, vk::MemoryPropertyFlags::DEVICE_LOCAL, "f16")
    }

    pub fn create_i8(&self, size: u64) -> Result<DeviceBuffer, String> {
        self.allocator.allocate_buffer(size, vk::BufferUsageFlags::STORAGE_BUFFER, vk::MemoryPropertyFlags::DEVICE_LOCAL, "i8")
    }

    pub fn create_u8(&self, size: u64) -> Result<DeviceBuffer, String> {
        self.allocator.allocate_buffer(size, vk::BufferUsageFlags::STORAGE_BUFFER, vk::MemoryPropertyFlags::DEVICE_LOCAL, "u8")
    }

    pub fn matmul(&self) {}
    pub fn quantized_matmul(&self) {}
    pub fn rms_norm(&self) {}
    pub fn rope(&self) {}
    pub fn silu(&self) {}
    pub fn flash_attention(&self) {}
    pub fn kv_append(&self) {}
    pub fn kv_gather(&self) {}
    pub fn transpose(&self) {}
    pub fn reshape(&self) {}
    pub fn concat(&self) {}
    pub fn sync(&self) {}
}
