use super::capabilities::{ImplementationKind, SupportStatus};
use super::tensor::TensorSpec;

#[derive(Debug, Clone)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub struct MlxErrorReport {
    pub category: String,
    pub message: String,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub struct NumericalComparison {
    pub reference: String,
    pub tolerance_abs: f64,
    pub tolerance_rel: f64,
    pub max_abs_error: f64,
    pub mean_abs_error: f64,
    pub max_rel_error: f64,
    pub nan_count: usize,
    pub inf_count: usize,
    pub first_mismatch_index: Option<usize>,
    pub passed: bool,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub struct ConformanceEvidence {
    pub schema_version: String,
    pub case_id: String,
    pub op: String,
    pub implementation: ImplementationKind,
    pub support_status: SupportStatus,
    pub inputs: Vec<TensorSpec>,
    pub outputs: Vec<TensorSpec>,
    pub eval_forced: bool,
    pub readback_performed: bool,
    pub comparison: Option<NumericalComparison>,
    pub error: Option<MlxErrorReport>,
}
