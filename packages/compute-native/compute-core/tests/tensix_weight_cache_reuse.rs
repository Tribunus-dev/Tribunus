use tribunus_compute_core::tensix::residency::{WeightCache, WeightCacheKey};
use tribunus_compute_core::tensix::matmul::MatmulProvider;

#[test]
fn test_consecutive_decode_steps_reuse() {
    let cache = WeightCache::new(1024 * 1024 * 1024); // 1GB
    let mut provider = MatmulProvider::new(cache);

    let key = WeightCacheKey {
        tensor_id: "layer_0_weight".to_string(),
        capability_signature: "tensix_v1".to_string(),
        topology_hash: "1x1".to_string(),
        layout_version: "v2".to_string(),
        data_format: "bf16".to_string(),
    };

    // Step 1: Initial decode
    let handle1 = provider.bind_weights(key.clone(), 1024, true);
    assert_eq!(provider.cache.misses, 1);
    assert_eq!(provider.cache.hits, 0);

    // Step 2: Consecutive decode using the same model session
    let handle2 = provider.bind_weights(key.clone(), 1024, true);
    
    // Acceptance criteria: cache hit on second step, upload avoidance tracks transferred bytes
    assert_eq!(provider.cache.misses, 1);
    assert_eq!(provider.cache.hits, 1);
    assert_eq!(provider.cache.upload_avoidance_bytes, 1024);
    assert_eq!(handle1, handle2);
}

#[test]
fn test_device_reset_invalidates_entries() {
    let cache = WeightCache::new(1024 * 1024 * 1024);
    let mut provider = MatmulProvider::new(cache);

    let key = WeightCacheKey {
        tensor_id: "layer_1_weight".to_string(),
        capability_signature: "tensix_v1".to_string(),
        topology_hash: "1x1".to_string(),
        layout_version: "v2".to_string(),
        data_format: "bf16".to_string(),
    };

    provider.bind_weights(key.clone(), 1024, false);
    assert_eq!(provider.cache.misses, 1);

    // Device reset invalidates all
    provider.cache.invalidate_all();

    // After reset, same key is a miss
    provider.bind_weights(key.clone(), 1024, false);
    assert_eq!(provider.cache.misses, 2);
    assert_eq!(provider.cache.hits, 0);
}

#[test]
fn test_different_capability_signature_miss() {
    let cache = WeightCache::new(1024 * 1024 * 1024);
    let mut provider = MatmulProvider::new(cache);

    let key_v1 = WeightCacheKey {
        tensor_id: "layer_2_weight".to_string(),
        capability_signature: "tensix_v1".to_string(),
        topology_hash: "1x1".to_string(),
        layout_version: "v2".to_string(),
        data_format: "bf16".to_string(),
    };

    let key_v2 = WeightCacheKey {
        tensor_id: "layer_2_weight".to_string(), // Same tensor
        capability_signature: "tensix_v2".to_string(), // Different signature
        topology_hash: "1x1".to_string(),
        layout_version: "v2".to_string(),
        data_format: "bf16".to_string(),
    };

    provider.bind_weights(key_v1.clone(), 1024, true);
    assert_eq!(provider.cache.misses, 1);

    // Using different signature for the same tensor is a miss
    provider.bind_weights(key_v2.clone(), 1024, true);
    assert_eq!(provider.cache.misses, 2);
    assert_eq!(provider.cache.hits, 0);
}
