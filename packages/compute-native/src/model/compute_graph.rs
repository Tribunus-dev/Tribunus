/// Represents a computational graph compatible with execution variants.
#[derive(Debug, Clone, Default)]
pub struct ComputeGraph {
    pub nodes: Vec<String>,
}

impl ComputeGraph {
    pub fn new() -> Self {
        Self { nodes: Vec::new() }
    }
}
