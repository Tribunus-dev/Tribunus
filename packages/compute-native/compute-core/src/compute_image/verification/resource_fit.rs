use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceFitReceipt {
    pub artifact_identity: String,
    pub resource_fit_ok: bool,
    pub peak_memory_bytes: u64,
    pub peak_threadgroup_memory: u64,
    pub register_count: u32,
    pub threadgroup_size: u32,
}
