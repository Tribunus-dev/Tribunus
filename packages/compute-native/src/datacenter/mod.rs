use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use parking_lot::RwLock;

// 1. Core Structs and Receipt

#[derive(Debug, Clone, PartialEq)]
pub struct DatacenterReceipt {
    pub fleet_size: usize,
    pub nodes_available: usize,
    pub models_loaded: usize,
    pub requests_routed: usize,
    pub avg_routing_latency_us: u64,
    pub fallback_count: usize,
}

#[derive(Debug, Clone)]
pub struct NodeInfo {
    pub id: String,
    pub available: bool,
    pub models: Vec<String>,
    pub load: usize,
}

// 2. vLLM and SGLang Integration Traits/Mocks

pub trait VllmIntegration {
    fn hook_scheduler(&self);
    fn manage_kv_cache(&self);
    fn dispatch_tribunus_kernel(&self) -> bool; // returns true if fast kernel dispatched
}

pub trait SglangIntegration {
    fn share_prefix_cache(&self, prefix: &str);
    fn bridge_kernel(&self);
}

// 3. Local Datacenter State

pub struct DatacenterState {
    nodes: RwLock<HashMap<String, NodeInfo>>,
    stats: Mutex<DatacenterReceipt>,
}

impl DatacenterState {
    pub fn new() -> Self {
        Self {
            nodes: RwLock::new(HashMap::new()),
            stats: Mutex::new(DatacenterReceipt {
                fleet_size: 0,
                nodes_available: 0,
                models_loaded: 0,
                requests_routed: 0,
                avg_routing_latency_us: 0,
                fallback_count: 0,
            }),
        }
    }

    pub fn register_node(&self, node: NodeInfo) {
        let mut nodes = self.nodes.write();
        nodes.insert(node.id.clone(), node);
        
        self.update_stats_internal(&nodes);
    }
    
    pub fn update_node_models(&self, node_id: &str, models: Vec<String>) {
        let mut nodes = self.nodes.write();
        if let Some(node) = nodes.get_mut(node_id) {
            node.models = models;
            self.update_stats_internal(&nodes);
        }
    }

    fn update_stats_internal(&self, nodes: &HashMap<String, NodeInfo>) {
        let mut total_models = 0;
        let mut available_count = 0;
        for n in nodes.values() {
            total_models += n.models.len();
            if n.available {
                available_count += 1;
            }
        }
        let mut stats = self.stats.lock().unwrap();
        stats.fleet_size = nodes.len();
        stats.nodes_available = available_count;
        stats.models_loaded = total_models;
    }

    pub fn route_request(&self, model: &str) -> Option<String> {
        let start = std::time::Instant::now();
        let nodes = self.nodes.read();
        
        // Find node with model and lowest load
        let best_node = nodes.values()
            .filter(|n| n.available && n.models.contains(&model.to_string()))
            .min_by_key(|n| n.load);
            
        let mut stats = self.stats.lock().unwrap();
        
        let latency_us = start.elapsed().as_micros() as u64;
        let total_latency = (stats.avg_routing_latency_us * stats.requests_routed as u64) + latency_us;
        stats.requests_routed += 1;
        stats.avg_routing_latency_us = total_latency / stats.requests_routed as u64;

        if let Some(node) = best_node {
            Some(node.id.clone())
        } else {
            stats.fallback_count += 1;
            // Fallback: routing to a node to trigger compilation path.
            // Simplified to None as compilation metadata isn't on NodeInfo.
            None
        }
    }

    pub fn get_receipt(&self) -> DatacenterReceipt {
        self.stats.lock().unwrap().clone()
    }
}

// Implement Mock Integrations
pub struct VllmBridge;
impl VllmIntegration for VllmBridge {
    fn hook_scheduler(&self) {}
    fn manage_kv_cache(&self) {}
    fn dispatch_tribunus_kernel(&self) -> bool { true }
}

pub struct SglangBridge;
impl SglangIntegration for SglangBridge {
    fn share_prefix_cache(&self, _prefix: &str) {}
    fn bridge_kernel(&self) {}
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_routing_and_fallback() {
        let dc = DatacenterState::new();
        
        let node_a = NodeInfo {
            id: "node-a".to_string(),
            available: true,
            models: vec!["gpt-4".to_string()],
            load: 10,
        };
        let node_b = NodeInfo {
            id: "node-b".to_string(),
            available: true,
            models: vec![],
            load: 5,
        };
        
        dc.register_node(node_a);
        dc.register_node(node_b);
        
        // Route to node A
        let routed = dc.route_request("gpt-4");
        assert_eq!(routed, Some("node-a".to_string()));
        
        let receipt = dc.get_receipt();
        assert_eq!(receipt.requests_routed, 1);
        assert_eq!(receipt.fallback_count, 0);
        
        // Unload model on node A
        dc.update_node_models("node-a", vec![]);
        
        // Route request, expect fallback
        let routed_fallback = dc.route_request("gpt-4");
        assert_eq!(routed_fallback, None);
        
        let receipt = dc.get_receipt();
        assert_eq!(receipt.fallback_count, 1);
        assert_eq!(receipt.requests_routed, 2); // 2 requests were processed
    }
}
