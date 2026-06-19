use std::time::Duration;
use crate::backend::realizer::{BackendRealizer, CandidateExecutable, Constraints, PhaseClass, RealizerError, Layout, ExecutableBinary, SelectionEvidence, NumericalOracleResult};
use crate::compute_ir::PhaseIR;
use crate::backend::capability::{BackendCapability, BackendCapabilityData, BackendIdentity, MemoryModel, DtypeSupport, AliasingContract, ShapeContract, NumericalContract, AsyncContract, GraphContract};
use crate::backend::DType;
use crate::decode_attribution::backend_adapters::BackendKind;

/// Mock NCCL wrapper for multi-GPU communication.
pub struct NcclRealizer {
    capabilities: BackendCapability,
    device_count: usize,
}

impl NcclRealizer {
    pub fn new(device_count: usize) -> Self {
        let cap = BackendCapability::new();
        cap.init(
            BackendIdentity {
                kind: BackendKind::Reference, // Fallback kind
                vendor: "NVIDIA".into(),
                architecture: "CUDA+NCCL".into(),
                driver_version: "12.0".into(),
            },
            MemoryModel {
                unified_memory: false,
                max_allocation_bytes: 16 * 1024 * 1024 * 1024,
                alignment_requirements: 256,
            },
            DtypeSupport { supported_dtypes: vec![DType::F32, DType::F16, DType::BF16] },
            vec![], // layout requirements
            AliasingContract { supports_inplace: true, supports_views: true },
            ShapeContract { supports_dynamic_shapes: true },
            NumericalContract { deterministic: true },
            AsyncContract { supports_async_execution: true, max_streams: 8 },
            GraphContract { supports_fusion: false },
        );

        Self { capabilities: cap, device_count }
    }

    /// Simulate ncclCommInitRank.
    pub fn init_rank(&self, rank: usize) -> Result<(), String> {
        if rank >= self.device_count {
            return Err(format!("Invalid rank {} for device count {}", rank, self.device_count));
        }
        Ok(())
    }

    /// Simulate ncclAllReduce for gradient sync (training) and cross-device attention.
    pub fn all_reduce(&self, data: &mut [f32]) -> Result<(), String> {
        if self.device_count < 2 {
            return Err("AllReduce requires at least 2 NCCL-capable devices.".into());
        }
        // In a real implementation this would invoke NCCL over FFI.
        // For testing, we mock that the result is identical (e.g. multiplied by device count).
        for x in data.iter_mut() {
            *x *= self.device_count as f32;
        }
        Ok(())
    }

    /// Simulate ncclBroadcast for weight distribution.
    pub fn broadcast(&self, data: &mut [f32], root: usize) -> Result<(), String> {
        if root >= self.device_count {
            return Err(format!("Invalid root {} for device count {}", root, self.device_count));
        }
        Ok(())
    }

    pub fn assign_shards(&self) -> Vec<usize> {
        (0..self.device_count).collect()
    }
}

impl BackendRealizer for NcclRealizer {
    fn name(&self) -> &str {
        "NcclRealizer"
    }

    fn capabilities(&self) -> &BackendCapability {
        &self.capabilities
    }

    fn realize(&self, _phase: &PhaseIR, _constraints: &Constraints) -> Result<CandidateExecutable, RealizerError> {
        if self.device_count < 2 {
            return Err(RealizerError::CompileFailed("NCCL requires >=2 GPUs".into()));
        }

        // Return a mock vendor library call for NCCL communication
        Ok(CandidateExecutable {
            realizer_name: self.name().into(),
            phase_hash: 0,
            binary: ExecutableBinary::VendorLibrary("nccl".into(), vec![]),
            expected_latency: Duration::from_micros(50),
            evidence: SelectionEvidence {
                latency_us: 50,
                gflops: 0.0,
                numerical_oracle: NumericalOracleResult { max_diff: 0.0, passes: true },
                compile_time_ms: 1,
                warm_load_time_ms: 1,
                cache_key: "nccl_comm".into(),
            },
            binary_hash: "nccl_hash".into(),
        })
    }

    fn classify_phase(&self, _phase: &PhaseIR) -> PhaseClass {
        PhaseClass {
            operation: "communication".into(),
            dtype: DType::F32,
            layout: Layout::Opaque,
        }
    }

    fn estimate_latency(&self, _phase: &PhaseIR) -> Duration {
        Duration::from_micros(50)
    }

    fn can_handle(&self, op: &str, _dtype: DType, _layout: Layout) -> bool {
        op == "all_reduce" || op == "broadcast"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nccl_capabilities() {
        let realizer = NcclRealizer::new(2);
        assert_eq!(realizer.name(), "NcclRealizer");
        assert!(realizer.can_handle("all_reduce", DType::F32, Layout::Opaque));
    }

    #[test]
    fn test_nccl_all_reduce() {
        let realizer = NcclRealizer::new(2);
        assert!(realizer.init_rank(0).is_ok());
        assert!(realizer.init_rank(1).is_ok());
        assert!(realizer.init_rank(2).is_err());

        let mut data = vec![1.0, 2.0, 3.0];
        assert!(realizer.all_reduce(&mut data).is_ok());
        assert_eq!(data, vec![2.0, 4.0, 6.0]);
    }

    #[test]
    fn test_nccl_requires_multiple_gpus() {
        let realizer = NcclRealizer::new(1);
        let mut data = vec![1.0, 2.0];
        assert!(realizer.all_reduce(&mut data).is_err());
    }

    #[test]
    fn test_nccl_broadcast() {
        let realizer = NcclRealizer::new(2);
        let mut data = vec![1.0, 2.0];
        assert!(realizer.broadcast(&mut data, 0).is_ok());
        assert!(realizer.broadcast(&mut data, 2).is_err());
    }
}
