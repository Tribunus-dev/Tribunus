use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TensixAdmissionState {
    Declared,
    Compiled,
    Validated,
    Admitted,
    Degraded,
    Quarantined,
    Evicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TensixArtifactCacheKey {
    pub capability_signature_hash: String,
    pub ir_hash: String,
    pub transform_hash: String,
    pub data_format: String,
    pub tile_geometry: String,
    pub core_range: String,
    pub cb_abi_version: u32,
    pub tt_metalium_version: String,
    pub compiler_flags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlacementPolicy {
    SingleDevice,
    MultiDeviceMesh,
    MultiDevicePipeline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixPlacementPlan {
    pub policy: PlacementPolicy,
    pub core_range: String,
    pub tile_shape: String,
    pub cb_config: Vec<String>,
    pub mesh_topology: Vec<Vec<u32>>,
}
