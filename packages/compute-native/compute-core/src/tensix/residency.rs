use std::collections::HashMap;

/// Key representing a cached weight
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WeightCacheKey {
    pub tensor_id: String,
    pub capability_signature: String,
    pub topology_hash: String,
    pub layout_version: String,
    pub data_format: String,
}

/// Abstract handle representing residency on the Tensix device
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResidencyHandle(pub String);

/// Entry in the LRU cache
#[derive(Debug, Clone)]
pub struct CacheEntry {
    pub handle: ResidencyHandle,
    pub size_bytes: u64,
    pub is_pinned: bool,
}

pub struct WeightCache {
    entries: HashMap<WeightCacheKey, CacheEntry>,
    lru_order: Vec<WeightCacheKey>,
    max_dram_bytes: u64,
    current_dram_bytes: u64,
    
    // Metrics
    pub upload_avoidance_bytes: u64,
    pub hits: u64,
    pub misses: u64,
}

impl WeightCache {
    pub fn new(max_dram_bytes: u64) -> Self {
        Self {
            entries: HashMap::new(),
            lru_order: Vec::new(),
            max_dram_bytes,
            current_dram_bytes: 0,
            upload_avoidance_bytes: 0,
            hits: 0,
            misses: 0,
        }
    }

    pub fn get(&mut self, key: &WeightCacheKey) -> Option<ResidencyHandle> {
        if let Some(entry) = self.entries.get(key) {
            self.hits += 1;
            self.upload_avoidance_bytes += entry.size_bytes;
            
            // Update LRU
            if let Some(pos) = self.lru_order.iter().position(|k| k == key) {
                let k = self.lru_order.remove(pos);
                self.lru_order.push(k);
            }
            
            Some(entry.handle.clone())
        } else {
            self.misses += 1;
            None
        }
    }

    pub fn insert(&mut self, key: WeightCacheKey, handle: ResidencyHandle, size_bytes: u64, is_pinned: bool) {
        // Evict if necessary
        self.evict_until_fits(size_bytes);
        
        let entry = CacheEntry {
            handle,
            size_bytes,
            is_pinned,
        };
        
        self.entries.insert(key.clone(), entry);
        self.lru_order.push(key);
        self.current_dram_bytes += size_bytes;
    }
    
    pub fn pin(&mut self, key: &WeightCacheKey) {
        if let Some(entry) = self.entries.get_mut(key) {
            entry.is_pinned = true;
        }
    }
    
    pub fn unpin(&mut self, key: &WeightCacheKey) {
         if let Some(entry) = self.entries.get_mut(key) {
            entry.is_pinned = false;
        }
    }

    fn evict_until_fits(&mut self, size_bytes: u64) {
        while self.current_dram_bytes + size_bytes > self.max_dram_bytes {
            let mut evicted_key = None;
            for (i, key) in self.lru_order.iter().enumerate() {
                if let Some(entry) = self.entries.get(key) {
                    if !entry.is_pinned {
                        evicted_key = Some((i, key.clone()));
                        break;
                    }
                }
            }
            
            if let Some((idx, key)) = evicted_key {
                self.lru_order.remove(idx);
                if let Some(entry) = self.entries.remove(&key) {
                    self.current_dram_bytes -= entry.size_bytes;
                }
            } else {
                // Cannot evict anything
                break;
            }
        }
    }

    pub fn invalidate_all(&mut self) {
        self.entries.clear();
        self.lru_order.clear();
        self.current_dram_bytes = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_weight_cache() {
        let mut cache = WeightCache::new(1024);
        
        let key1 = WeightCacheKey {
            tensor_id: "t1".to_string(),
            capability_signature: "cap".to_string(),
            topology_hash: "topo".to_string(),
            layout_version: "v1".to_string(),
            data_format: "format".to_string(),
        };
        let handle1 = ResidencyHandle("h1".to_string());
        
        let key2 = WeightCacheKey {
            tensor_id: "t2".to_string(),
            capability_signature: "cap".to_string(),
            topology_hash: "topo".to_string(),
            layout_version: "v1".to_string(),
            data_format: "format".to_string(),
        };
        let handle2 = ResidencyHandle("h2".to_string());
        
        cache.insert(key1.clone(), handle1.clone(), 600, false);
        assert_eq!(cache.get(&key1), Some(handle1.clone()));
        
        cache.insert(key2.clone(), handle2.clone(), 600, false);
        assert_eq!(cache.get(&key1), None); // Evicted
        assert_eq!(cache.get(&key2), Some(handle2.clone()));
    }
}
