use std::sync::Arc;
use std::time::Instant;
use mlx_rs::{Array, error::Result as MlxResult};

use crate::kv_cache::KvCache;
use crate::runtime::arena_integration::Arena;
use crate::speculation::verifier::{CompiledModel, Verifier, PackedTree, CandidateTree as VerifierTree, TreeNode};
use crate::speculation::candidate_tree::CandidateTree;
use crate::speculation::expert_proposal::{ExpertProposalFabric, Tensor};
use crate::speculation::commit::CommitManager;

#[derive(Debug, Clone)]
pub struct SpecResult {
    pub accepted_tokens: Vec<u32>,
    pub branch_accepted: usize,
    pub acceptance_rate: f32,
    pub ane_time_us: u64,
    pub cpu_assembly_time_us: u64,
    pub gpu_verify_time_us: u64,
}

pub fn speculative_step(kv_cache: &mut KvCache, _model: &CompiledModel, arena: &mut Arena) -> Result<SpecResult, String> {
    let has_ane = cfg!(target_vendor = "apple");
    let has_gpu = true; // Simplified checking for backend capability

    if !has_gpu {
        return Ok(SpecResult {
            accepted_tokens: vec![],
            branch_accepted: 0,
            acceptance_rate: 0.0,
            ane_time_us: 0,
            cpu_assembly_time_us: 0,
            gpu_verify_time_us: 0,
        });
    }

    // Step 1: ANE proposal (or CPU fallback)
    let ane_start = Instant::now();
    let num_experts = 8;
    let hidden_dim = 64;
    let vocab_size = 1000;
    let top_k = 2;
    let depth = 2;

    let fabric = ExpertProposalFabric::new(num_experts, hidden_dim, vocab_size, None);
    
    let mut expert_outputs = Vec::new();
    let mut indices = Vec::new();
    for i in 0..num_experts {
        expert_outputs.push(Array::zeros::<f32>(&[1, hidden_dim as i32]).unwrap());
        indices.push(i);
    }
    
    // Simulating cross-device sync. In real hardware this awaits timeline semaphores.
    // For ANE: wait for completion event from ANE before continuing
    let proposals = if has_ane {
        // Run ANE fused MIL program via ExpertProposalFabric
        fabric.propose_batch(&expert_outputs, &indices).map_err(|e| e.to_string())?
    } else {
        // CPU draft model fallback (mocked using a smaller subset of the fabric for standard CPU execution)
        let draft_indices = vec![0, 1]; // Use a smaller subset representing a CPU draft model
        fabric.propose_batch(&expert_outputs, &draft_indices).map_err(|e| e.to_string())?
    };
    
    // Simulate writing to proposal ring via Arena RingRegistry
    let rings = arena.rings_mut();
    rings.proposal_ring.insert(0, vec![1, 2, 3]);

    let ane_time_us = ane_start.elapsed().as_micros() as u64;

    // Step 2: CPU assembly
    // Wait for ANE completion (implicit here by synchronous flow, normally via event)
    let cpu_start = Instant::now();
    
    let tree = CandidateTree::from_proposals(&proposals, top_k, depth);
    let _mask = tree.tree_attention_mask();
    
    let mut verifier_nodes = Vec::new();
    for cand in tree.candidates.iter() {
        verifier_nodes.push(TreeNode {
            token_id: cand.token,
            parent_idx: cand.parent,
            children: Vec::new(), 
        });
    }

    let verifier_tree = VerifierTree {
        total_tokens: tree.candidates.len(),
        nodes: verifier_nodes,
    };

    let verifier = Verifier {
        target_model: Arc::new(CompiledModel), // Using a new unit struct. If CompiledModel changes, we should use a reference wrapper instead.
        max_tree_width: 64, // Production hardening: max 64 nodes
    };

    let _packed_tree = verifier.pack_tree(&verifier_tree);
    
    // Simulate writing packed tree to verifier ring
    let rings = arena.rings_mut();
    rings.verifier_ring.insert(0, vec![1, 2, 3]);

    let cpu_assembly_time_us = cpu_start.elapsed().as_micros() as u64;

    // Step 3: GPU verifier
    // Wait for CPU assembly completion (implicit here, normally via GPU event wait)
    let gpu_start = Instant::now();
    let result = verifier.verify(&verifier_tree, kv_cache)?;
    
    CommitManager::commit_accepted(kv_cache, &result)?;
    CommitManager::rollback_rejected(kv_cache, &result)?;

    let total_tokens = verifier_tree.total_tokens;
    let acceptance_rate = CommitManager::acceptance_rate(&result, total_tokens);
    
    // GPU event signal completion
    let gpu_verify_time_us = gpu_start.elapsed().as_micros() as u64;

    Ok(SpecResult {
        accepted_tokens: result.accepted_tokens.clone(),
        branch_accepted: *result.accepted_branch.last().unwrap_or(&0),
        acceptance_rate,
        ane_time_us,
        cpu_assembly_time_us,
        gpu_verify_time_us,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kv_cache::KvCache;
    use crate::runtime::arena_integration::{ArenaConfig, ArenaPagePool, RingRegistry, Arena};
    use crate::speculation::verifier::{CompiledModel, Verifier, VerificationResult, CandidateTree as VerifierTree, TreeNode};
    use mlx_rs::Array;

    struct DummyLane;
    impl crate::runtime::arena_integration::BackendLane for DummyLane {}

    #[test]
    fn test_cpu_assembly_mask() {
        let proposals = vec![
            Array::zeros::<f32>(&[10]).unwrap(),
            Array::zeros::<f32>(&[10]).unwrap(),
            Array::zeros::<f32>(&[10]).unwrap(),
            Array::zeros::<f32>(&[10]).unwrap(),
            Array::zeros::<f32>(&[10]).unwrap(),
            Array::zeros::<f32>(&[10]).unwrap(),
            Array::zeros::<f32>(&[10]).unwrap(),
            Array::zeros::<f32>(&[10]).unwrap(),
        ];
        
        let tree = CandidateTree::from_proposals(&proposals, 2, 2);
        let mask = tree.tree_attention_mask();
        
        let total_nodes = tree.acceptance_window();
        assert_eq!(total_nodes, 16 + 32); 
        assert_eq!(mask.shape(), &[total_nodes as i32, total_nodes as i32]);
    }

    #[test]
    fn test_speculative_step_commit_rollback() {
        let mut kv_cache = KvCache::new(1024, 8, 128, true);
        
        kv_cache.append(&Array::zeros::<f32>(&[1, 8, 128]).unwrap(), &Array::zeros::<f32>(&[1, 8, 128]).unwrap()).unwrap();
        
        let result = VerificationResult {
            accepted_tokens: vec![1, 2, 3],
            accepted_branch: vec![2],
            acceptance_count: 3,
            scores: vec![0.9, 0.8, 0.7],
        };
        
        CommitManager::commit_accepted(&mut kv_cache, &result).unwrap();
        CommitManager::rollback_rejected(&mut kv_cache, &result).unwrap();
        
        assert_eq!(kv_cache.committed_len, 1);
    }
}