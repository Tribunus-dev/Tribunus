extern crate self as tribunus_compute_native;

pub mod analysis;
pub mod ane_bridge;
pub mod arena;
pub mod arena_lifecycle;
pub mod arena_pool;
pub mod attention;
pub mod backend;
pub mod bridge;
pub mod capability;
pub mod cli;
pub mod compile_pipeline;
pub mod compile_progress;
pub mod compile_state;
pub mod compiler;
pub mod compute_image;
pub mod compute_ir;
pub mod compute_lane;
pub mod compute_service;
pub mod config;
pub mod contracts;
pub mod copy_ledger;
pub mod coreml_audit;
pub mod coreml_bridge;
pub mod coreml_pipeline;
pub mod coreml_state;
pub mod cpu_benchmarks;
pub mod decode_attribution;
pub mod engine;
pub mod engine_error;
pub mod engine_policy;
pub mod engine_receipts;
pub mod errors;
pub mod executor;
pub mod experiment;
pub mod external_array;
pub mod fusion_region;
pub mod gemma;
pub mod gpu_worker;
pub mod hybrid_profile;
pub mod inference_profile;
pub mod kv_cache;
pub mod layout_compiler;
pub mod layout_transform;
pub mod loader;
pub mod mapped_image;
pub mod metal_capture;
pub mod mil_builder;
pub mod mlpackage;
pub mod mlx_executor;
pub mod mlx_inventory;
pub mod mlx_patch_register;
pub mod mlx_api_compat;
pub mod mlx_runtime_probe;
pub mod model;
pub mod model_runtime;
pub mod model_store;
pub mod native_kernel;
pub mod operation_catalog;
pub mod pipeline_parity;
pub mod placement_profile;
pub mod primitives;
pub mod profile_compiler;
pub mod profiled_executor;
pub mod projection_identity;
pub mod projection_tests;
pub mod quantized;
pub mod receipts;
pub mod replay_projection;
pub mod requalification;
pub mod research_contracts;
pub mod research_metrics;
pub mod research_trace;
pub mod residency;
pub mod runtime_trace;
pub mod session;
pub mod sidecar;
pub mod streaming;
pub mod toolchain_attest;
pub mod transform_recipe;
pub mod treatment;
pub mod validator;
pub mod worker_memory;
pub mod worker_protocol;
pub mod worker_supervisor;

pub use session::{
    ControlSessionState, GenerationControlSession, InferenceSession, InferenceSessionState,
    SamplerConfig,
};

#[cfg(not(feature = "napi"))]
extern crate self as napi;

#[cfg(not(feature = "napi"))]
#[derive(Debug, Clone, Copy)]
pub enum Status {
    InvalidArg,
    GenericFailure,
}

#[cfg(not(feature = "napi"))]
#[derive(Debug)]
pub struct Error {
    pub status: Status,
    pub reason: String,
}

#[cfg(not(feature = "napi"))]
impl Error {
    pub fn new(status: Status, reason: impl Into<String>) -> Self {
        Self { status, reason: reason.into() }
    }
    pub fn from_reason(reason: impl Into<String>) -> Self {
        Self { status: Status::GenericFailure, reason: reason.into() }
    }
}

#[cfg(not(feature = "napi"))]
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.reason)
    }
}

#[cfg(not(feature = "napi"))]
pub type Result<T> = std::result::Result<T, Error>;
