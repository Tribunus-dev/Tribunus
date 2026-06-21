use serde::{Deserialize, Serialize};
use crate::tensix::mesh::{TensixMeshTopology, CollectiveClass};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixParallelMatmulPlan {
    pub num_devices: u32,
    pub shard_spec: ShardSpec,
    pub collective_schedule: Vec<CollectiveOp>,
    pub per_device_fragments: Vec<ProgramFragment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShardSpec {
    SplitOutputChannels { num_shards: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectiveOp {
    pub collective_class: CollectiveClass,
    pub tensor_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgramFragment {
    pub device_index: u32,
    pub program_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AdmissionError {
    TopologyMismatch { required_devices: u32, actual_devices: u32 },
}

impl TensixParallelMatmulPlan {
    pub fn admit(&self, topology: &TensixMeshTopology) -> Result<(), AdmissionError> {
        if topology.devices.len() as u32 != self.num_devices {
            return Err(AdmissionError::TopologyMismatch {
                required_devices: self.num_devices,
                actual_devices: topology.devices.len() as u32,
            });
        }
        Ok(())
    }
}
