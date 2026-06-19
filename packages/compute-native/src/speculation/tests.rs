#[cfg(test)]
mod tests {
    use crate::speculation::verifier::*;
    use crate::speculation::commit::*;
    use crate::kv_cache::KvCache;
    use std::sync::Arc;

    #[test]
    fn test_acceptance_logic_small_tree() {
        let policy = AcceptancePolicy::Greedy;
        // Mock targets and drafts where scores are simulated as target match logits
        let target_logits = vec![1.0, 1.0, 0.2, 0.8, 0.5, 0.5]; // First two are 1.0 -> accept
        let draft_tokens = vec![1, 3];
        let scores = vec![1.0, 1.0]; // ignored by Greedy mockup
        
        let accepted = policy.accept(&target_logits, &draft_tokens, &scores);
        assert_eq!(accepted, vec![1, 3]);
    }

    #[test]
    fn test_acceptance_logic_large_tree() {
        let policy = AcceptancePolicy::Specinfer;
        let draft_tokens = vec![1, 2, 3, 4, 5, 6];
        let scores = vec![1.0; 6];
        let target_logits = vec![0.9; 6]; // All > 0.5 -> accept
        let accepted = policy.accept(&target_logits, &draft_tokens, &scores);
        assert_eq!(accepted, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn test_tree_packing_branch_indices() {
        // Topology: Small tree B=2, D=2
        //    0
        //  /   \
        // 1     2
        let tree = CandidateTree {
            total_tokens: 3,
            nodes: vec![
                TreeNode { token_id: 10, parent_idx: None, children: vec![1, 2] },
                TreeNode { token_id: 11, parent_idx: Some(0), children: vec![] },
                TreeNode { token_id: 12, parent_idx: Some(0), children: vec![] },
            ]
        };

        let verifier = Verifier {
            target_model: Arc::new(CompiledModel),
            max_tree_width: 64,
        };

        let packed = verifier.pack_tree(&tree);
        assert_eq!(packed.token_ids, vec![10, 11, 12]);
        assert_eq!(packed.positions, vec![0, 1, 1]);
        
        // Two branches: [0, 1] and [0, 2]
        assert_eq!(packed.tree_indices.len(), 2);
        assert!(packed.tree_indices.contains(&vec![0, 1]));
        assert!(packed.tree_indices.contains(&vec![0, 2]));
    }

    #[test]
    fn test_commit_rollback() {
        let mut kv_cache = KvCache::new(1024, 8, 128, false);
        let result = VerificationResult {
            accepted_tokens: vec![1, 2],
            accepted_branch: vec![0, 1],
            acceptance_count: 2,
            scores: vec![1.0, 0.9],
        };

        assert!(CommitManager::commit_accepted(&mut kv_cache, &result).is_ok());
        assert!(CommitManager::rollback_rejected(&mut kv_cache, &result).is_ok());
    }
}