use crate::config::TextArchitecture as ArchConfig;
use crate::decode_attribution::shape_profiles::ShapeProfile;
use crate::speculation::verifier::AcceptancePolicy;

#[derive(Debug, PartialEq)]
pub enum ProposalSource {
    // For MoE models: expert proposal heads (8 activated experts)
    ExpertHeads { num_activated: usize, low_rank: Option<usize> },
    // For dense models: small draft model (generated at compile time)
    DraftModel { draft_layers: usize, hidden_dim_reduction: f32 },
    // For small models or latency-critical: multi-token prediction heads
    MultiToken { num_heads: usize, prediction_depth: usize },
}

#[derive(Debug, PartialEq)]
pub struct TreeConfig {
    pub width: usize,     // default 8 (per expert)
    pub depth: usize,     // default 3
    pub max_nodes: usize, // default 64 (bounds GPU memory)
}

#[derive(Debug, PartialEq)]
pub struct KVTransactionConfig {
    pub page_state_slots: usize,
    pub generation_counter_bits: u8,
}

pub struct SpecPlan {
    pub proposal_source: ProposalSource,
    pub tree_topology: TreeConfig,
    pub verifier_window: usize,
    pub acceptance_policy: AcceptancePolicy,
    pub kv_transaction: KVTransactionConfig,
}

pub fn plan_speculation(model_arch: &ArchConfig, _profile: &ShapeProfile) -> Result<SpecPlan, String> {
    let mut width = 8;
    let mut depth = 3;
    let max_nodes = 64;

    if width * depth > max_nodes {
        width = max_nodes / depth;
    }

    let tree_topology = TreeConfig {
        width,
        depth,
        max_nodes,
    };

    let kv_transaction = KVTransactionConfig {
        page_state_slots: 4,
        generation_counter_bits: 16,
    };

    let is_moe = model_arch.model_type.to_lowercase().contains("moe") || model_arch.model_type.to_lowercase().contains("deepseek");

    let proposal_source = if is_moe {
        ProposalSource::ExpertHeads {
            num_activated: 8,
            low_rank: None,
        }
    } else {
        ProposalSource::DraftModel {
            draft_layers: 2,
            hidden_dim_reduction: 0.5,
        }
    };

    Ok(SpecPlan {
        proposal_source,
        tree_topology,
        verifier_window: 16,
        acceptance_policy: AcceptancePolicy::Greedy,
        kv_transaction,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RopeSpec;

    fn mock_arch(model_type: &str) -> ArchConfig {
        ArchConfig {
            hidden_size: 1024,
            intermediate_size: 4096,
            num_attention_heads: 16,
            num_key_value_heads: 16,
            head_dim: 64,
            global_head_dim: None,
            num_global_key_value_heads: None,
            num_hidden_layers: 12,
            vocab_size: 32000,
            sliding_window: 0,
            max_position_embeddings: 2048,
            rms_norm_eps: 1e-6,
            tie_word_embeddings: false,
            attention_k_eq_v: false,
            final_logit_softcapping: None,
            hidden_size_per_layer_input: 1024,
            layer_types: vec![],
            rope_local: RopeSpec {
                theta: 10000.0,
                rope_type: "default".into(),
                partial_rotary_factor: None,
            },
            rope_global: None,
            model_type: model_type.to_string(),
        }
    }

    #[test]
    fn test_plan_speculation_deepseek_moe() {
        let arch = mock_arch("deepseek_v3");
        let profile = crate::decode_attribution::shape_profiles::SMALL;
        let plan = plan_speculation(&arch, &profile).unwrap();

        assert_eq!(plan.tree_topology.width, 8);
        assert!(matches!(plan.proposal_source, ProposalSource::ExpertHeads { num_activated: 8, .. }));
    }

    #[test]
    fn test_plan_speculation_qwen2_dense() {
        let arch = mock_arch("qwen2");
        let profile = crate::decode_attribution::shape_profiles::SMALL;
        let plan = plan_speculation(&arch, &profile).unwrap();

        assert!(
            matches!(plan.proposal_source, ProposalSource::DraftModel { .. }) ||
            matches!(plan.proposal_source, ProposalSource::MultiToken { .. })
        );
    }
}
