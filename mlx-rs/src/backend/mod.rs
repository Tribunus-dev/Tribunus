//! Backend foundation module for Tribunus compute.
#![allow(missing_docs)]
pub mod capabilities;
pub mod dtype;
pub mod error;
pub mod eval;
pub mod evidence;
pub mod ops;
pub mod reference;
pub mod tensor;

pub use capabilities::{ImplementationKind, MlxBackendCapabilities, SupportStatus};
pub use dtype::DType;
pub use error::{MlxError, MlxResult};
pub use eval::{eval_array, eval_arrays, readback_f32};
pub use evidence::{ConformanceEvidence, NumericalComparison};
pub use ops::BackendConformanceRunner;
pub use tensor::{DevicePreference, TensorLayout, TensorRole, TensorSpec};
