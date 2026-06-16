//! First-class analysis surfaces for compute-native.
//!
//! This module groups the compiler, decode-attribution, and session contracts
//! under one umbrella so the compute module exposes a single coherent truth
//! model for runtime, analysis, and orchestration.

pub use crate::compiler;
pub use crate::compiler::{BackendLowering, LegalityReceipt, LegalityViolation, LoweringReceipt};
pub use crate::decode_attribution;
pub use crate::decode_attribution::graph_catalog::GraphFamily;
pub use crate::decode_attribution::suite_manifest::{SuiteRow, SuiteTier};
pub use crate::session;
pub use crate::session::{
    ControlSessionState, GenerationControlSession, InferenceSession, InferenceSessionState,
    SamplerConfig,
};
