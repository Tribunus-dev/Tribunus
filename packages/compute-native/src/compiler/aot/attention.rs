use std::collections::HashMap;

/// Pluggable attention kernel registry
pub enum AttentionType {
    Flash,
    Kv1Sparse,
    Streaming,
    SlidingWindow,
    CooperativeGroups,
}

pub struct AttentionRegistry {
    kernels: HashMap<String, AttentionType>,
}

impl AttentionRegistry {
    pub fn new() -> Self {
        Self {
            kernels: HashMap::new(),
        }
    }

    pub fn register(&mut self, name: &str, attn_type: AttentionType) {
        self.kernels.insert(name.to_string(), attn_type);
    }

    pub fn get(&self, name: &str) -> Option<&AttentionType> {
        self.kernels.get(name)
    }
}
