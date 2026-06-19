use ash::{vk, Entry, Instance, Device};
use std::sync::RwLock;
use std::ffi::CStr;

pub struct VkInventory {
    pub instance: Instance,
    pub physical_device: vk::PhysicalDevice,
    pub device: Device,
    pub compute_queue: vk::Queue,
    pub transfer_queue: vk::Queue,
    pub compute_queue_family: u32,
    pub transfer_queue_family: u32,
    pub memory_properties: vk::PhysicalDeviceMemoryProperties,
    pub properties: vk::PhysicalDeviceProperties,
}

impl VkInventory {
    pub fn new() -> Result<Self, String> {
        let entry = unsafe { Entry::load().map_err(|e| e.to_string())? };
        let app_name = unsafe { CStr::from_bytes_with_nul_unchecked(b"Tribunus Compute\0") };
        let app_info = vk::ApplicationInfo::builder()
            .application_name(app_name)
            .api_version(vk::API_VERSION_1_2);

        let instance_create_info = vk::InstanceCreateInfo::builder()
            .application_info(&app_info);
            
        let instance = unsafe { entry.create_instance(&instance_create_info, None).map_err(|e| e.to_string())? };
        
        let physical_devices = unsafe { instance.enumerate_physical_devices().map_err(|e| e.to_string())? };
        if physical_devices.is_empty() {
            return Err("No Vulkan physical devices found".to_string());
        }

        let mut selected_pd = None;
        for &pd in &physical_devices {
            let props = unsafe { instance.get_physical_device_properties(pd) };
            if props.vendor_id == 0x1002 { // AMD
                selected_pd = Some(pd);
                break;
            }
        }
        
        let physical_device = selected_pd.unwrap_or(physical_devices[0]);
        let properties = unsafe { instance.get_physical_device_properties(physical_device) };
        let memory_properties = unsafe { instance.get_physical_device_memory_properties(physical_device) };
        
        let queue_families = unsafe { instance.get_physical_device_queue_family_properties(physical_device) };
        let mut compute_queue_family = None;
        let mut transfer_queue_family = None;

        for (i, family) in queue_families.iter().enumerate() {
            if family.queue_flags.contains(vk::QueueFlags::COMPUTE) {
                compute_queue_family = Some(i as u32);
            } else if family.queue_flags.contains(vk::QueueFlags::TRANSFER) {
                transfer_queue_family = Some(i as u32);
            }
        }
        
        let compute_queue_family = compute_queue_family.ok_or("No compute queue found")?;
        let transfer_queue_family = transfer_queue_family.unwrap_or(compute_queue_family); // fallback to compute queue if separate transfer isn't found
        
        let mut queue_create_infos = vec![
            vk::DeviceQueueCreateInfo::builder()
                .queue_family_index(compute_queue_family)
                .queue_priorities(&[1.0])
                .build()
        ];
        if transfer_queue_family != compute_queue_family {
            queue_create_infos.push(
                vk::DeviceQueueCreateInfo::builder()
                    .queue_family_index(transfer_queue_family)
                    .queue_priorities(&[0.5])
                    .build()
            );
        }

        let device_extensions = vec![
            vk::Khr16bitStorageFn::name().as_ptr(),
            vk::Khr8bitStorageFn::name().as_ptr(),
            vk::KhrShaderFloat16Int8Fn::name().as_ptr(),
            vk::KhrShaderSubgroupExtendedTypesFn::name().as_ptr(),
            vk::KhrTimelineSemaphoreFn::name().as_ptr(),
        ];

        let mut features16 = vk::PhysicalDevice16BitStorageFeatures::builder()
            .storage_buffer16_bit_access(true);
            
        let mut features8 = vk::PhysicalDevice8BitStorageFeatures::builder()
            .storage_buffer8_bit_access(true);
            
        let mut features_float16_int8 = vk::PhysicalDeviceShaderFloat16Int8Features::builder()
            .shader_float16(true)
            .shader_int8(true);
            
        let mut features_subgroup = vk::PhysicalDeviceShaderSubgroupExtendedTypesFeatures::builder()
            .shader_subgroup_extended_types(true);
            
        let mut features_timeline = vk::PhysicalDeviceTimelineSemaphoreFeatures::builder()
            .timeline_semaphore(true);

        let mut physical_device_features = vk::PhysicalDeviceFeatures2::builder()
            .push_next(&mut features16)
            .push_next(&mut features8)
            .push_next(&mut features_float16_int8)
            .push_next(&mut features_subgroup)
            .push_next(&mut features_timeline);

        let device_create_info = vk::DeviceCreateInfo::builder()
            .queue_create_infos(&queue_create_infos)
            .enabled_extension_names(&device_extensions)
            .push_next(&mut physical_device_features);

        let device = unsafe { instance.create_device(physical_device, &device_create_info, None).map_err(|e| e.to_string())? };
        
        let compute_queue = unsafe { device.get_device_queue(compute_queue_family, 0) };
        let transfer_queue = unsafe { device.get_device_queue(transfer_queue_family, 0) };

        Ok(VkInventory {
            instance,
            physical_device,
            device,
            compute_queue,
            transfer_queue,
            compute_queue_family,
            transfer_queue_family,
            memory_properties,
            properties,
        })
    }
}
