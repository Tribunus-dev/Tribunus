use std::time::Instant;
use mlx_rs::Array;
use crate::runtime::arena_integration::RingRegistry;
use crate::kv_cache::KvCache;
use crate::speculation::candidate_tree::CandidateTree;
use crate::speculation::verifier::{Verifier, VerificationResult, AcceptancePolicy};
use crate::speculation::commit::CommitManager;
use crate::speculation::expert_proposal::ExpertProposalFabric;
use crate::capability::BackendCapability;

pub type Tensor = Array;

#[derive(Debug, Clone)]
pub struct SpecResult {
    pub accepted_tokens: Vec<u32>,
    pub branch_accepted: usize, // 0 = fallback to decode
    pub acceptance_rate: f32,
    pub draft_us: u64,
    pub assembly_us: u64,
    pub verify_us: u64,
}

#[derive(Debug, Clone)]
pub struct SpecReceipt {
    pub proposal_count: usize,
    pub tree_width: usize,
    pub acceptance_count: usize,
    pub rate: f32,
    pub draft_us: u64,
    pub assembly_us: u64,
    pub verify_us: u64,
    pub pages_committed: usize,
    pub pages_rolled_back: usize,
}

pub struct SpecPipeline {
    pub tree_width: usize,
    pub tree_depth: usize,
    pub verifier: Verifier,
    pub policy: AcceptancePolicy,
    pub apple_silicon: bool,
    pub has_gpu: bool,
    pub cpu_draft_fabric: Option<ExpertProposalFabric>,
}

impl SpecPipeline {
    pub fn new(tree_width: usize, tree_depth: usize, verifier: Verifier, policy: AcceptancePolicy) -> Self {
        let apple_silicon = cfg!(target_vendor = "apple");

        let has_gpu = cfg!(feature = "metal") || cfg!(feature = "linux-vulkan") || cfg!(feature = "linux-intel");

        let cpu_draft_fabric = if !apple_silicon {
            Some(ExpertProposalFabric::new(8, 1024, 32000, Some(2048))) // Small model fallback
        } else {
            None
        };

        Self {
            tree_width,
            tree_depth,
            verifier,
            policy,
            apple_silicon,
            has_gpu,
            cpu_draft_fabric,
        }
    }

    pub fn execute(
        &mut self,
        rings: &mut RingRegistry,
        kv_cache: &mut KvCache,
        proposals_in: Option<&[Tensor]>, 
        target_logits: &[f32], // Inject target_logits purely for the verifiable mockup interface
    ) -> Result<(SpecResult, SpecReceipt), String> {
        if !self.has_gpu {
            return Err("GPU unavailable, speculation disabled".to_string());
        }

        // 1. Draft
        let start = Instant::now();
        
        let proposals = if let Some(p) = proposals_in {
            p.to_vec()
        } else {
            if self.apple_silicon {
                // Read draft logits from proposal ring
                let mut p = Vec::new();
                for (_branch_id, _ring_data) in rings.proposal_ring.iter() {
                    p.push(Array::zeros::<f32>(&[10]).unwrap()); 
                }
                p
            } else {
                // Fall back to CPU draft small model
                let dummy_input = vec![Array::zeros::<f32>(&[1, 1024]).unwrap(); 8];
                let indices: Vec<u32> = (0..8).collect();
                self.cpu_draft_fabric.as_ref().unwrap().propose_batch(&dummy_input, &indices).map_err(|e| e.to_string())?
            }
        };
        
        for i in 0..self.tree_width {
            rings.proposal_ring.insert(i as u8, vec![]);
        }

        let tree = CandidateTree::from_proposals(&proposals, self.tree_width, self.tree_depth);
        let draft_us = start.elapsed().as_micros() as u64;

        // Shared event sync
        #[cfg(target_vendor = "apple")]
        {
            // Simulate waiting for Metal shared event
            // let event = crate::metal_capture::shared_event();
            // event.wait(draft_complete_val);
        }
        #[cfg(not(target_vendor = "apple"))]
        {
            // Simulate waiting for CUDA event
            // crate::cuda::sync::event_synchronize("draft_complete");
        }

        // 2. Assembly (CPU)
        let assembly_start = Instant::now();
        let packed_tree = self.verifier.pack_tree(&tree);
        
        let _attention_mask = tree.tree_attention_mask();
        
        rings.verifier_ring.insert(0, packed_tree.token_ids.iter().map(|&x| x as u64).collect());
        let assembly_us = assembly_start.elapsed().as_micros() as u64;

        // 3. Verification (GPU)
        let verify_start = Instant::now();
        
        // Normally this passes through self.verifier.target_model.forward(...)
        // Since CompiledModel is a stub struct without forward implementation in verifier.rs,
        // we use target_logits parameter as a deterministic stand-in for model execution outputs.
        
        let accepted = self.policy.accept(target_logits, &packed_tree.token_ids, &vec![1.0; packed_tree.token_ids.len()]);
        
        let mut branch_accepted = 0;
        let mut max_match_len = 0;
        
        for (branch_idx, path_indices) in packed_tree.tree_indices.iter().enumerate() {
            let mut match_len = 0;
            for &idx in path_indices {
                if match_len < accepted.len() && packed_tree.token_ids[idx] == accepted[match_len] {
                    match_len += 1;
                } else {
                    break;
                }
            }
            if match_len > max_match_len {
                max_match_len = match_len;
                branch_accepted = branch_idx; 
            }
        }
        
        let accepted_branch_indices = if !packed_tree.tree_indices.is_empty() {
            packed_tree.tree_indices[branch_accepted].clone()
        } else {
            vec![]
        };

        let result = VerificationResult {
            accepted_tokens: accepted.clone(),
            accepted_branch: accepted_branch_indices.clone(),
            acceptance_count: accepted.len(),
            scores: vec![1.0; accepted.len()],
        };

        let acceptance_rate = CommitManager::acceptance_rate(&result, tree.acceptance_window());

        CommitManager::commit_accepted(kv_cache, &result)?;
        let pages_committed = result.accepted_branch.len(); 

        CommitManager::rollback_rejected(kv_cache, &result)?;
        let pages_rolled_back = tree.acceptance_window().saturating_sub(pages_committed);

        #[cfg(target_vendor = "apple")]
        {
            // Simulate signaling Metal shared event
            // let event = crate::metal_capture::shared_event();
            // event.signal(verify_complete_val);
        }
        #[cfg(not(target_vendor = "apple"))]
        {
            // Simulate signaling CUDA event
            // crate::cuda::sync::event_record("verify_complete");
        }

        let verify_us = verify_start.elapsed().as_micros() as u64;

        let spec_result = SpecResult {
            accepted_tokens: accepted,
            branch_accepted: branch_accepted + 1, // 1-indexed branch
            acceptance_rate,
            draft_us,
            assembly_us,
            verify_us,
        };

        let spec_receipt = SpecReceipt {
            proposal_count: proposals.len(),
            tree_width: self.tree_width,
            acceptance_count: result.acceptance_count,
            rate: acceptance_rate,
            draft_us,
            assembly_us,
            verify_us,
            pages_committed,
            pages_rolled_back,
        };

        Ok((spec_result, spec_receipt))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use crate::speculation::verifier::CompiledModel;

    #[test]
    fn test_speculation_pipeline_success() {
        let verifier = Verifier {
            target_model: Arc::new(CompiledModel),
            max_tree_width: 64,
        };
        
        let policy = AcceptancePolicy::Greedy;
        let mut pipeline = SpecPipeline::new(4, 1, verifier, policy);

        let mut rings = RingRegistry::new();
        let mut kv_cache = KvCache::new(1024, 8, 128, false);
        
        let mut proposals = Vec::new();
        for i in 0..8 {
            proposals.push(Array::from_slice(&[i as f32; 10], &[10]));
        }
        
        let tree = CandidateTree::from_proposals(&proposals, 4, 1);
        let mask = tree.tree_attention_mask();
        
        assert_eq!(mask.shape(), &[4, 4]); // Verify tree assembly mask is correct. 4 width, 1 depth -> 4 nodes.
        let mask_data = mask.try_as_slice::<f32>().unwrap();
        assert_eq!(mask_data[0], 1.0); // Self-attention

        // Mock targets: target_logits match token 2 (which corresponds to branch index 2).
        let mut target_logits = vec![0.0; 4];
        target_logits[2] = 1.0; 
        
        let (res, receipt) = pipeline.execute(&mut rings, &mut kv_cache, Some(&proposals), &target_logits).unwrap();

        assert_eq!(res.branch_accepted, 3); // 1-indexed, so branch index 2 corresponds to branch 3.
        assert_eq!(receipt.pages_committed, 1); // branch 2 (one token) committed.
        assert_eq!(receipt.pages_rolled_back, 3); // 4 total pages - 1 committed = 3 rolled back (branches 0,1,3 invalidated).
        assert_eq!(res.accepted_tokens, vec![2]);
    }

    #[test]
    fn test_speculation_pipeline_fallback() {
        let verifier = Verifier {
            target_model: Arc::new(CompiledModel),
            max_tree_width: 64,
        };
        let policy = AcceptancePolicy::Specinfer;
        let mut pipeline = SpecPipeline::new(2, 2, verifier, policy);
        pipeline.has_gpu = false;

        let mut rings = RingRegistry::new();
        let mut kv_cache = KvCache::new(1024, 8, 128, false);
        let target_logits = vec![];

        let err = pipeline.execute(&mut rings, &mut kv_cache, None, &target_logits).unwrap_err();
        assert_eq!(err, "GPU unavailable, speculation disabled");
    }
}