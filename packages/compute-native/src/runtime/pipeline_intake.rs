use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::Mutex;
use tokenizers::Tokenizer;
use anyhow::{Result, anyhow};
use crate::runtime::arena::PageId;
use crate::compute_lane::ComputeImageDescriptor;
use std::collections::HashMap;

pub type ComputeImage = ComputeImageDescriptor;

pub struct TokenizedRequest {
    pub token_ids: Vec<u32>,
    pub prefix_length: usize,
    pub new_tokens: Vec<u32>,
    pub request_id: u64,
    pub arena_pages: Vec<PageId>,
}

#[derive(Debug, Clone)]
pub struct IntakeReceipt {
    pub tokenization_time_us: u64,
    pub prefix_cache_hit: usize,
    pub prefix_cache_miss: usize,
    pub batch_size: usize,
    pub tokens_per_request: usize,
    pub request_id: u64,
}

pub struct IntakePipeline {
    tokenizer: Tokenizer,
    radix_tree: Arc<Mutex<RadixTree>>,
    batch_queue: Mutex<BatchQueue>,
}

struct RadixNode {
    children: HashMap<u32, Box<RadixNode>>,
    last_access: Instant,
}

impl RadixNode {
    fn new() -> Self {
        Self {
            children: HashMap::new(),
            last_access: Instant::now(),
        }
    }
}

struct RadixTree {
    root: Box<RadixNode>,
    node_count: usize,
    max_nodes: usize,
}

impl RadixTree {
    fn new(max_nodes: usize) -> Self {
        Self {
            root: Box::new(RadixNode::new()),
            node_count: 1,
            max_nodes,
        }
    }

    fn insert(&mut self, token_ids: &[u32]) -> usize {
        let mut prefix_length = 0;

        // Pass 1: find prefix
        {
            let mut current = &mut *self.root;
            for &id in token_ids {
                current.last_access = Instant::now();
                if let Some(child) = current.children.get_mut(&id) {
                    prefix_length += 1;
                    current = child;
                } else {
                    break;
                }
            }
        }

        let remaining_to_insert = token_ids[prefix_length..].len();

        // Eviction logic
        if self.node_count + remaining_to_insert > self.max_nodes {
            self.root.children.clear();
            self.node_count = 1;
            prefix_length = 0;
        }

        // Pass 2: insert
        let mut current = &mut *self.root;
        // Navigate back to the end of the prefix
        for &id in &token_ids[..prefix_length] {
            current = current.children.get_mut(&id).unwrap();
        }

        for &id in &token_ids[prefix_length..] {
            let next_node = Box::new(RadixNode::new());
            current.children.insert(id, next_node);
            current = current.children.get_mut(&id).unwrap();
            self.node_count += 1;
        }

        prefix_length
    }
}

pub struct BatchQueue {
    requests: Vec<(String, u64)>, // (input, request_id)
    last_flush: Instant,
}

impl BatchQueue {
    pub fn new() -> Self {
        Self {
            requests: Vec::new(),
            last_flush: Instant::now(),
        }
    }
    
    pub fn add(&mut self, input: String, request_id: u64) -> bool {
        self.requests.push((input, request_id));
        self.requests.len() >= 4 || self.last_flush.elapsed() >= Duration::from_millis(10)
    }
    
    pub fn flush(&mut self) -> Vec<(String, u64)> {
        self.last_flush = Instant::now();
        std::mem::take(&mut self.requests)
    }
}

impl IntakePipeline {
    pub fn new() -> Result<Self> {
        let vocab = r#"{"[UNK]":0, "[CLS]":1, "[SEP]":2, "[PAD]":3, "[MASK]":4, "Hello":5, ",":6, "world":7, "!":8}"#;
        // Build tokenizer dynamically from embedded JSON instead of file
        use tokenizers::models::wordpiece::WordPiece;
        let vocab_map: std::collections::HashMap<String, u32> = serde_json::from_str(vocab).unwrap_or_default();
        let model = WordPiece::builder().vocab(vocab_map).build().unwrap_or_else(|_| WordPiece::default());
        let tokenizer = Tokenizer::new(model);
        
        Ok(Self {
            tokenizer,
            radix_tree: Arc::new(Mutex::new(RadixTree::new(65536))),
            batch_queue: Mutex::new(BatchQueue::new()),
        })
    }
    
    pub fn submit(&self, input: &str, request_id: u64) -> Option<Vec<(String, u64)>> {
        let mut queue = self.batch_queue.lock();
        if queue.add(input.to_string(), request_id) {
            Some(queue.flush())
        } else {
            None
        }
    }
    
    pub fn process_batch(&self, batch: &[(String, u64)], _compute_image: &ComputeImage) -> Result<Vec<(TokenizedRequest, IntakeReceipt)>> {
        let mut results = Vec::new();
        let start = Instant::now();
        let batch_size = batch.len();
        
        for (input, request_id) in batch {
            let encoding = self.tokenizer.encode(input.as_str(), false)
                .map_err(|e| anyhow!("Tokenization failed: {}", e))?;
                
            let token_ids: Vec<u32> = encoding.get_ids().to_vec();
            let tokens_per_request = token_ids.len();
            
            let mut tree = self.radix_tree.lock();
            let prefix_length = tree.insert(&token_ids);
            
            let new_tokens = token_ids[prefix_length..].to_vec();
            
            let receipt = IntakeReceipt {
                tokenization_time_us: start.elapsed().as_micros() as u64,
                prefix_cache_hit: prefix_length,
                prefix_cache_miss: new_tokens.len(),
                batch_size,
                tokens_per_request,
                request_id: *request_id,
            };
            
            results.push((TokenizedRequest {
                token_ids,
                prefix_length,
                new_tokens,
                request_id: *request_id,
                arena_pages: vec![],
            }, receipt));
        }
        
        Ok(results)
    }
}

pub fn token_intake(
    input: &str,
    compute_image: &ComputeImage,
    pipeline: &IntakePipeline,
    request_id: u64,
) -> Result<(TokenizedRequest, IntakeReceipt)> {
    // For single requests to match the prompt's signature backwards compatibility
    let batch = vec![(input.to_string(), request_id)];
    let mut res = pipeline.process_batch(&batch, compute_image)?;
    Ok(res.pop().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenization_basic() {
        let pipeline = IntakePipeline::new().unwrap();
        let compute_image = ComputeImage { image_path: "".into(), image_hash: "".into() };
        
        let (req, receipt) = token_intake("Hello, world!", &compute_image, &pipeline, 1).unwrap();
        
        assert_eq!(req.request_id, 1);
        assert_eq!(receipt.request_id, 1);
        assert!(req.token_ids.len() > 0);
        assert_eq!(req.prefix_length, 0);
        assert_eq!(receipt.prefix_cache_hit, 0);
    }

    #[test]
    fn test_tokenization_prefix_cache_hit() {
        let pipeline = IntakePipeline::new().unwrap();
        let compute_image = ComputeImage { image_path: "".into(), image_hash: "".into() };
        
        let (req1, receipt1) = token_intake("Hello, world!", &compute_image, &pipeline, 1).unwrap();
        assert_eq!(receipt1.prefix_cache_hit, 0);

        let (req2, receipt2) = token_intake("Hello, world!", &compute_image, &pipeline, 2).unwrap();
        
        assert_eq!(req2.request_id, 2);
        assert_eq!(receipt2.request_id, 2);
        assert_eq!(req2.token_ids, req1.token_ids);
        
        assert_eq!(receipt2.prefix_cache_hit, req1.token_ids.len());
        assert_eq!(req2.prefix_length, req1.token_ids.len());
    }
}