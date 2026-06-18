use std::time::Duration;
use crate::compute_ir::PhaseIR;
use crate::backend::capability::{BackendCapability, BackendCapabilityData};

pub type DataType = crate::backend::DType;

#[derive(Debug, Clone)]
pub struct Constraints {
    pub max_latency: Duration,
    pub require_deterministic: bool,
}

#[derive(Debug, Clone)]
pub struct PhaseClass {
    pub operation: String,
    pub dtype: DataType,
    pub layout: Layout,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Layout {
    RowMajor,
    ColMajor,
    Block,
    Opaque,
}

#[derive(Debug)]
pub struct CandidateExecutable {
    pub realizer_name: String,
    pub phase_hash: u64,
    pub binary: ExecutableBinary,
    pub expected_latency: Duration,
    pub evidence: SelectionEvidence,
    pub binary_hash: String, // SHA256 hash
}

#[derive(Debug)]
pub enum ExecutableBinary {
    TritonKernel(Vec<u8>),        // .cubin or .spv
    VendorLibrary(String, Vec<u8>), // library call params
    VulkanShader(Vec<u32>),       // SPIR-V
    MetalLibrary(Vec<u8>),        // .metallib
    CpuFallback(Vec<u8>),         // serialized function
    MetaliumProgram(Vec<u8>),     // TT-Metalium program
    ExternalEngine(String, String), // engine name + model path (vLLM/SGLang/TRT-LLM)
}

#[derive(Debug, Clone)]
pub struct NumericalOracleResult {
    pub max_diff: f64,
    pub passes: bool,
}

#[derive(Debug, Clone)]
pub struct SelectionEvidence {
    pub latency_us: u64,
    pub gflops: f64,
    pub numerical_oracle: NumericalOracleResult,
    pub compile_time_ms: u64,
    pub warm_load_time_ms: u64,
    pub cache_key: String,
}

pub trait BackendRealizer: Send + Sync {
    fn name(&self) -> &str;
    fn capabilities(&self) -> &BackendCapability;

    /// Accept a PhaseIR region, return a candidate executable
    fn realize(&self, phase: &PhaseIR, constraints: &Constraints) -> Result<CandidateExecutable, RealizerError>;

    /// Classify this phase into operation/dtype/layout triplet
    fn classify_phase(&self, phase: &PhaseIR) -> PhaseClass;

    /// Return estimated latency for a given phase
    fn estimate_latency(&self, phase: &PhaseIR) -> Duration;

    /// Check if this realizer can handle the operation with given constraints
    fn can_handle(&self, op: &str, dtype: DataType, layout: Layout) -> bool;
}

#[derive(Debug, Clone)]
pub enum RealizerError {
    UnsupportedDtype(String),
    UnsupportedLayout(String),
    UnsupportedMutation(String),
    UnsupportedDynamicShape(String),
    CompileFailed(String),
    LoadFailed(String),
    NumericalDivergence(String),
    PerformanceRegression(String),
    ReplayInvalid(String),
    CacheKeyMismatch(String),
    RuntimeDriverFault(String),
}

impl std::fmt::Display for RealizerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RealizerError::UnsupportedDtype(s) => write!(f, "UnsupportedDtype: {}", s),
            RealizerError::UnsupportedLayout(s) => write!(f, "UnsupportedLayout: {}", s),
            RealizerError::UnsupportedMutation(s) => write!(f, "UnsupportedMutation: {}", s),
            RealizerError::UnsupportedDynamicShape(s) => write!(f, "UnsupportedDynamicShape: {}", s),
            RealizerError::CompileFailed(s) => write!(f, "CompileFailed: {}", s),
            RealizerError::LoadFailed(s) => write!(f, "LoadFailed: {}", s),
            RealizerError::NumericalDivergence(s) => write!(f, "NumericalDivergence: {}", s),
            RealizerError::PerformanceRegression(s) => write!(f, "PerformanceRegression: {}", s),
            RealizerError::ReplayInvalid(s) => write!(f, "ReplayInvalid: {}", s),
            RealizerError::CacheKeyMismatch(s) => write!(f, "CacheKeyMismatch: {}", s),
            RealizerError::RuntimeDriverFault(s) => write!(f, "RuntimeDriverFault: {}", s),
        }
    }
}

// ── Stubs ────────────────────────────────────────────────────────────────

pub struct MlxMetalRealizer {
    pub capabilities: BackendCapability,
}

impl BackendRealizer for MlxMetalRealizer {
    fn name(&self) -> &str { "MlxMetal" }
    fn capabilities(&self) -> &BackendCapability { &self.capabilities }
    fn realize(&self, _phase: &PhaseIR, _constraints: &Constraints) -> Result<CandidateExecutable, RealizerError> {
        Err(RealizerError::CompileFailed("Stub".into()))
    }
    fn classify_phase(&self, _phase: &PhaseIR) -> PhaseClass {
        PhaseClass { operation: "stub".into(), dtype: DataType::F32, layout: Layout::Opaque }
    }
    fn estimate_latency(&self, _phase: &PhaseIR) -> Duration { Duration::from_secs(0) }
    fn can_handle(&self, op: &str, dtype: DataType, layout: Layout) -> bool {
        // Just a stub for testing
        op == "matmul" && dtype == DataType::F32 && layout == Layout::RowMajor
    }
}

pub struct TritonRealizer;
pub struct CuBlasLtRealizer;
pub struct VulkanRealizer;
pub struct CpuScalarRealizer;
pub struct TtNnRealizer;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::capability::*;
    use crate::decode_attribution::backend_adapters::BackendKind;

    #[test]
    fn test_mlx_metal_realizer_stub() {
        let cap = BackendCapability::new();
        cap.init(
            BackendIdentity {
                kind: BackendKind::Mlx,
                vendor: "Apple".into(),
                architecture: "Metal".into(),
                driver_version: "1.0".into(),
            },
            MemoryModel {
                unified_memory: true,
                max_allocation_bytes: 1024,
                alignment_requirements: 256,
            },
            DtypeSupport { supported_dtypes: vec![DataType::F32] },
            vec![],
            AliasingContract { supports_inplace: true, supports_views: true },
            ShapeContract { supports_dynamic_shapes: false },
            NumericalContract { deterministic: true },
            AsyncContract { supports_async_execution: true, max_streams: 1 },
            GraphContract { supports_fusion: false },
        );

        let realizer = MlxMetalRealizer { capabilities: cap };
        assert_eq!(realizer.name(), "MlxMetal");
        assert!(realizer.can_handle("matmul", DataType::F32, Layout::RowMajor));
        assert!(!realizer.can_handle("matmul", DataType::F16, Layout::RowMajor));
        assert!(!realizer.can_handle("conv", DataType::F32, Layout::RowMajor));
    }

    #[test]
    fn test_realizer_error_variants() {
        let errs = vec![
            RealizerError::UnsupportedDtype("f32".into()),
            RealizerError::UnsupportedLayout("row_major".into()),
            RealizerError::UnsupportedMutation("mut".into()),
            RealizerError::UnsupportedDynamicShape("shape".into()),
            RealizerError::CompileFailed("error".into()),
            RealizerError::LoadFailed("error".into()),
            RealizerError::NumericalDivergence("diverged".into()),
            RealizerError::PerformanceRegression("slow".into()),
            RealizerError::ReplayInvalid("invalid".into()),
            RealizerError::CacheKeyMismatch("mismatch".into()),
            RealizerError::RuntimeDriverFault("fault".into()),
        ];
        
        for err in errs {
            let msg = err.to_string();
            assert!(msg.contains(':'));
        }
    }
}
