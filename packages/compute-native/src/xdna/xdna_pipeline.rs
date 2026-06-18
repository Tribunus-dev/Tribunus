use std::collections::{HashSet, HashMap};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpType {
    MatMulInt8,
    MatMulFp16,
    RmsNorm,
    LayerNorm,
    SiLu,
    Softmax,
    Gather,
    Scatter,
    Sort,
    TopK,
    DynamicReshape,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct Node {
    pub id: usize,
    pub op_type: OpType,
    pub inputs: Vec<usize>,
    pub outputs: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct Graph {
    pub nodes: HashMap<usize, Node>,
    pub root_nodes: Vec<usize>,
}

pub struct Subgraph {
    pub nodes: Vec<usize>,
    pub is_npu_compatible: bool,
}

pub struct Partitioner {
    pub min_subgraph_size: usize,
}

impl Partitioner {
    pub fn new(min_subgraph_size: usize) -> Self {
        Self { min_subgraph_size }
    }

    pub fn is_npu_supported(op: &OpType) -> bool {
        match op {
            OpType::MatMulInt8 |
            OpType::MatMulFp16 |
            OpType::RmsNorm |
            OpType::LayerNorm |
            OpType::SiLu |
            OpType::Softmax => true,
            _ => false,
        }
    }

    pub fn partition(&self, graph: &Graph) -> Vec<Subgraph> {
        let mut visited = HashSet::new();
        let mut subgraphs = Vec::new();
        
        // Very simplified DFS/Greedy partitioner for demo
        for &root in &graph.root_nodes {
            if !visited.contains(&root) {
                let mut current_npu_nodes = Vec::new();
                self.dfs_partition(root, graph, &mut visited, &mut current_npu_nodes);
                
                if !current_npu_nodes.is_empty() {
                    if current_npu_nodes.len() >= self.min_subgraph_size {
                        subgraphs.push(Subgraph {
                            nodes: current_npu_nodes,
                            is_npu_compatible: true,
                        });
                    } else {
                        // Fallback to CPU if too small
                        subgraphs.push(Subgraph {
                            nodes: current_npu_nodes,
                            is_npu_compatible: false,
                        });
                    }
                }
            }
        }
        
        // Also add any unvisited nodes as CPU fallback
        for (&id, node) in &graph.nodes {
            if !visited.contains(&id) {
                subgraphs.push(Subgraph {
                    nodes: vec![id],
                    is_npu_compatible: false, // fallback
                });
                visited.insert(id);
            }
        }
        
        subgraphs
    }
    
    fn dfs_partition(&self, current: usize, graph: &Graph, visited: &mut HashSet<usize>, current_npu_nodes: &mut Vec<usize>) {
        if visited.contains(&current) {
            return;
        }
        
        if let Some(node) = graph.nodes.get(&current) {
            if Self::is_npu_supported(&node.op_type) {
                visited.insert(current);
                current_npu_nodes.push(current);
                
                for &output in &node.outputs {
                    self.dfs_partition(output, graph, visited, current_npu_nodes);
                }
            } else {
                // Not supported, break the chain here.
                // The parent will handle collecting the valid NPU nodes.
                // The unsupported node will be picked up by the outer loop and marked as CPU fallback.
            }
        }
    }
}
