use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};


/// Tensix Schedule IR: target-lowering layer from canonical Tribunus operations
/// to Tensix execution concepts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct TensixScheduleIR {
    pub nodes: Vec<TensixNode>,
    pub buffers: Vec<CircularBufferAllocation>,
    pub sharding: DramSharding,
    pub routing: NocRouteIntent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum TensixNode {
    Elementwise(ElementwiseNode),
    Matmul(MatmulNode),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ElementwiseNode {
    pub opcode: String,
    pub inputs: Vec<String>,
    pub output: String,
    pub core_partition: CorePartitioning,
    pub tile_geometry: TileGeometry,
    pub data_format: DataFormat,
    pub roles: Vec<RiscvRole>,
    pub scalar_args: Vec<RuntimeScalarArg>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct MatmulNode {
    pub inputs: Vec<String>,
    pub output: String,
    pub core_partition: CorePartitioning,
    pub tile_geometry: TileGeometry,
    pub data_format: DataFormat,
    pub roles: Vec<RiscvRole>,
    pub scalar_args: Vec<RuntimeScalarArg>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct TileGeometry {
    pub height: u32,
    pub width: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct CorePartitioning {
    pub core_x: u32,
    pub core_y: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum RiscvRole {
    Reader,
    Compute,
    Writer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct CircularBufferAllocation {
    pub buffer_id: u32,
    pub size_bytes: u32,
    pub data_format: DataFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct DramSharding {
    pub shards: Vec<Shard>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Shard {
    pub tensor_id: String,
    pub core_x: u32,
    pub core_y: u32,
    pub size_bytes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct NocRouteIntent {
    pub routes: Vec<Route>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Route {
    pub src_core_x: u32,
    pub src_core_y: u32,
    pub dst_core_x: u32,
    pub dst_core_y: u32,
    pub buffer_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum DataFormat {
    Float32,
    Float16,
    BFloat16,
    Int32,
    Int8,
    UInt32,
    UInt8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum RuntimeScalarArg {
    Float32(u32), // Representation of f32 for hashability
    Int32(i32),
    UInt32(u32),
}

impl RuntimeScalarArg {
    pub fn from_f32(val: f32) -> Self {
        RuntimeScalarArg::Float32(val.to_bits())
    }
}

impl TensixScheduleIR {
    pub fn digest(&self) -> String {
        let serialized = serde_json::to_string(self).expect("Serialization failed");
        let mut hasher = Sha256::new();
        hasher.update(serialized.as_bytes());
        format!("{:x}", hasher.finalize())
    }
}
