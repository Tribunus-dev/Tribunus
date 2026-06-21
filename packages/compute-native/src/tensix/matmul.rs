use super::device::ResidencyHandle;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FailureClassification {
    HostBridgeIssue,
    TensorLayoutMismatch,
    WeightPackingError,
    DramTransferFault,
    CircularBufferSchedulingBug,
    KernelCorrectness,
    ReadbackError,
    Success,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceTiming {
    pub compile_time: Duration,
    pub load_time: Duration,
    pub execute_time: Duration,
    pub readback_time: Duration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatmulValidationReport {
    pub tolerance: f32,
    pub max_error: f32,
    pub timing: DeviceTiming,
    pub classification: FailureClassification,
    pub shape_a: Vec<usize>,
    pub shape_b: Vec<usize>,
}

pub trait MatmulProvider {
    fn execute_matmul(
        &self,
        a_data: &[i8],
        a_shape: &[usize],
        w_handle: ResidencyHandle,
        w_shape: &[usize],
    ) -> Result<(Vec<f32>, MatmulValidationReport), FailureClassification>;
}
