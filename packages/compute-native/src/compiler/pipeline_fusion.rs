use std::collections::HashMap;
use crate::compute_ir::{PhaseIR, IROp};
use crate::compiler::pipeline_candidates::{SystemTopology, generate_candidates, RealizerCandidate};

#[derive(Debug, Clone)]
pub struct FusedRegion {
    pub name: String,
    pub ops: Vec<IROp>,
    pub kernel: String,
    pub shape: Vec<u32>, 
    pub dtype: String,
    pub memory_estimate_bytes: usize,
}

pub fn fuse_operations(phases: &[PhaseIR], topology: &SystemTopology) -> Result<Vec<FusedRegion>, String> {
    let mut fused_regions = Vec::new();
    
    // First generate candidates to know which backends support the current phase
    let phase_candidates = generate_candidates(phases, topology)?;
    
    // Convert to a map for easy lookup
    // We key by the list of operation kinds for each phase
    let candidates_map: HashMap<Vec<String>, Vec<RealizerCandidate>> = phase_candidates.into_iter()
        .map(|pc| (pc.phase.ops.iter().map(|op| op.kind.clone()).collect::<Vec<_>>(), pc.candidates))
        .collect();

    for phase in phases {
        let ops = phase.ops.clone();
        
        // Find candidates for this phase
        let phase_ops_kinds = ops.iter().map(|op| op.kind.clone()).collect::<Vec<_>>();
        let supports_any_backend = candidates_map.get(&phase_ops_kinds).map_or(false, |cands| !cands.is_empty());
        
        let mut i = 0;
        while i < ops.len() {
            let mut fused = false;
            
            // Check Matmul + Bias + Act
            if i + 2 < ops.len() 
                && ops[i].kind == "matmul" 
                && ops[i+1].kind == "bias" 
                && (ops[i+2].kind == "gelu" || ops[i+2].kind == "silu" || ops[i+2].kind == "relu") 
            {
                let output_i = ops[i].output_tensors.first();
                let input_i1 = ops[i+1].input_tensors.first();
                let output_i1 = ops[i+1].output_tensors.first();
                let input_i2 = ops[i+2].input_tensors.first();
                
                if output_i.is_some() && output_i == input_i1 && output_i1.is_some() && output_i1 == input_i2 {
                    // Check if dtype matches (mock logic: assuming inputs of the first op)
                    let dtype = "fp16".to_string(); // In a real implementation this would be extracted from IrTensor
                    let memory_estimate_bytes = 1024; // Mock VRAM estimate
                    
                    // Mock check for VRAM budget and backend support
                    if memory_estimate_bytes <= 1024 * 1024 * 1024 && supports_any_backend { // 1GB limit mock
                        fused_regions.push(FusedRegion {
                            name: format!("fused_{}", ops[i].kind),
                            ops: vec![ops[i].clone(), ops[i+1].clone(), ops[i+2].clone()],
                            kernel: "fused_matmul_bias_act".to_string(),
                            shape: vec![],
                            dtype,
                            memory_estimate_bytes,
                        });
                        i += 3;
                        fused = true;
                    }
                }
            }
            
            if fused { continue; }
            
            // Check Matmul + Bias
            if i + 1 < ops.len() 
                && ops[i].kind == "matmul" 
                && ops[i+1].kind == "bias" 
            {
                let output_of_i = ops[i].output_tensors.first();
                let input_of_i_plus_1 = ops[i+1].input_tensors.first();
                
                if output_of_i.is_some() && output_of_i == input_of_i_plus_1 && supports_any_backend {
                    fused_regions.push(FusedRegion {
                        name: "fused_matmul_bias".to_string(),
                        ops: vec![ops[i].clone(), ops[i+1].clone()],
                        kernel: "fused_matmul_bias".to_string(),
                        shape: vec![],
                        dtype: "fp16".to_string(),
                        memory_estimate_bytes: 512,
                    });
                    i += 2;
                    fused = true;
                }
            }
            
            if fused { continue; }
            
            // Check Attention QKV projection (3 matmuls -> 1)
            if i + 2 < ops.len() 
                && ops[i].kind == "matmul" && ops[i].metadata.get("target") == Some(&"q".to_string())
                && ops[i+1].kind == "matmul" && ops[i+1].metadata.get("target") == Some(&"k".to_string())
                && ops[i+2].kind == "matmul" && ops[i+2].metadata.get("target") == Some(&"v".to_string())
            {
                // We assume Q, K, V have the same input tensor for projection
                let input_q = ops[i].input_tensors.first();
                let input_k = ops[i+1].input_tensors.first();
                let input_v = ops[i+2].input_tensors.first();
                
                if input_q.is_some() && input_q == input_k && input_k == input_v && supports_any_backend {
                    fused_regions.push(FusedRegion {
                        name: "fused_qkv".to_string(),
                        ops: vec![ops[i].clone(), ops[i+1].clone(), ops[i+2].clone()],
                        kernel: "fused_qkv_proj".to_string(),
                        shape: vec![],
                        dtype: "fp16".to_string(),
                        memory_estimate_bytes: 2048,
                    });
                    i += 3;
                    fused = true;
                }
            }
            
            if fused { continue; }
            
            // Check Attention output projection + residual
            if i + 1 < ops.len() 
                && ops[i].kind == "matmul" && ops[i].metadata.get("target") == Some(&"attn_out".to_string())
                && ops[i+1].kind == "add" && ops[i+1].metadata.get("target") == Some(&"residual".to_string())
            {
                let output_i = ops[i].output_tensors.first();
                let input_i1_1 = ops[i+1].input_tensors.get(0);
                let input_i1_2 = ops[i+1].input_tensors.get(1);
                
                if output_i.is_some() && (output_i == input_i1_1 || output_i == input_i1_2) && supports_any_backend {
                    fused_regions.push(FusedRegion {
                        name: "fused_attn_out_residual".to_string(),
                        ops: vec![ops[i].clone(), ops[i+1].clone()],
                        kernel: "fused_attn_out_residual".to_string(),
                        shape: vec![],
                        dtype: "fp16".to_string(),
                        memory_estimate_bytes: 1024,
                    });
                    i += 2;
                    fused = true;
                }
            }
            
            if fused { continue; }
            
            // Check RMS norm + matmul
            if i + 1 < ops.len() 
                && ops[i].kind == "rms_norm" 
                && ops[i+1].kind == "matmul" 
            {
                let output_of_i = ops[i].output_tensors.first();
                let input_of_i_plus_1 = ops[i+1].input_tensors.first();
                
                if output_of_i.is_some() && output_of_i == input_of_i_plus_1 && supports_any_backend {
                    fused_regions.push(FusedRegion {
                        name: "fused_norm_matmul".to_string(),
                        ops: vec![ops[i].clone(), ops[i+1].clone()],
                        kernel: "fused_norm_matmul".to_string(),
                        shape: vec![],
                        dtype: "fp16".to_string(),
                        memory_estimate_bytes: 512,
                    });
                    i += 2;
                    fused = true;
                }
            }
            
            if fused { continue; }

            // Consecutive elementwise
            if i + 1 < ops.len() 
                && ops[i].kind == "silu" 
                && ops[i+1].kind == "mul" 
            {
                let output_i = ops[i].output_tensors.first();
                let input_i1_1 = ops[i+1].input_tensors.get(0);
                let input_i1_2 = ops[i+1].input_tensors.get(1);
                
                if output_i.is_some() && (output_i == input_i1_1 || output_i == input_i1_2) && supports_any_backend {
                    fused_regions.push(FusedRegion {
                        name: "fused_swiglu".to_string(),
                        ops: vec![ops[i].clone(), ops[i+1].clone()],
                        kernel: "fused_swiglu".to_string(),
                        shape: vec![],
                        dtype: "fp16".to_string(),
                        memory_estimate_bytes: 256,
                    });
                    i += 2;
                    fused = true;
                }
            }
            
            if fused { continue; }
            
            // No fusion matched, push as single operation
            fused_regions.push(FusedRegion {
                name: ops[i].kind.clone(),
                ops: vec![ops[i].clone()],
                kernel: ops[i].kind.clone(),
                shape: vec![],
                dtype: "fp16".to_string(),
                memory_estimate_bytes: 256,
            });
            i += 1;
        }
    }
    
    Ok(fused_regions)
}

pub fn form_regions(phases: &[PhaseIR]) -> Result<Vec<FusedRegion>, String> {
    // A simplified wrapper that assumes an empty topology when none is provided
    let topology = SystemTopology::new(vec![]);
    fuse_operations(phases, &topology)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuse_matmul_bias() {
        let op1 = IROp {
            kind: "matmul".to_string(),
            input_tensors: vec!["in".to_string()],
            output_tensors: vec!["out1".to_string()],
            metadata: HashMap::new(),
        };
        let op2 = IROp {
            kind: "bias".to_string(),
            input_tensors: vec!["out1".to_string()],
            output_tensors: vec!["out2".to_string()],
            metadata: HashMap::new(),
        };
        
        let phase = PhaseIR {
            ops: vec![op1, op2],
            dependencies: vec![],
            candidates: vec![],
            state_effects: vec![],
        };
        
        let regions = form_regions(&[phase]).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].kernel, "fused_matmul_bias");
        assert_eq!(regions[0].ops.len(), 2);
    }
    
    #[test]
    fn test_fuse_incompatible() {
        let op1 = IROp {
            kind: "matmul".to_string(),
            input_tensors: vec!["in".to_string()],
            output_tensors: vec!["out1".to_string()],
            metadata: HashMap::new(),
        };
        let op2 = IROp {
            kind: "bias".to_string(),
            input_tensors: vec!["diff_in".to_string()], // Mismatch!
            output_tensors: vec!["out2".to_string()],
            metadata: HashMap::new(),
        };
        
        let phase = PhaseIR {
            ops: vec![op1, op2],
            dependencies: vec![],
            candidates: vec![],
            state_effects: vec![],
        };
        
        let regions = form_regions(&[phase]).unwrap();
        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].kernel, "matmul");
        assert_eq!(regions[1].kernel, "bias");
    }
}
