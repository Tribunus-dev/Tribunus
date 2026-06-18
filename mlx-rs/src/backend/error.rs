use thiserror::Error;

#[derive(Debug, Error, Clone)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub enum MlxError {
    #[error("The requested dtype is not supported for the operation or readback path.")]
    UnsupportedDType,
    #[error("The requested shape is not supported.")]
    UnsupportedShape,
    #[error("The operation is not available through the current backend surface.")]
    UnsupportedOp,
    #[error("The requested device is unavailable or cannot be selected.")]
    UnsupportedDevice,
    #[error("The TensorSpec is malformed.")]
    InvalidTensorSpec,
    #[error("The logical descriptor cannot be represented as an MLX array layout through the current API.")]
    InvalidTensorLayout,
    #[error("MLX evaluation failed: {0}")]
    EvaluationFailed(String),
    #[error("The result could not be copied into a Rust-owned buffer for comparison: {0}")]
    ReadbackFailed(String),
    #[error("The operation ran but failed numerical comparison against the reference.")]
    NumericalMismatch,
    #[error("The binding boundary received invalid pointers, invalid lifetime assumptions, or another issue that indicates an unsafe/FFI contract problem.")]
    FfiBoundaryViolation,
    #[error("The MLX runtime is not available on the current platform.")]
    RuntimeUnavailable,
    #[error("Evidence or capabilities could not be serialized.")]
    SerializationFailed,
    #[error("The wrapper detected something that should be impossible if the code is correct.")]
    InternalInvariantViolation,
    #[error("External error: {0}")]
    External(String),
}

pub type MlxResult<T> = Result<T, MlxError>;

impl From<crate::error::Exception> for MlxError {
    fn from(err: crate::error::Exception) -> Self {
        MlxError::External(err.what)
    }
}
