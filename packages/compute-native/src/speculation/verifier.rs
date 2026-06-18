use std::sync::Arc;
use mlx_rs::{Array, Dtype};

pub struct CompiledModel;

#[derive(Debug, Clone)]
pub struct CandidateTree {
    pub total_tokens: usize,
    pub nodes: Vec<TreeNode>,
}

#[derive(Debug, Clone)]
pub struct TreeNode {
    pub token_id: u32,
    pub parent_idx: Option<usize>,
    pub children: Vec<usize>,
}

pub struct Verifier {
    pub target_model: Arc<CompiledModel>,
    pub max_tree_width: usize,
}

impl Verifier {
    pub fn verify(&self, _tree: &CandidateTree, _kv_cache: &mut crate::kv_cache::KvCache) -> Result<VerificationResult, String> {
        // Stub for actual verification step, calling target model forward pass
        Ok(VerificationResult {
            accepted_tokens: Vec::new(),
            accepted_branch: Vec::new(),
            acceptance_count: 0,
            scores: Vec::new(),
        })
    }

    pub fn pack_tree(&self, tree: &CandidateTree) -> PackedTree {
        // Safe pruning: Collect highest scoring paths or simply bound the breadth properly.
        // For simplicity, we just keep all valid reachable nodes up to max_tree_width in BFS/DFS order.
        let mut pruned_nodes = Vec::new();
        for node in &tree.nodes {
            if pruned_nodes.len() < self.max_tree_width {
                // Ensure parent exists in pruned nodes
                let valid = match node.parent_idx {
                    Some(p) => p < pruned_nodes.len(),
                    None => true,
                };
                if valid {
                    pruned_nodes.push(node.clone());
                }
            }
        }

        let mut token_ids = Vec::with_capacity(pruned_nodes.len());
        let mut positions = Vec::with_capacity(pruned_nodes.len());
        
        // Build position indices and token ids
        for (i, node) in pruned_nodes.iter().enumerate() {
            token_ids.push(node.token_id);
            // Depth tracking
            let depth = match node.parent_idx {
                Some(p) => positions[p] + 1,
                None => 0,
            };
            positions.push(depth);
        }

        // Build tree indices (which tokens form each branch)
        // Find all leaf nodes (nodes with no children in the pruned set)
        let mut is_parent = vec![false; pruned_nodes.len()];
        for node in &pruned_nodes {
            if let Some(p) = node.parent_idx {
                if p < is_parent.len() {
                    is_parent[p] = true;
                }
            }
        }

        let mut tree_indices = Vec::new();
        for (i, &parent) in is_parent.iter().enumerate() {
            if !parent {
                // Leaf node, reconstruct path to root
                let mut path = Vec::new();
                let mut curr = Some(i);
                while let Some(idx) = curr {
                    path.push(idx);
                    curr = pruned_nodes[idx].parent_idx;
                }
                path.reverse();
                tree_indices.push(path);
            }
        }

        let mask = PackedTree::attention_mask_lower_triangular_impl(&pruned_nodes, pruned_nodes.len());

        PackedTree {
            token_ids,
            positions,
            mask,
            tree_indices,
        }
    }
}

pub struct PackedTree {
    pub token_ids: Vec<u32>,
    pub positions: Vec<i32>,
    pub mask: Array,
    pub tree_indices: Vec<Vec<usize>>,
}

impl PackedTree {
    pub fn attention_mask_lower_triangular(&self, width: usize, depth: usize) -> Array {
        // Expose function properly by reconstructing mock tree or keeping mask around
        self.mask.clone()
    }

    fn attention_mask_lower_triangular_impl(nodes: &[TreeNode], width: usize) -> Array {
        let mut data = vec![0.0f32; width * width];

        for i in 0..nodes.len() {
            for j in 0..nodes.len() {
                if i == j {
                    data[i * width + j] = 0.0;
                } else if Self::is_ancestor(nodes, j, i) {
                    data[i * width + j] = 0.0;
                } else {
                    data[i * width + j] = f32::NEG_INFINITY;
                }
            }
        }

        // Properly copy to MLX array (no UAF)
        Array::from_slice(&data, &[width as i32, width as i32])
    }

    fn is_ancestor(nodes: &[TreeNode], ancestor_idx: usize, desc_idx: usize) -> bool {
        let mut curr = desc_idx;
        while let Some(p) = nodes[curr].parent_idx {
            if p == ancestor_idx {
                return true;
            }
            if p >= nodes.len() {
                break; // safety break
            }
            curr = p;
        }
        false
    }
}

pub struct VerificationResult {
    pub accepted_tokens: Vec<u32>,
    pub accepted_branch: Vec<usize>, // Indicies of the nodes that form the accepted branch
    pub acceptance_count: usize,
    pub scores: Vec<f32>,
}

pub enum AcceptancePolicy {
    Specinfer,
    RejectionSample,
    Greedy,
}

impl AcceptancePolicy {
    pub fn accept(&self, target_logits: &[f32], draft_tokens: &[u32], scores: &[f32]) -> Vec<u32> {
        match self {
            Self::Specinfer => {
                let mut accepted = Vec::new();
                for (i, &t) in draft_tokens.iter().enumerate() {
                    // Simple specinfer mock: target probability > 0.5
                    if let Some(&target_prob) = target_logits.get(i) {
                        if target_prob > 0.5 {
                            accepted.push(t);
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                accepted
            }
            Self::RejectionSample => {
                // Probabilistic accept mock
                let mut accepted = Vec::new();
                for (i, &t) in draft_tokens.iter().enumerate() {
                    let target_prob = target_logits.get(i).copied().unwrap_or(0.0);
                    let draft_prob = scores.get(i).copied().unwrap_or(1.0);
                    if target_prob >= draft_prob {
                        accepted.push(t);
                    } else {
                        break;
                    }
                }
                accepted
            }
            Self::Greedy => {
                // Greedy exact match: in a real implementation we compare argmax(target_logits) == draft_tokens.
                // Assuming target_logits represents the top-1 match score (1.0 = match, 0.0 = mismatch) for simple mock.
                let mut accepted = Vec::new();
                for (i, &t) in draft_tokens.iter().enumerate() {
                    if let Some(&score) = target_logits.get(i) {
                        if score > 0.99 {
                            accepted.push(t);
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                accepted
            }
        }
    }
}