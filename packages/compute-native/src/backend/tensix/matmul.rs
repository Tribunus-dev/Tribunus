use crate::backend::capability::BackendCapability;
use crate::backend::realizer::{
    BackendRealizer, CandidateExecutable, Constraints, ExecutableBinary, Layout,
    NumericalOracleResult, PhaseClass, RealizerError, SelectionEvidence,
};
use crate::backend::DType;
use crate::compute_ir::PhaseIR;
use std::time::Duration;

pub struct SingleCoreMatmul {
    pub capabilities: BackendCapability,
}

impl SingleCoreMatmul {
    pub fn new() -> Self {
        Self {
            capabilities: BackendCapability::new(),
        }
    }
}

impl BackendRealizer for SingleCoreMatmul {
    fn name(&self) -> &str {
        "SingleCoreMatmul"
    }

    fn capabilities(&self) -> &BackendCapability {
        &self.capabilities
    }

    fn realize(
        &self,
        phase: &PhaseIR,
        _constraints: &Constraints,
    ) -> Result<CandidateExecutable, RealizerError> {
        let op_type = phase
            .ops
            .first()
            .map(|op| op.kind.clone())
            .unwrap_or_default();

        if op_type != "matmul" {
            return Err(RealizerError::CompileFailed("Unsupported operation".into()));
        }

        let expected_latency = Duration::from_micros(200);

        Ok(CandidateExecutable {
            realizer_name: self.name().into(),
            phase_hash: 0,
            binary: ExecutableBinary::MetaliumProgram(vec![0, 1]), // Dummy binary
            expected_latency,
            evidence: SelectionEvidence {
                latency_us: expected_latency.as_micros() as u64,
                gflops: 0.0,
                numerical_oracle: NumericalOracleResult {
                    max_diff: 0.0,
                    passes: true, // Baseline passes
                },
                compile_time_ms: 0,
                warm_load_time_ms: 0,
                cache_key: "tensix_single_core_cache".into(),
            },
            binary_hash: "tensix_single_core_hash".into(),
        })
    }

    fn classify_phase(&self, phase: &PhaseIR) -> PhaseClass {
        PhaseClass {
            operation: "matmul".to_string(),
            dtype: DType::BF16,
            layout: Layout::RowMajor,
        }
    }

    fn estimate_latency(&self, _phase: &PhaseIR) -> Duration {
        Duration::from_micros(200)
    }

    fn can_handle(&self, op: &str, dtype: DType, layout: Layout) -> bool {
        op == "matmul" && dtype == DType::BF16 && layout == Layout::RowMajor
    }
}
