use super::residency::{ResidencyHandle, WeightCache, WeightCacheKey};

pub struct MatmulProvider {
    pub cache: WeightCache,
}

impl MatmulProvider {
    pub fn new(cache: WeightCache) -> Self {
        Self { cache }
    }

    pub fn bind_weights(&mut self, key: WeightCacheKey, size_bytes: u64, is_pinned: bool) -> ResidencyHandle {
        if let Some(handle) = self.cache.get(&key) {
            handle
        } else {
            // Simulate upload to device and caching
            let new_handle = ResidencyHandle(format!("device_ptr_for_{}", key.tensor_id));
            self.cache.insert(key, new_handle.clone(), size_bytes, is_pinned);
            new_handle
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_hit_and_miss() {
        let cache = WeightCache::new(1024 * 1024);
        let mut provider = MatmulProvider::new(cache);
        
        let key = WeightCacheKey {
            tensor_id: "w1".to_string(),
            capability_signature: "cap".to_string(),
            topology_hash: "topo".to_string(),
            layout_version: "v1".to_string(),
            data_format: "format".to_string(),
        };
        
        let handle1 = provider.bind_weights(key.clone(), 100, false);
        assert_eq!(provider.cache.misses, 1);
        assert_eq!(provider.cache.hits, 0);
        assert_eq!(provider.cache.upload_avoidance_bytes, 0);
        
        let handle2 = provider.bind_weights(key.clone(), 100, false);
        assert_eq!(provider.cache.misses, 1);
        assert_eq!(provider.cache.hits, 1);
        assert_eq!(provider.cache.upload_avoidance_bytes, 100);
        
        assert_eq!(handle1, handle2);
    }
    
    #[test]
    fn test_device_reset_invalidates_cache() {
        let cache = WeightCache::new(1024 * 1024);
        let mut provider = MatmulProvider::new(cache);
        
        let key = WeightCacheKey {
            tensor_id: "w1".to_string(),
            capability_signature: "cap".to_string(),
            topology_hash: "topo".to_string(),
            layout_version: "v1".to_string(),
            data_format: "format".to_string(),
        };
        
        provider.bind_weights(key.clone(), 100, false);
        assert_eq!(provider.cache.misses, 1);
        
        // Simulate device reset
        provider.cache.invalidate_all();
        
        provider.bind_weights(key.clone(), 100, false);
        assert_eq!(provider.cache.misses, 2);
    }
    
    #[test]
    fn test_different_capability_signature_misses() {
        let cache = WeightCache::new(1024 * 1024);
        let mut provider = MatmulProvider::new(cache);
        
        let key1 = WeightCacheKey {
            tensor_id: "w1".to_string(),
            capability_signature: "cap_old".to_string(),
            topology_hash: "topo".to_string(),
            layout_version: "v1".to_string(),
            data_format: "format".to_string(),
        };
        
        provider.bind_weights(key1.clone(), 100, false);
        assert_eq!(provider.cache.misses, 1);
        
        let key2 = WeightCacheKey {
            tensor_id: "w1".to_string(), // Same tensor
            capability_signature: "cap_new".to_string(), // Different signature
            topology_hash: "topo".to_string(),
            layout_version: "v1".to_string(),
            data_format: "format".to_string(),
        };
        
        provider.bind_weights(key2.clone(), 100, false);
        assert_eq!(provider.cache.misses, 2); // Should be a miss
    }
}
