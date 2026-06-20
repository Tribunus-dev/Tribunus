use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MachineProfile {
    pub observed_hardware: HardwareProfile,
    pub observed_backend_capabilities: BackendCapabilities,
    pub compiler_assumptions: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HardwareProfile {
    pub cpu_model: String,
    pub gpu_metal_family: Option<String>,
    pub ram_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackendCapabilities {
    pub accelerate_available: bool,
    pub mlx_version: Option<String>,
    pub metal_feature_set: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelGraph {
    pub architecture: String,
    pub layer_count: usize,
    pub head_count: usize,
    pub embedding_dimension: usize,
    pub quantization_scheme: String,
    pub weight_hashes: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MemoryLayout {
    pub weights: usize,
    pub activations: usize,
    pub kv_cache: usize,
    pub scratch: usize,
    pub total_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MemoryRange {
    pub offset: usize,
    pub size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BlockDescriptor {
    pub block_id: String,
    pub processor: String, // "cpu" | "gpu" | "npu"
    pub backend: String,   // "accelerate" | "mlx-metal" | "coreml"
    pub kernel_identity: String,
    pub input_offsets: Vec<MemoryRange>,
    pub output_offsets: Vec<MemoryRange>,
    pub expected_tolerance: f32,
    pub sync_mask: u32,
    pub shape: Option<Vec<usize>>, // For violation testing
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvidenceLedger {
    pub block_id: String,
    pub kernel_source_hash: String,
    pub compiled_artifact_hash: String,
    pub backend_version: String,
    pub metal_feature_set: Option<String>,
    pub mlx_version: Option<String>,
    pub qualification_report: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GoldenPathPlan {
    pub machine_profile: MachineProfile,
    pub model_graph: ModelGraph,
    pub memory_layout: MemoryLayout,
    pub dispatch_table: Vec<BlockDescriptor>,
    pub evidence_ledger: Vec<EvidenceLedger>,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuditEvent {
    pub block_id: String,
    pub backend: String,
    pub kernel_identity: String,
    pub started_at: u64,
    pub completed_at: u64,
    pub input_checksum: Option<[u8; 32]>,
    pub output_checksum: Option<[u8; 32]>,
    pub tolerance_met: Option<bool>,
    pub error: Option<String>,
}
