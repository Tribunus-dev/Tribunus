use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixPlacementPlan {
    pub policy: PlacementPolicy,
    pub tensor_parallel_shards: u32,
    pub topology: TopologyDescription,
    pub failure_domain: FailureDomain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlacementPolicy {
    SingleCore,
    MultiCoreOnChip,
    SingleDevice,
    MultiDeviceMesh,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyDescription {
    pub mesh_dims: Vec<u32>,
    pub device_links: Vec<DeviceLink>,
    pub collective_caps: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceLink {
    pub source: u32,
    pub target: u32,
    pub noc_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FailureDomain {
    Node,
    Rack,
    Zone,
}
