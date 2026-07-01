use crate::model::compute_graph::ComputeGraph;

/// Defines the hardware execution target and its dispatch requirements
#[derive(Debug, Clone)]
pub enum ExecutionVariant {
    MlxDecode {
        graph: ComputeGraph,
    },
    /// Tensix execution variant for narrow transformer projection or MLP segment
    TensixDecode1 {
        graph: ComputeGraph,
        /// Keys for dispatch table and selection policy
        batch_size: usize,
        seq_count: usize,
        hidden_dim: usize,
        head_count: usize,
        kv_page_layout: String,
        quantization: String,
        device_cap: String,
        latency_policy: String,
    },
}

impl ExecutionVariant {
    /// Selects a lane variant based on device profile and artifact evidence.
    /// Falls back to existing qualified lane without corrupting state if Tensix fails.
    pub fn select_variant(is_tensix_available: bool, artifact_evidence_matches: bool) -> Self {
        if is_tensix_available && artifact_evidence_matches {
            // Note: This is dispatch table schema + selection policy without actual execution yet.
            ExecutionVariant::TensixDecode1 {
                graph: ComputeGraph::new(),
                batch_size: 1,
                seq_count: 1,
                hidden_dim: 4096,
                head_count: 32,
                kv_page_layout: "default".to_string(),
                quantization: "fp8".to_string(),
                device_cap: "tensix_v1".to_string(),
                latency_policy: "strict".to_string(),
            }
        } else {
            // Demote to existing qualified lane (MlxDecode)
            ExecutionVariant::MlxDecode {
                graph: ComputeGraph::new(),
            }
        }
    }
}
