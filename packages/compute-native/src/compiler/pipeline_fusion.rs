use crate::compute_ir::{PhaseIR, PhaseTensor, PhaseMetadata, ArenaRequirements};
use crate::decode_attribution::backend_adapters::BackendKind;

#[derive(Debug, Clone)]
pub struct SharedTensor {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct FusedRegion {
    pub name: String,
    pub phases: Vec<PhaseIR>,
    pub backend_hint: BackendKind,
    pub shared_tensors: Vec<SharedTensor>,  // tensors that cross sub-phase boundaries
}

pub fn form_regions(phases: &[PhaseIR]) -> Result<Vec<FusedRegion>, String> {
    let mut regions = Vec::new();
    let mut current_region_phases: Vec<PhaseIR> = vec![];
    
    for phase in phases {
        if current_region_phases.is_empty() {
            current_region_phases.push(phase.clone());
            continue;
        }

        let last_phase = current_region_phases.last().unwrap();
        let should_fuse = check_fusion(last_phase, phase);

        if should_fuse {
            current_region_phases.push(phase.clone());
        } else {
            regions.push(create_region(current_region_phases)?);
            current_region_phases = vec![phase.clone()];
        }
    }

    if !current_region_phases.is_empty() {
        regions.push(create_region(current_region_phases)?);
    }

    Ok(regions)
}

fn create_region(phases: Vec<PhaseIR>) -> Result<FusedRegion, String> {
    if phases.is_empty() {
        return Err("Cannot create region from empty phase list".to_string());
    }

    // Determine backend hint
    let backend_hints: Vec<&String> = phases.iter()
        .flat_map(|p| p.metadata.backend_hints.iter())
        .collect();
    
    let backend_hint = if backend_hints.iter().any(|h: &&String| h.contains("vulkan")) {
        BackendKind::Reference
    } else if backend_hints.iter().any(|h: &&String| h.contains("metal")) {
        BackendKind::Mlx
    } else if backend_hints.iter().any(|h: &&String| h.contains("coreml")) {
        BackendKind::CoreMl
    } else if backend_hints.iter().any(|h: &&String| h.contains("accelerate")) {
        BackendKind::Accelerate
    } else {
        BackendKind::Reference
    };

    let mut shared_tensors = vec![];
    
    // Calculate shared tensors (cross sub-phase boundaries)
    for i in 0..phases.len() {
        for output in &phases[i].outputs {
            for j in (i+1)..phases.len() {
                if phases[j].inputs.iter().any(|input| input.name == output.name) {
                    shared_tensors.push(SharedTensor {
                        id: output.name.clone(),
                        name: output.name.clone(),
                    });
                    break;
                }
            }
        }
    }

    Ok(FusedRegion {
        name: format!("fused_{}", phases.len()),
        phases,
        backend_hint,
        shared_tensors,
    })
}

fn get_backend(phase: &PhaseIR) -> Option<&String> {
    phase.metadata.backend_hints.first()
}

fn check_fusion(a: &PhaseIR, b: &PhaseIR) -> bool {
    let backend_a = get_backend(a);
    let backend_b = get_backend(b);
    
    if backend_a != backend_b {
        return false;
    }

    let a_name = a.name.to_lowercase();
    let b_name = b.name.to_lowercase();

    if a_name.contains("dequant") && b_name.contains("matmul") {
        return true;
    }

    if a_name.contains("norm") && b_name.contains("residual") {
        if a.metadata.arena_requirements.residency_tier == b.metadata.arena_requirements.residency_tier {
            return true;
        }
    }

    if a_name.contains("silu") && b_name.contains("matmul") {
        return true;
    }

    if a_name.contains("rope") && b_name.contains("kv_append") {
        return true;
    }

    if a_name.contains("q_proj") && b_name.contains("k_proj") {
        return true;
    }
    if a_name.contains("k_proj") && b_name.contains("v_proj") {
        return true;
    }

    if a_name.contains("attention") && b_name.contains("mlp") {
        return false;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_dummy_phase(name: &str, backend: &str, outputs: Vec<&str>, inputs: Vec<&str>) -> PhaseIR {
        PhaseIR {
            name: name.to_string(),
            ops: vec![],
            inputs: inputs.into_iter().map(|s| PhaseTensor {
                name: s.to_string(),
                shape: vec![1, 1],
                dtype: crate::backend::DType::F32,
                strides: vec![1],
            }).collect(),
            outputs: outputs.into_iter().map(|s| PhaseTensor {
                name: s.to_string(),
                shape: vec![1, 1],
                dtype: crate::backend::DType::F32,
                strides: vec![1],
            }).collect(),
            metadata: PhaseMetadata {
                backend_hints: vec![backend.to_string()],
                arena_requirements: ArenaRequirements {
                    min_bytes: 1024,
                    residency_tier: 1,
                },
                expected_latency_us: 10,
            },
        }
    }

    #[test]
    fn test_fuse_dequant_matmul() {
        let p1 = create_dummy_phase("dequant", "metal", vec!["dequant_out"], vec!["input1"]);
        let p2 = create_dummy_phase("matmul", "metal", vec!["matmul_out"], vec!["dequant_out"]);
        
        let regions = form_regions(&[p1, p2]).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].phases.len(), 2);
        assert_eq!(regions[0].shared_tensors.len(), 1);
        assert_eq!(regions[0].shared_tensors[0].name, "dequant_out");
    }

    #[test]
    fn test_fuse_silu_matmul() {
        let p1 = create_dummy_phase("silu", "vulkan", vec!["silu_out"], vec!["input1"]);
        let p2 = create_dummy_phase("matmul", "vulkan", vec!["matmul_out"], vec!["silu_out"]);
        
        let regions = form_regions(&[p1, p2]).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].phases.len(), 2);
        
        assert_eq!(regions[0].phases[0].name, "silu");
        assert_eq!(regions[0].phases[1].name, "matmul");
    }

    #[test]
    fn test_cross_backend_no_fusion() {
        let p1 = create_dummy_phase("norm", "metal", vec!["norm_out"], vec!["input1"]);
        let p2 = create_dummy_phase("matmul", "vulkan", vec!["matmul_out"], vec!["norm_out"]);
        
        let regions = form_regions(&[p1, p2]).unwrap();
        assert_eq!(regions.len(), 2);
    }
}