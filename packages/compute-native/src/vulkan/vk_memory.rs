use ash::{vk, Device};
use std::sync::{Arc, Mutex};
use super::vk_inventory::VkInventory;

pub struct DeviceBuffer {
    pub buffer: vk::Buffer,
    pub memory: vk::DeviceMemory,
    pub size: u64,
    pub mapped_ptr: Option<*mut u8>,
    pub label: String,
}

pub struct StagingBufferPool {
    pool: Mutex<Vec<DeviceBuffer>>,
}

pub struct MemoryBudgetTracker {
    pub total_allocated: u64,
}

pub struct VkMemoryAllocator {
    device: Arc<Device>,
    memory_properties: vk::PhysicalDeviceMemoryProperties,
    allocations: Mutex<Vec<(vk::DeviceMemory, u64, String)>>,
    pub budget_tracker: Mutex<MemoryBudgetTracker>,
    pub staging_pool: Arc<StagingBufferPool>,
}

impl VkMemoryAllocator {
    pub fn new(inventory: &VkInventory) -> Self {
        Self {
            device: Arc::new(inventory.device.clone()),
            memory_properties: inventory.memory_properties,
            allocations: Mutex::new(Vec::new()),
            budget_tracker: Mutex::new(MemoryBudgetTracker { total_allocated: 0 }),
            staging_pool: Arc::new(StagingBufferPool { pool: Mutex::new(Vec::new()) }),
        }
    }

    fn find_memory_type(&self, type_filter: u32, properties: vk::MemoryPropertyFlags) -> Option<u32> {
        for i in 0..self.memory_properties.memory_type_count {
            if (type_filter & (1 << i)) != 0
                && (self.memory_properties.memory_types[i as usize].property_flags & properties) == properties
            {
                return Some(i);
            }
        }
        None
    }

    pub fn allocate_buffer(&self, size: u64, usage: vk::BufferUsageFlags, properties: vk::MemoryPropertyFlags, label: &str) -> Result<DeviceBuffer, String> {
        let buffer_info = vk::BufferCreateInfo::builder()
            .size(size)
            .usage(usage)
            .sharing_mode(vk::SharingMode::EXCLUSIVE);

        let buffer = unsafe { self.device.create_buffer(&buffer_info, None).map_err(|e| e.to_string())? };

        let mem_requirements = unsafe { self.device.get_buffer_memory_requirements(buffer) };

        let memory_type_index = self.find_memory_type(mem_requirements.memory_type_bits, properties)
            .ok_or("Failed to find suitable memory type")?;

        let alloc_info = vk::MemoryAllocateInfo::builder()
            .allocation_size(mem_requirements.size)
            .memory_type_index(memory_type_index);

        let memory = unsafe { self.device.allocate_memory(&alloc_info, None).map_err(|e| e.to_string())? };

        unsafe { self.device.bind_buffer_memory(buffer, memory, 0).map_err(|e| e.to_string())? };

        self.allocations.lock().unwrap().push((memory, size, label.to_string()));
        self.budget_tracker.lock().unwrap().total_allocated += size;

        let mut mapped_ptr = None;
        if properties.contains(vk::MemoryPropertyFlags::HOST_VISIBLE) {
            mapped_ptr = Some(unsafe { self.device.map_memory(memory, 0, size, vk::MemoryMapFlags::empty()).map_err(|e| e.to_string())? as *mut u8 });
        }

        Ok(DeviceBuffer { buffer, memory, size, mapped_ptr, label: label.to_string() })
    }

    pub fn free_buffer(&self, buffer: DeviceBuffer) {
        unsafe {
            if buffer.mapped_ptr.is_some() {
                self.device.unmap_memory(buffer.memory);
            }
            self.device.destroy_buffer(buffer.buffer, None);
            self.device.free_memory(buffer.memory, None);
        }
        self.allocations.lock().unwrap().retain(|&(mem, _, _)| mem != buffer.memory);
        self.budget_tracker.lock().unwrap().total_allocated -= buffer.size;
    }
    
    pub fn transfer_h2d(&self) {}
    pub fn transfer_d2h(&self) {}
}
