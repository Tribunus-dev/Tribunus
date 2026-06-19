use anyhow::Result;
use mlx_rs::Array;
use std::collections::HashMap;

pub type Tensor = Array;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Hot,
    Compressed,
}

#[derive(Debug, Clone)]
pub struct KVPage {
    pub id: u32,
    pub tier: Tier,
    pub generation_counter: u64,
    pub branch_id: u8,
    pub tokens: u32,
    pub data: Option<Tensor>,
}

#[derive(Debug)]
pub struct KVCache {
    pub pages: HashMap<u32, KVPage>,
    pub next_page_id: u32,
    pub current_token_pos: u32,
}

impl KVCache {
    pub fn new() -> Self {
        Self {
            pages: HashMap::new(),
            next_page_id: 0,
            current_token_pos: 0,
        }
    }
}

#[derive(Debug)]
pub struct MigrationResult {
    pub pages_appended: u32,
    pub pages_migrated: u32,
    pub tier_transitions: u32,
    pub compression_ratio: f32,
    pub ssd_bytes_read: u64,
    pub rollback_branch_id: u8,
    pub pages_invalidated: u32,
}

// In a real implementation this would use TurboQuant kernels from KV Compression session
fn compress_with_turboquant(tensor: &Tensor) -> Tensor {
    // Mock compression
    tensor.clone()
}

pub fn kv_append(_token_id: u32, k: &Tensor, v: &Tensor, kv_cache: &mut KVCache) -> Result<()> {
    kv_cache.current_token_pos += 1;
    
    // Everything appended is initially Hot
    let page_id = kv_cache.next_page_id;
    kv_cache.next_page_id += 1;
    
    // Mock concatenation of k and v
    let data = k.clone(); // In real implementation, concat k and v
    
    kv_cache.pages.insert(page_id, KVPage {
        id: page_id,
        tier: Tier::Hot,
        generation_counter: 1, // initialize from page table entry logic
        branch_id: 0, // default
        tokens: 1,
        data: Some(data),
    });

    Ok(())
}

// Async migration task that runs in the background
pub async fn kv_migrate_background(kv_cache: &mut KVCache) -> Result<MigrationResult> {
    let mut pages_migrated = 0;
    
    // Background pass. When a token moves out of the hot window (>2048 from current position)
    let threshold = kv_cache.current_token_pos.saturating_sub(2048);
    
    for page in kv_cache.pages.values_mut() {
        if page.tier == Tier::Hot && page.id < threshold {
            page.tier = Tier::Compressed;
            if let Some(ref data) = page.data {
                // Compress using TurboQuant logic (INT4)
                page.data = Some(compress_with_turboquant(data));
            }
            pages_migrated += 1;
        }
    }

    Ok(MigrationResult {
        pages_appended: 0,
        pages_migrated,
        tier_transitions: pages_migrated,
        compression_ratio: 0.25, // INT4 compression ratio theoretically 0.25
        ssd_bytes_read: 0,
        rollback_branch_id: 0,
        pages_invalidated: 0,
    })
}

// Synchronous wrapper for test compatibility
pub fn kv_migrate(kv_cache: &mut KVCache) -> Result<MigrationResult> {
    // In a real scenario, this would spawn a background tokio task
    // For this synchronous signature, we perform it synchronously
    let mut pages_migrated = 0;
    
    // Background pass. When a token moves out of the hot window (>2048 from current position)
    let threshold = kv_cache.current_token_pos.saturating_sub(2048);
    
    for page in kv_cache.pages.values_mut() {
        if page.tier == Tier::Hot && page.id < threshold {
            page.tier = Tier::Compressed;
            if let Some(ref data) = page.data {
                // Compress using TurboQuant logic (INT4)
                page.data = Some(compress_with_turboquant(data));
            }
            pages_migrated += 1;
        }
    }

    Ok(MigrationResult {
        pages_appended: 0,
        pages_migrated,
        tier_transitions: pages_migrated,
        compression_ratio: 0.25,
        ssd_bytes_read: 0,
        rollback_branch_id: 0,
        pages_invalidated: 0,
    })
}

pub fn kv_rollback(kv_cache: &mut KVCache, branch_id: u8) -> Result<()> {
    for page in kv_cache.pages.values_mut() {
        if page.branch_id == branch_id {
            page.generation_counter += 1;
            // Mark for recycle on next alloc
            page.data = None; 
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlx_rs::ops;

    fn make_tensor() -> Tensor {
        ops::zeros::<f32>(&[1, 1, 1]).unwrap()
    }

    #[test]
    fn test_kv_append_and_migrate() {
        let mut cache = KVCache::new();
        let k = make_tensor();
        let v = make_tensor();

        // Append 3000 tokens
        for i in 0..3000 {
            kv_append(i, &k, &v, &mut cache).unwrap();
        }

        // Run migration
        let _result = kv_migrate(&mut cache).unwrap();

        // Verify hot tier has 2048, compressed tier has 952
        let hot_count = cache.pages.values().filter(|p| p.tier == Tier::Hot).count();
        let compressed_count = cache.pages.values().filter(|p| p.tier == Tier::Compressed).count();

        assert_eq!(hot_count, 2048);
        assert_eq!(compressed_count, 952);
    }

    #[test]
    fn test_kv_rollback() {
        let mut cache = KVCache::new();
        let k = make_tensor();
        let v = make_tensor();

        // Add some pages on branch 3
        for i in 0..5 {
            kv_append(i, &k, &v, &mut cache).unwrap();
            let page_id = cache.next_page_id - 1;
            cache.pages.get_mut(&page_id).unwrap().branch_id = 3;
        }

        // Add some pages on branch 0
        for i in 5..10 {
            kv_append(i, &k, &v, &mut cache).unwrap();
        }

        let before_gen = cache.pages.get(&0).unwrap().generation_counter;
        
        kv_rollback(&mut cache, 3).unwrap();

        // Check that all 5 speculative pages were invalidated (generation counter incremented)
        for i in 0..5 {
            let page = cache.pages.get(&i).unwrap();
            assert_eq!(page.generation_counter, before_gen + 1);
            assert!(page.data.is_none());
        }
        
        // Other pages unaffected
        for i in 5..10 {
            assert_eq!(cache.pages.get(&i).unwrap().generation_counter, before_gen);
        }
    }
}