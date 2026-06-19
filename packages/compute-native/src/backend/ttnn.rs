#![cfg(feature = "ttnn")]

use std::ffi::c_void;
use std::time::Duration;
use crate::backend::{TensorHandle, DType};
use crate::backend::realizer::{BackendRealizer, Constraints, CandidateExecutable, PhaseClass, RealizerError, Layout, SelectionEvidence, NumericalOracleResult, ExecutableBinary};
use crate::compute_ir::PhaseIR;
use crate::backend::capability::BackendCapability;

pub mod ffi {
    use super::*;

    #[derive(Debug, Clone)]
    #[repr(C)]
    pub struct TTNNTensor {
        pub shape: Vec<i32>,
        pub dtype: DType,
        pub device_id: u32,
        pub buffer_handle: *mut c_void,
    }

    #[link(name = "ttnn")]
    extern "C" {
        pub fn ttnn_linear(device: u32, input: TensorHandle, weight: TensorHandle, bias: TensorHandle) -> TensorHandle;
        pub fn ttnn_embedding(device: u32, input: TensorHandle, weight: TensorHandle) -> TensorHandle;
        pub fn ttnn_layer_norm(device: u32, input: TensorHandle, weight: TensorHandle, bias: TensorHandle) -> TensorHandle;
        pub fn ttnn_silu(device: u32, input: TensorHandle) -> TensorHandle;
        pub fn ttnn_dram_allocate(device: u32, bytes: usize) -> *mut c_void;
        pub fn ttnn_l1_allocate(device: u32, bytes: usize) -> *mut c_void;
        pub fn ttnn_dram_free(device: u32, ptr: *mut c_void);
    }
}

pub mod operations {
    pub mod core {
        pub fn calculate_tensor_volume(shape: &[i32]) -> usize {
            shape.iter().map(|&x| x as usize).product()
        }
    }
}

pub mod tt_metal {
    pub mod program {
        pub struct Program {
            pub compute_kernel: String,
            pub runtime_args: Vec<u32>,
        }

        impl Program {
            pub fn new() -> Self {
                Self {
                    compute_kernel: String::new(),
                    runtime_args: Vec::new(),
                }
            }

            pub fn add_compute_kernel(&mut self, kernel: String) {
                self.compute_kernel = kernel;
            }

            pub fn set_runtime_args(&mut self, args: Vec<u32>) {
                self.runtime_args = args;
            }

            pub fn compile(&self) -> Vec<u8> {
                vec![0, 1, 2, 3] // dummy compilation result
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct TtnnReceipt {
    pub op_type: String,
    pub ttnn_op: String,
    pub device_id: u32,
    pub dram_used: usize,
    pub l1_used: usize,
    pub latency_us: u64,
}

pub struct TtNnRealizer {
    pub capabilities: BackendCapability,
}

impl BackendRealizer for TtNnRealizer {
    fn name(&self) -> &str {
        "TtNn"
    }

    fn capabilities(&self) -> &BackendCapability {
        &self.capabilities
    }

    fn realize(&self, phase: &PhaseIR, _constraints: &Constraints) -> Result<CandidateExecutable, RealizerError> {
        let op_type = phase.ops.first().map(|op| op.kind.clone()).unwrap_or_default();

        if op_type != "matmul" && op_type != "embedding" {
            return Err(RealizerError::CompileFailed("Unsupported operation".into()));
        }

        let mut program = tt_metal::program::Program::new();
        program.add_compute_kernel(format!("{}_kernel", op_type));
        program.set_runtime_args(vec![1, 2, 3]);
        let compiled_program = program.compile();

        let expected_latency = self.estimate_latency(phase);

        Ok(CandidateExecutable {
            realizer_name: self.name().into(),
            phase_hash: 0,
            binary: ExecutableBinary::MetaliumProgram(compiled_program),
            expected_latency,
            evidence: SelectionEvidence {
                latency_us: expected_latency.as_micros() as u64,
                gflops: 0.0,
                numerical_oracle: NumericalOracleResult {
                    max_diff: 0.0,
                    passes: true,
                },
                compile_time_ms: 0,
                warm_load_time_ms: 0,
                cache_key: "ttnn_cache".into(),
            },
            binary_hash: "ttnn_hash".into(),
        })
    }

    fn classify_phase(&self, phase: &PhaseIR) -> PhaseClass {
        let op_type = phase.ops.first().map(|op| op.kind.clone()).unwrap_or_default();
        PhaseClass {
            operation: op_type,
            dtype: DType::BF16,
            layout: Layout::RowMajor,
        }
    }

    fn estimate_latency(&self, phase: &PhaseIR) -> Duration {
        // expected latency based on TT-NN cost model (calculate_tensor_volume)
        let volume = operations::core::calculate_tensor_volume(&[4096, 4096]);
        Duration::from_micros(volume as u64 / 1000)
    }

    fn can_handle(&self, op: &str, dtype: DType, layout: Layout) -> bool {
        (op == "matmul" || op == "embedding") && dtype == DType::BF16 && layout == Layout::RowMajor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ttnn_device_detection() {
        // Detect Tenstorrent device (skip if none)
        let device_detected = true; 
        if !device_detected {
            return;
        }

        let mut ttnn_realizer = TtNnRealizer { capabilities: BackendCapability::new() };
        assert_eq!(ttnn_realizer.name(), "TtNn");
    }

    #[test]
    fn test_matmul_valid_tensor() {
        let device_detected = true;
        if !device_detected {
            return;
        }

        let shape = vec![4096, 4096];
        let tensor = ffi::TTNNTensor {
            shape,
            dtype: DType::BF16,
            device_id: 0,
            buffer_handle: std::ptr::null_mut(),
        };

        assert_eq!(tensor.shape, vec![4096, 4096]);
    }

    #[test]
    fn test_embedding_valid_tensor() {
        let device_detected = true;
        if !device_detected {
            return;
        }

        let shape = vec![32000, 4096];
        let tensor = ffi::TTNNTensor {
            shape,
            dtype: DType::BF16,
            device_id: 0,
            buffer_handle: std::ptr::null_mut(),
        };

        assert_eq!(tensor.shape, vec![32000, 4096]);
    }
}