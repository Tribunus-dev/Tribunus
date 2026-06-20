use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixArtifact {
    pub source_hash: String,
    pub compiler_version: String,
    pub architecture_generation: String,
    pub target_profile: TensixTargetProfile,
    pub compatibility: TensixArtifactCompatibility,
    pub recipes: Vec<TensixProgramRecipe>,
    pub binary_blob_id: String, // Reference to the actual compiled binaries within the compute image
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixTargetProfile {
    pub grid_placement: TensixCoreRange,
    pub build_options: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixArtifactCompatibility {
    pub tensor_abi_version: String,
    pub memory_layout_version: String,
    pub cb_abi_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixProgramRecipe {
    pub program_id: String,
    pub kernel_roles: Vec<TensixKernelRole>,
    pub buffer_bindings: Vec<TensixBufferBinding>,
    pub circular_buffers: Vec<TensixCircularBufferContract>,
    pub noc_contracts: Vec<TensixNoCContract>,
    pub queue_contracts: Vec<TensixQueueContract>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TensixKernelRole {
    DataMovementReceiver,
    DataMovementSender,
    ComputeMath,
    ComputeUnpack,
    ComputePack,
    HostOrchestrator,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixBufferBinding {
    pub binding_id: String,
    pub logical_name: String,
    pub memory_type: String, // e.g., "DRAM", "L1"
    pub size_bytes: u64,
    pub page_size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixCircularBufferContract {
    pub cb_id: u32,
    pub data_format: String,
    pub page_size: u32,
    pub num_pages: u32,
    pub core_range: TensixCoreRange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixCoreRange {
    pub start_x: u32,
    pub start_y: u32,
    pub end_x: u32,
    pub end_y: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixNoCContract {
    pub noc_id: u32,          // 0 or 1
    pub routing_mode: String, // "multicast", "unicast"
    pub expected_latency_ns: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixQueueContract {
    pub queue_id: String,
    pub depth: u32,
    pub entry_size_bytes: u64,
}
