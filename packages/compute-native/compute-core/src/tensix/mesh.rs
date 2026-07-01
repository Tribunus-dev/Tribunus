use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixMeshTopology {
    pub devices: Vec<DeviceNode>,
    pub links: Vec<TopologyLink>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceNode {
    pub coordinate: (u32, u32), // (x, y) mesh coordinate
    pub chip_id: u32,
    pub core_grid: (u32, u32), // (rows, cols)
    pub usable_dram_bytes: u64,
    pub fault_domain: String,
    pub legal_collectives: Vec<CollectiveClass>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CollectiveClass {
    AllReduce,
    AllGather,
    ReduceScatter,
    Broadcast,
    Scatter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkClass {
    PCIe,
    Ethernet,
    NoC,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyLink {
    pub source_chip: u32,
    pub target_chip: u32,
    pub class: LinkClass,
    pub bandwidth_gbps: u32,
    pub latency_ns: u32,
}

impl TensixMeshTopology {
    pub fn hash(&self) -> String {
        let serialized = serde_json::to_string(self).expect("failed to serialize topology");
        let mut hasher = Sha256::new();
        hasher.update(serialized.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    pub fn degenerate_single_chip(core_grid: (u32, u32), usable_dram_bytes: u64) -> Self {
        Self {
            devices: vec![DeviceNode {
                coordinate: (0, 0),
                chip_id: 0,
                core_grid,
                usable_dram_bytes,
                fault_domain: "local".to_string(),
                legal_collectives: vec![],
            }],
            links: vec![],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixMeshPlacementDescriptor {
    pub tensor_id: String,
    pub residency: TensorResidency,
    pub partitioning: TensorPartitioning,
    pub movement_trigger: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TensorResidency {
    ChipDram { chip_id: u32, segment: String },
    CoreL1 { chip_id: u32, core: (u32, u32) },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TensorPartitioning {
    Replicated,
    ShardedByChannel { num_shards: u32 },
    ShardedByHead { num_shards: u32 },
    Owned { owner_chip: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactCompatibility {
    pub topology_hash: String,
}

impl ArtifactCompatibility {
    pub fn is_compatible(&self, topology: &TensixMeshTopology) -> bool {
        self.topology_hash == topology.hash()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_degenerate_topology_hash() {
        let topo1 = TensixMeshTopology::degenerate_single_chip((8, 8), 16 * 1024 * 1024 * 1024);
        let topo2 = TensixMeshTopology::degenerate_single_chip((8, 8), 16 * 1024 * 1024 * 1024);
        let topo3 = TensixMeshTopology::degenerate_single_chip((8, 8), 32 * 1024 * 1024 * 1024);

        assert_eq!(topo1.hash(), topo2.hash());
        assert_ne!(topo1.hash(), topo3.hash());
    }

    #[test]
    fn test_artifact_admission() {
        let topo = TensixMeshTopology::degenerate_single_chip((8, 8), 16 * 1024 * 1024 * 1024);
        let artifact_compat = ArtifactCompatibility {
            topology_hash: topo.hash(),
        };

        assert!(artifact_compat.is_compatible(&topo));

        let wrong_topo =
            TensixMeshTopology::degenerate_single_chip((12, 10), 16 * 1024 * 1024 * 1024);
        assert!(!artifact_compat.is_compatible(&wrong_topo));
    }
}
