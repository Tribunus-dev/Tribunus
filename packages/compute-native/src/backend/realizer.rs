#[cfg(not(feature = "rocm"))]
pub struct RocmRealizer;

#[cfg(not(feature = "rocm"))]
pub struct HipTritonRealizer;

#[cfg(feature = "rocm")]
pub use crate::backend::rocm::RocmRealizer;

#[cfg(feature = "rocm")]
pub use crate::backend::hip_triton::HipTritonRealizer;
