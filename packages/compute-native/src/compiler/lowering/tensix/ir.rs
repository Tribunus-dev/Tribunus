//! Tensix Schedule IR - represents physical geometry and scheduling constraints.
use std::collections::HashMap;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TensixScheduleIR {
    pub tile_geometry: [u32; 2], // typically [32, 32]
    pub core_partitioning: [u32; 2],
    pub cb_allocations: HashMap<String, u32>,
    pub dram_sharding: bool,
    pub data_format: String,
}
