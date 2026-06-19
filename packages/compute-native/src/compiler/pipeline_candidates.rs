use std::time::Duration;
use crate::compute_ir::PhaseIR;
use crate::decode_attribution::backend_adapters::BackendKind;

pub struct SystemTopology {
    pub available_backends: Vec<BackendKind>,
}

impl SystemTopology {
    pub fn new(backends: Vec<BackendKind>) -> Self {
        Self { available_backends: backends }
    }
}

pub struct PhaseCandidates {
    pub phase: PhaseIR,
    pub candidates: Vec<RealizerCandidate>,
}

#[derive(Debug, Clone)]
pub struct RealizerCandidate {
    pub realizer_name: String,
    pub estimated_latency: Duration,
    pub compile_time_estimate: Duration,
    pub estimated_gflops: f64,
    pub backend: BackendKind,
}

pub fn generate_candidates(phases: &[PhaseIR], topology: &SystemTopology) -> Result<Vec<PhaseCandidates>, String> {
    let mut all_candidates = Vec::new();

    for phase in phases {
        let mut candidates = Vec::new();
        
        candidates.push(RealizerCandidate {
            realizer_name: "CpuFallback".into(),
            estimated_latency: Duration::from_micros(1000),
            compile_time_estimate: Duration::from_micros(10),
            estimated_gflops: 1.0,
            backend: BackendKind::Reference,
        });

        let is_matmul = phase.ops.iter().any(|op| op.kind == "matmul");
        let is_rms_norm = phase.ops.iter().any(|op| op.kind == "rms_norm");
        let is_rope = phase.ops.iter().any(|op| op.kind == "rope");
        let is_flash_attention = phase.ops.iter().any(|op| op.kind == "flash_attention");
        let is_kv_append = phase.ops.iter().any(|op| op.kind == "kv_append");
        let is_silu = phase.ops.iter().any(|op| op.kind == "silu");

        for backend in &topology.available_backends {
            if *backend == BackendKind::Mlx {
                if is_matmul || is_rms_norm || is_rope || is_flash_attention || is_silu {
                    candidates.push(RealizerCandidate {
                        realizer_name: "MlxMetal".into(),
                        estimated_latency: Duration::from_micros(100),
                        compile_time_estimate: Duration::from_micros(50),
                        estimated_gflops: 100.0,
                        backend: BackendKind::Mlx,
                    });
                }
            }
        }

        if topology.available_backends.contains(&BackendKind::Cuda) {
            if is_matmul {
                candidates.push(RealizerCandidate {
                    realizer_name: "TritonKernel".into(),
                    estimated_latency: Duration::from_micros(50),
                    compile_time_estimate: Duration::from_micros(500),
                    estimated_gflops: 200.0,
                    backend: BackendKind::Cuda,
                });
                candidates.push(RealizerCandidate {
                    realizer_name: "cuBLASLt".into(),
                    estimated_latency: Duration::from_micros(40),
                    compile_time_estimate: Duration::from_micros(5),
                    estimated_gflops: 250.0,
                    backend: BackendKind::Cuda,
                });
            }
            if is_rms_norm || is_rope || is_silu {
                candidates.push(RealizerCandidate {
                    realizer_name: "TritonKernel".into(),
                    estimated_latency: Duration::from_micros(20),
                    compile_time_estimate: Duration::from_micros(100),
                    estimated_gflops: 50.0,
                    backend: BackendKind::Cuda,
                });
            }
            if is_flash_attention {
                candidates.push(RealizerCandidate {
                    realizer_name: "TritonKernel".into(),
                    estimated_latency: Duration::from_micros(80),
                    compile_time_estimate: Duration::from_micros(500),
                    estimated_gflops: 150.0,
                    backend: BackendKind::Cuda,
                });
                candidates.push(RealizerCandidate {
                    realizer_name: "CUTLASS".into(),
                    estimated_latency: Duration::from_micros(70),
                    compile_time_estimate: Duration::from_micros(1000),
                    estimated_gflops: 180.0,
                    backend: BackendKind::Cuda,
                });
            }
            if is_kv_append {
                candidates.push(RealizerCandidate {
                    realizer_name: "CustomCuda".into(),
                    estimated_latency: Duration::from_micros(10),
                    compile_time_estimate: Duration::from_micros(100),
                    estimated_gflops: 10.0,
                    backend: BackendKind::Cuda,
                });
            }
        }

        if topology.available_backends.contains(&BackendKind::Vulkan) {
            if is_matmul {
                candidates.push(RealizerCandidate {
                    realizer_name: "VulkanShader".into(),
                    estimated_latency: Duration::from_micros(120),
                    compile_time_estimate: Duration::from_micros(200),
                    estimated_gflops: 80.0,
                    backend: BackendKind::Vulkan,
                });
            }
        }

        if topology.available_backends.contains(&BackendKind::LevelZero) {
            if is_kv_append {
                candidates.push(RealizerCandidate {
                    realizer_name: "LevelZeroCustom".into(),
                    estimated_latency: Duration::from_micros(15),
                    compile_time_estimate: Duration::from_micros(100),
                    estimated_gflops: 10.0,
                    backend: BackendKind::LevelZero,
                });
            }
        }
        
        if topology.available_backends.contains(&BackendKind::CpuFast) {
            if is_rms_norm {
                candidates.push(RealizerCandidate {
                    realizer_name: "oneDNN".into(),
                    estimated_latency: Duration::from_micros(50),
                    compile_time_estimate: Duration::from_micros(5),
                    estimated_gflops: 20.0,
                    backend: BackendKind::CpuFast,
                });
            }
            if is_matmul {
                candidates.push(RealizerCandidate {
                    realizer_name: "OpenBLAS".into(),
                    estimated_latency: Duration::from_micros(500),
                    compile_time_estimate: Duration::from_micros(5),
                    estimated_gflops: 10.0,
                    backend: BackendKind::CpuFast,
                });
            }
        }

        all_candidates.push(PhaseCandidates {
            phase: phase.clone(),
            candidates,
        });
    }

    Ok(all_candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute_ir::IROp;

    #[test]
    fn test_generate_candidates_fallback() {
        let topology = SystemTopology::new(vec![]);
        let phase = PhaseIR {
            ops: vec![IROp {
                kind: "matmul".into(),
                input_tensors: vec![],
                output_tensors: vec![],
                metadata: Default::default(),
            }],
            dependencies: vec![],
            candidates: vec![],
            state_effects: vec![],
        };
        let result = generate_candidates(&[phase], &topology).unwrap();
        assert_eq!(result.len(), 1);
        
        assert!(result[0].candidates.iter().any(|c| c.realizer_name == "CpuFallback"));
        assert!(!result[0].candidates.iter().any(|c| c.realizer_name == "OpenBLAS")); // Not in topology
    }

    #[test]
    fn test_generate_candidates_5_phase() {
        let topology = SystemTopology::new(vec![
            BackendKind::Mlx,
            BackendKind::Cuda,
            BackendKind::Vulkan,
            BackendKind::LevelZero,
        ]);
        let phases = vec![
            PhaseIR {
                ops: vec![IROp { kind: "matmul".into(), input_tensors: vec![], output_tensors: vec![], metadata: Default::default() }],
                dependencies: vec![], candidates: vec![], state_effects: vec![],
            },
            PhaseIR {
                ops: vec![IROp { kind: "rms_norm".into(), input_tensors: vec![], output_tensors: vec![], metadata: Default::default() }],
                dependencies: vec![], candidates: vec![], state_effects: vec![],
            },
            PhaseIR {
                ops: vec![IROp { kind: "rope".into(), input_tensors: vec![], output_tensors: vec![], metadata: Default::default() }],
                dependencies: vec![], candidates: vec![], state_effects: vec![],
            },
            PhaseIR {
                ops: vec![IROp { kind: "flash_attention".into(), input_tensors: vec![], output_tensors: vec![], metadata: Default::default() }],
                dependencies: vec![], candidates: vec![], state_effects: vec![],
            },
            PhaseIR {
                ops: vec![IROp { kind: "kv_append".into(), input_tensors: vec![], output_tensors: vec![], metadata: Default::default() }],
                dependencies: vec![], candidates: vec![], state_effects: vec![],
            },
        ]; // Exactly 5 phases for the 5-phase test requirement

        let result = generate_candidates(&phases, &topology).unwrap();
        assert_eq!(result.len(), 5);

        for phase_candidates in result {
            assert!(phase_candidates.candidates.iter().any(|c| c.realizer_name == "CpuFallback"));
        }
    }
}