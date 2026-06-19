use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct WorkerInfo {
    pub id: usize,
    pub kv_cache_blocks: Vec<usize>,  // which blocks this worker holds
    pub load: f32,                     // current load factor 0.0-1.0
}

#[derive(Debug, Clone)]
pub struct KVCache {
    pub required_blocks: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct KVCacheProfile {
    pub num_blocks: usize,
    pub cached_blocks: Vec<usize>,
    pub overlap_scores: Vec<(usize, f32)>, // (worker_id, overlap_score)
    pub estimated_prefill_savings: f64,    // estimated compute savings from cache reuse
}

impl KVCacheProfile {
    pub fn profile(cache: &KVCache, workers: &[WorkerInfo]) -> Self {
        let request_blocks: HashSet<usize> = cache.required_blocks.iter().copied().collect();
        let num_blocks = request_blocks.len();
        
        if num_blocks == 0 {
            return KVCacheProfile {
                num_blocks: 0,
                cached_blocks: vec![],
                overlap_scores: workers.iter().map(|w| (w.id, 0.0)).collect(),
                estimated_prefill_savings: 0.0,
            };
        }

        let mut overlap_scores = Vec::new();
        let mut overall_cached_blocks = HashSet::new();

        for worker in workers {
            let worker_blocks: HashSet<usize> = worker.kv_cache_blocks.iter().copied().collect();
            let intersection: HashSet<_> = worker_blocks.intersection(&request_blocks).copied().collect();
            
            let overlap_score = intersection.len() as f32 / num_blocks as f32;
            overlap_scores.push((worker.id, overlap_score));

            for &block in &intersection {
                overall_cached_blocks.insert(block);
            }
        }

        // We sort the overlap scores so that higher scores come first,
        // and on tie we sort by load (lowest first) or worker ID
        overlap_scores.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
               .unwrap_or(std::cmp::Ordering::Equal)
               .then_with(|| a.0.cmp(&b.0))
        });

        let estimated_prefill_savings = overall_cached_blocks.len() as f64 / num_blocks as f64;
        let mut cached_blocks: Vec<usize> = overall_cached_blocks.into_iter().collect();
        cached_blocks.sort_unstable();

        KVCacheProfile {
            num_blocks,
            cached_blocks,
            overlap_scores,
            estimated_prefill_savings,
        }
    }

    pub fn best_worker(&self) -> Option<(usize, f32)> {
        self.overlap_scores.first().copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profile() {
        let cache = KVCache {
            required_blocks: vec![1, 2, 3, 4, 5],
        };

        let workers = vec![
            WorkerInfo {
                id: 1,
                kv_cache_blocks: vec![1, 2],
                load: 0.5,
            },
            WorkerInfo {
                id: 2,
                kv_cache_blocks: vec![2, 3, 4],
                load: 0.3,
            },
            WorkerInfo {
                id: 3,
                kv_cache_blocks: vec![5, 6, 7],
                load: 0.8,
            },
        ];

        let profile = KVCacheProfile::profile(&cache, &workers);

        assert_eq!(profile.num_blocks, 5);
        
        let expected_cached = vec![1, 2, 3, 4, 5];
        assert_eq!(profile.cached_blocks, expected_cached);
        
        assert_eq!(profile.estimated_prefill_savings, 1.0); // 5/5 blocks are cached somewhere

        assert_eq!(profile.overlap_scores.len(), 3);
        // Worker 2 has 3/5 overlap (0.6)
        // Worker 1 has 2/5 overlap (0.4)
        // Worker 3 has 1/5 overlap (0.2)
        assert_eq!(profile.overlap_scores[0], (2, 0.6));
        assert_eq!(profile.overlap_scores[1], (1, 0.4));
        assert_eq!(profile.overlap_scores[2], (3, 0.2));

        assert_eq!(profile.best_worker(), Some((2, 0.6)));
    }

    #[test]
    fn test_profile_empty() {
        let cache = KVCache {
            required_blocks: vec![],
        };

        let workers = vec![
            WorkerInfo {
                id: 1,
                kv_cache_blocks: vec![1, 2],
                load: 0.5,
            },
        ];

        let profile = KVCacheProfile::profile(&cache, &workers);

        assert_eq!(profile.num_blocks, 0);
        assert_eq!(profile.cached_blocks.len(), 0);
        assert_eq!(profile.estimated_prefill_savings, 0.0);
        assert_eq!(profile.best_worker(), Some((1, 0.0)));
    }
}
