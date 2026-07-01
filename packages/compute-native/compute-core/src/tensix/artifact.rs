use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensixKernelOp {
    pub name: String,
    pub reader_kernel: String,
    pub compute_kernel: String,
    pub writer_kernel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensixComputeArtifact {
    pub manifest_format: String, // "session-17"
    pub op_type: String,
    pub input_cb_depth: usize,
    pub output_cb_depth: usize,
    pub grid_size: (usize, usize),
    pub hash: String,
    pub kernel: TensixKernelOp,
}
