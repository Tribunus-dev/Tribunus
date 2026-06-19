#![allow(non_camel_case_types)]

#![cfg(feature = "intel")]

use std::ffi::c_void;
use std::os::raw::{c_int, c_uint};

#[repr(C)]
pub enum dnnl_status_t {
    dnnl_success = 0,
    dnnl_out_of_memory = 1,
    dnnl_invalid_arguments = 2,
    dnnl_unimplemented = 3,
    dnnl_iterator_ends = 4,
    dnnl_runtime_error = 5,
    dnnl_not_required = 6,
}

#[repr(C)]
pub enum dnnl_engine_kind_t {
    dnnl_any_engine = 0,
    dnnl_cpu = 1,
    dnnl_gpu = 2,
}

#[repr(C)]
pub enum dnnl_prop_kind_t {
    dnnl_prop_kind_undef = 0,
    dnnl_forward_training = 64,
    dnnl_forward_inference = 96,
    dnnl_forward = 97,
    dnnl_backward = 128,
    dnnl_backward_data = 160,
    dnnl_backward_weights = 192,
    dnnl_backward_bias = 224,
}

#[repr(C)]
pub enum dnnl_data_type_t {
    dnnl_data_type_undef = 0,
    dnnl_f16 = 1,
    dnnl_bf16 = 2,
    dnnl_f32 = 3,
    dnnl_s32 = 4,
    dnnl_s8 = 5,
    dnnl_u8 = 6,
    dnnl_f64 = 7,
    dnnl_f8_e5m2 = 8,
    dnnl_f8_e4m3 = 9,
}

#[repr(C)]
pub enum dnnl_format_tag_t {
    dnnl_format_tag_undef = 0,
    dnnl_format_tag_any = 1,
    dnnl_ab = 2,
    dnnl_abc = 3,
    dnnl_abcd = 4,
}

#[repr(C)]
pub struct dnnl_memory_desc_t {
    pub ndims: c_int,
    pub dims: [i64; 12],
    pub data_type: dnnl_data_type_t,
    pub padded_dims: [i64; 12],
    pub padded_offsets: [i64; 12],
    pub offset0: i64,
    pub format_kind: c_int,
    pub format_desc: [u64; 44],
}

#[repr(C)]
pub struct dnnl_inner_product_desc_t {
    pub prop_kind: dnnl_prop_kind_t,
    pub src_desc: dnnl_memory_desc_t,
    pub weights_desc: dnnl_memory_desc_t,
    pub bias_desc: dnnl_memory_desc_t,
    pub dst_desc: dnnl_memory_desc_t,
    pub accum_data_type: dnnl_data_type_t,
}

#[repr(C)]
pub struct dnnl_eltwise_desc_t {
    pub prop_kind: dnnl_prop_kind_t,
    pub alg_kind: c_int,
    pub data_desc: dnnl_memory_desc_t,
    pub diff_data_desc: dnnl_memory_desc_t,
    pub alpha: f32,
    pub beta: f32,
}

#[repr(C)]
pub struct dnnl_layer_normalization_desc_t {
    pub prop_kind: dnnl_prop_kind_t,
    pub data_desc: dnnl_memory_desc_t,
    pub diff_data_desc: dnnl_memory_desc_t,
    pub data_scaleshift_desc: dnnl_memory_desc_t,
    pub diff_data_scaleshift_desc: dnnl_memory_desc_t,
    pub stat_desc: dnnl_memory_desc_t,
    pub epsilon: f32,
    pub flags: c_uint,
}

#[repr(C)]
pub enum dnnl_primitive_kind_t {
    dnnl_inner_product = 3,
    dnnl_eltwise = 7,
    dnnl_layer_normalization = 18,
}

#[repr(C)]
pub struct dnnl_op_desc_t {
    pub kind: dnnl_primitive_kind_t,
    // Note: The actual struct in oneDNN is a union of all primitive descriptors.
    // For FFI bindings, we'll represent it amorphously since we just pass pointers.
    pub dummy: [u8; 1024],
}

#[repr(C)]
pub struct dnnl_exec_arg_t {
    pub arg: c_int,
    pub memory: dnnl_memory_t,
}

pub type dnnl_engine_t = *mut c_void;
pub type dnnl_stream_t = *mut c_void;
pub type dnnl_primitive_desc_t = *mut c_void;
pub type dnnl_primitive_t = *mut c_void;
pub type dnnl_memory_t = *mut c_void;
pub type const_dnnl_op_desc_t = *const c_void;
pub type const_dnnl_primitive_attr_t = *const c_void;
pub type const_dnnl_primitive_desc_t = *const c_void;
pub type const_dnnl_memory_desc_t = *const dnnl_memory_desc_t;

#[link(name = "dnnl")]
extern "C" {
    pub fn dnnl_engine_create(
        engine: *mut dnnl_engine_t,
        kind: dnnl_engine_kind_t,
        index: usize,
    ) -> dnnl_status_t;

    pub fn dnnl_stream_create(
        stream: *mut dnnl_stream_t,
        engine: dnnl_engine_t,
        flags: c_uint,
    ) -> dnnl_status_t;

    pub fn dnnl_inner_product_forward_desc_init(
        inner_product_desc: *mut dnnl_inner_product_desc_t,
        prop_kind: dnnl_prop_kind_t,
        src_desc: const_dnnl_memory_desc_t,
        weights_desc: const_dnnl_memory_desc_t,
        bias_desc: const_dnnl_memory_desc_t,
        dst_desc: const_dnnl_memory_desc_t,
    ) -> dnnl_status_t;

    pub fn dnnl_eltwise_forward_desc_init(
        eltwise_desc: *mut dnnl_eltwise_desc_t,
        prop_kind: dnnl_prop_kind_t,
        alg_kind: c_int,
        data_desc: const_dnnl_memory_desc_t,
        alpha: f32,
        beta: f32,
    ) -> dnnl_status_t;

    pub fn dnnl_layer_normalization_forward_desc_init(
        lnorm_desc: *mut dnnl_layer_normalization_desc_t,
        prop_kind: dnnl_prop_kind_t,
        data_desc: const_dnnl_memory_desc_t,
        stat_desc: const_dnnl_memory_desc_t,
        epsilon: f32,
        flags: c_uint,
    ) -> dnnl_status_t;

    pub fn dnnl_primitive_desc_create(
        primitive_desc: *mut dnnl_primitive_desc_t,
        op_desc: const_dnnl_op_desc_t,
        attr: const_dnnl_primitive_attr_t,
        engine: dnnl_engine_t,
        hint_forward_primitive_desc: const_dnnl_primitive_desc_t,
    ) -> dnnl_status_t;

    pub fn dnnl_primitive_create(
        primitive: *mut dnnl_primitive_t,
        primitive_desc: const_dnnl_primitive_desc_t,
    ) -> dnnl_status_t;

    pub fn dnnl_primitive_execute(
        primitive: const_dnnl_primitive_desc_t,
        stream: dnnl_stream_t,
        nargs: c_int,
        args: *const dnnl_exec_arg_t,
    ) -> dnnl_status_t;
}
