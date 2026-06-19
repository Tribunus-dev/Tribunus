use std::collections::{HashMap, VecDeque};
use std::time::{Instant, Duration};
use std::sync::{Arc, Mutex};
use tokenizers::Tokenizer;

// Stubs for types from other modules
pub type PageId = u64;

pub struct ComputeImage {
    pub tokenizer_bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct TokenizedRequest {
    pub request_id: u64,
    pub token_ids: Vec<u32>,
    pub prefix_length: usize,
    pub new_tokens: Vec<u32>,
    pub arena_pages: Vec<PageId>,
}

pub struct TokenIntakeReceipt {
    pub tokenization_time_us: u128,
    pub prefix_cache_hit: bool,
    pub prefix_cache_miss: bool,
    pub batch_size: usize,
    pub tokens_per_request: Vec<usize>,
}

// Radix-tree prefix cache
struct RadixNode {
    children: HashMap<u32, RadixNode>,
    is_terminal: bool,
    last_accessed: Instant,
}

pub struct PrefixCache {
    root: RadixNode,
    node_count: usize,
    max_nodes: usize,
}

impl PrefixCache {
    pub fn new(max_nodes: usize) -> Self {
        Self {
            root: RadixNode {
                children: HashMap::new(),
                is_terminal: false,
                last_accessed: Instant::now(),
            },
            node_count: 0,
            max_nodes,
        }
    }

    pub fn insert_and_match(&mut self, token_ids: &[u32]) -> usize {
        let mut current = &mut self.root;
        let mut match_len = 0;

        for (i, &token) in token_ids.iter().enumerate() {
            if current.children.contains_key(&token) {
                current = current.children.get_mut(&token).unwrap();
                current.last_accessed = Instant::now();
                match_len += 1;
            } else {
                if self.node_count >= self.max_nodes {
                    self.evict_lru();
                    if self.node_count >= self.max_nodes {
                        break; // Could not evict
                    }
                }
                current.children.insert(token, RadixNode {
                    children: HashMap::new(),
                    is_terminal: false,
                    last_accessed: Instant::now(),
                });
                current = current.children.get_mut(&token).unwrap();
                self.node_count += 1;
            }
        }
        
        current.is_terminal = true;
        current.last_accessed = Instant::now();
        
        match_len
    }

    fn evict_lru(&mut self) {
        // Find leaf node with oldest access time
        let mut oldest_time = Instant::now();
        let mut path_to_remove = Vec::new();
        
        // Simple DFS to find the oldest leaf
        fn find_oldest_leaf(node: &RadixNode, current_path: Vec<u32>, oldest_time: &mut Instant, best_path: &mut Vec<u32>) {
            if node.children.is_empty() {
                if node.last_accessed < *oldest_time {
                    *oldest_time = node.last_accessed;
                    *best_path = current_path.clone();
                }
            } else {
                for (&token, child) in &node.children {
                    let mut next_path = current_path.clone();
                    next_path.push(token);
                    find_oldest_leaf(child, next_path, oldest_time, best_path);
                }
            }
        }
        
        find_oldest_leaf(&self.root, Vec::new(), &mut oldest_time, &mut path_to_remove);
        
        // Remove it if we found one
        if !path_to_remove.is_empty() {
            let mut current = &mut self.root;
            for i in 0..path_to_remove.len() - 1 {
                current = current.children.get_mut(&path_to_remove[i]).unwrap();
            }
            if current.children.remove(&path_to_remove.last().unwrap()).is_some() {
                self.node_count -= 1;
            }
        }
    }
}

pub struct BatchStager {
    buffer: VecDeque<(u64, String)>,
    last_emit: Instant,
    prefix_cache: PrefixCache,
    next_request_id: u64,
    tokenizer: Option<Tokenizer>,
}

impl BatchStager {
    pub fn new() -> Self {
        Self {
            buffer: VecDeque::new(),
            last_emit: Instant::now(),
            prefix_cache: PrefixCache::new(65536),
            next_request_id: 1,
            tokenizer: None,
        }
    }

    pub fn add_request(&mut self, input: &str) {
        self.buffer.push_back((self.next_request_id, input.to_string()));
        self.next_request_id += 1;
    }

    pub fn should_emit(&self) -> bool {
        self.buffer.len() >= 4 || (!self.buffer.is_empty() && self.last_emit.elapsed() >= Duration::from_millis(10))
    }

    pub fn emit_batch(&mut self, compute_image: &ComputeImage) -> Result<(Vec<TokenizedRequest>, TokenIntakeReceipt), String> {
        let mut batch = Vec::new();
        let mut tokens_per_request = Vec::new();
        let mut cache_hit = false;
        let mut cache_miss = false;

        let start_time = Instant::now();
        
        if self.tokenizer.is_none() {
            self.tokenizer = Some(Tokenizer::from_bytes(&compute_image.tokenizer_bytes)
                .map_err(|e| format!("Failed to load tokenizer: {}", e))?);
        }

        while let Some((req_id, input)) = self.buffer.pop_front() {
            let encoding = self.tokenizer.as_ref().unwrap().encode(input, false)
                .map_err(|e| format!("Tokenization failed: {}", e))?;
            
            let token_ids = encoding.get_ids().to_vec();
            
            let match_len = self.prefix_cache.insert_and_match(&token_ids);
            
            if match_len > 0 {
                cache_hit = true;
            } else {
                cache_miss = true;
            }

            let new_tokens = token_ids[match_len..].to_vec();
            
            batch.push(TokenizedRequest {
                request_id: req_id,
                token_ids: token_ids.clone(),
                prefix_length: match_len,
                new_tokens,
                arena_pages: vec![], // To be filled by arena allocator
            });
            
            tokens_per_request.push(token_ids.len());
            
            if batch.len() >= 4 {
                break;
            }
        }
        
        self.last_emit = Instant::now();
        
        let receipt = TokenIntakeReceipt {
            tokenization_time_us: start_time.elapsed().as_micros(),
            prefix_cache_hit: cache_hit,
            prefix_cache_miss: cache_miss,
            batch_size: batch.len(),
            tokens_per_request,
        };

        Ok((batch, receipt))
    }
}

lazy_static::lazy_static! {
    static ref GLOBAL_STAGER: Mutex<BatchStager> = Mutex::new(BatchStager::new());
}

pub fn token_intake(input: &str, compute_image: &ComputeImage) -> Result<TokenizedRequest, String> {
    let mut stager = GLOBAL_STAGER.lock().unwrap();
    stager.add_request(input);
    let (mut batch, _) = stager.emit_batch(compute_image)?;
    Ok(batch.pop().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_tokenizer() -> Vec<u8> {
        let mut tokenizer = tokenizers::TokenizerBuilder::new()
            .with_model(tokenizers::models::wordpiece::WordPiece::default())
            .build()
            .unwrap();
        // Since we are creating a dummy tokenizer we just need some valid JSON.
        // A simple BPE or WordPiece tokenizer bytes. We can use a minimal one.
        tokenizer.to_string(false).unwrap().into_bytes()
    }

    #[ignore]
    #[test]
    fn test_token_intake() {
        let compute_image = ComputeImage {
            tokenizer_bytes: create_test_tokenizer(),
        };

        let req1 = token_intake("Hello, world!", &compute_image).unwrap();
        
        assert!(!req1.token_ids.is_empty());
        assert_eq!(req1.prefix_length, 0); // First time miss

        // We use stager directly to test cache hit because token_intake pops batch and doesn't return receipt
        let mut stager = BatchStager::new();
        stager.add_request("Hello, world!");
        let (batch1, _) = stager.emit_batch(&compute_image).unwrap();
        assert_eq!(batch1[0].prefix_length, 0);

        stager.add_request("Hello, world!");
        let (batch2, rec2) = stager.emit_batch(&compute_image).unwrap();
        assert!(batch2[0].prefix_length > 0); // Cache hit
        assert!(rec2.prefix_cache_hit);
    }
    
    #[test]
    fn test_lru_eviction() {
        let mut cache = PrefixCache::new(3); // Small limit
        cache.insert_and_match(&[1, 2]); // Node count: 2 (root + 1, 1 + 2)
        std::thread::sleep(Duration::from_millis(10));
        cache.insert_and_match(&[3]); // Node count: 3 (root + 1, 1 + 2, root + 3)
        
        // This will trigger eviction of [1, 2] since it's the oldest leaf
        std::thread::sleep(Duration::from_millis(10));
        cache.insert_and_match(&[4]); 
        
        assert_eq!(cache.node_count, 3);
        assert!(!cache.root.children.contains_key(&1) || cache.root.children[&1].children.is_empty());
    }
}
