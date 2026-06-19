#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

#![cfg(feature = "intel")]

use std::ffi::c_void;

#[derive(PartialEq, Eq)]
#[repr(C)]
pub enum ze_result_t {
    ZE_RESULT_SUCCESS = 0,
    ZE_RESULT_NOT_READY = 1,
    ZE_RESULT_ERROR_DEVICE_LOST = 0x70000001,
    ZE_RESULT_ERROR_OUT_OF_HOST_MEMORY = 0x70000002,
    ZE_RESULT_ERROR_OUT_OF_DEVICE_MEMORY = 0x70000003,
    ZE_RESULT_ERROR_MODULE_BUILD_FAILURE = 0x70000004,
    ZE_RESULT_ERROR_MODULE_LINK_FAILURE = 0x70000005,
    ZE_RESULT_ERROR_DEVICE_REQUIRES_RESET = 0x70000006,
    ZE_RESULT_ERROR_DEVICE_IN_LOW_POWER_STATE = 0x70000007,
    ZE_RESULT_ERROR_INSUFFICIENT_PERMISSIONS = 0x70010000,
    ZE_RESULT_ERROR_NOT_AVAILABLE = 0x70010001,
    ZE_RESULT_ERROR_DEPENDENCY_UNAVAILABLE = 0x70020000,
    ZE_RESULT_ERROR_UNINITIALIZED = 0x78000001,
    ZE_RESULT_ERROR_UNSUPPORTED_VERSION = 0x78000002,
    ZE_RESULT_ERROR_UNSUPPORTED_FEATURE = 0x78000003,
    ZE_RESULT_ERROR_INVALID_ARGUMENT = 0x78000004,
    ZE_RESULT_ERROR_INVALID_NULL_HANDLE = 0x78000005,
    ZE_RESULT_ERROR_HANDLE_OBJECT_IN_USE = 0x78000006,
    ZE_RESULT_ERROR_INVALID_NULL_POINTER = 0x78000007,
    ZE_RESULT_ERROR_INVALID_SIZE = 0x78000008,
    ZE_RESULT_ERROR_UNSUPPORTED_SIZE = 0x78000009,
    ZE_RESULT_ERROR_UNSUPPORTED_ALIGNMENT = 0x7800000a,
    ZE_RESULT_ERROR_INVALID_SYNCHRONIZATION_OBJECT = 0x7800000b,
    ZE_RESULT_ERROR_INVALID_ENUMERATION = 0x7800000c,
    ZE_RESULT_ERROR_UNSUPPORTED_ENUMERATION = 0x7800000d,
    ZE_RESULT_ERROR_UNSUPPORTED_IMAGE_FORMAT = 0x7800000e,
    ZE_RESULT_ERROR_INVALID_NATIVE_BINARY = 0x7800000f,
    ZE_RESULT_ERROR_INVALID_GLOBAL_NAME = 0x78000010,
    ZE_RESULT_ERROR_INVALID_KERNEL_NAME = 0x78000011,
    ZE_RESULT_ERROR_INVALID_FUNCTION_NAME = 0x78000012,
    ZE_RESULT_ERROR_INVALID_GROUP_SIZE_DIMENSION = 0x78000013,
    ZE_RESULT_ERROR_INVALID_GLOBAL_WIDTH_DIMENSION = 0x78000014,
    ZE_RESULT_ERROR_INVALID_KERNEL_ARGUMENT_INDEX = 0x78000015,
    ZE_RESULT_ERROR_INVALID_KERNEL_ARGUMENT_SIZE = 0x78000016,
    ZE_RESULT_ERROR_INVALID_KERNEL_ATTRIBUTE_VALUE = 0x78000017,
    ZE_RESULT_ERROR_INVALID_MODULE_UNLINKED = 0x78000018,
    ZE_RESULT_ERROR_INVALID_COMMAND_LIST_TYPE = 0x78000019,
    ZE_RESULT_ERROR_OVERLAPPING_REGIONS = 0x7800001a,
    ZE_RESULT_ERROR_UNKNOWN = 0x7ffffffe,
}

#[repr(C)]
pub enum ze_init_flags_t {
    ZE_INIT_FLAG_NONE = 0,
    ZE_INIT_FLAG_GPU_ONLY = 1,
    ZE_INIT_FLAG_VPU_ONLY = 2,
}

pub type ze_driver_handle_t = *mut c_void;
pub type ze_device_handle_t = *mut c_void;
pub type ze_context_handle_t = *mut c_void;
pub type ze_command_list_handle_t = *mut c_void;

#[repr(C)]
pub enum ze_structure_type_t {
    ZE_STRUCTURE_TYPE_COMMAND_QUEUE_DESC = 0x14,
}

#[repr(C)]
pub enum ze_command_queue_flag_t {
    ZE_COMMAND_QUEUE_FLAG_NONE = 0,
    ZE_COMMAND_QUEUE_FLAG_EXPLICIT_ONLY = 1,
}

#[repr(C)]
pub enum ze_command_queue_mode_t {
    ZE_COMMAND_QUEUE_MODE_DEFAULT = 0,
    ZE_COMMAND_QUEUE_MODE_SYNCHRONOUS = 1,
    ZE_COMMAND_QUEUE_MODE_ASYNCHRONOUS = 2,
}

#[repr(C)]
pub enum ze_command_queue_priority_t {
    ZE_COMMAND_QUEUE_PRIORITY_NORMAL = 0,
    ZE_COMMAND_QUEUE_PRIORITY_PRIORITY_LOW = 1,
    ZE_COMMAND_QUEUE_PRIORITY_PRIORITY_HIGH = 2,
}

#[repr(C)]
pub struct ze_command_queue_desc_t {
    pub stype: ze_structure_type_t,
    pub pNext: *const c_void,
    pub ordinal: u32,
    pub index: u32,
    pub flags: ze_command_queue_flag_t,
    pub mode: ze_command_queue_mode_t,
    pub priority: ze_command_queue_priority_t,
}

#[link(name = "ze_loader")]
extern "C" {
    pub fn zeInit(flags: ze_init_flags_t) -> ze_result_t;
    pub fn zeDriverGet(pCount: *mut u32, phDrivers: *mut ze_driver_handle_t) -> ze_result_t;
    pub fn zeDeviceGet(hDriver: ze_driver_handle_t, pCount: *mut u32, phDevices: *mut ze_device_handle_t) -> ze_result_t;
    pub fn zeCommandListCreateImmediate(
        hContext: ze_context_handle_t,
        hDevice: ze_device_handle_t,
        alldesc: *const ze_command_queue_desc_t,
        phCommandList: *mut ze_command_list_handle_t,
    ) -> ze_result_t;
}
