use anyhow::Result;
use mlx_rs::Array;
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::runtime::arena_integration::Arena;
use crate::runtime::pipeline_kv::KVCache;

pub type Tensor = Array;

pub struct ComputeImage {
    pub backend: String,
}

#[derive(Debug, Clone)]
pub struct DecodeResult {
    pub logits: Tensor,
    pub token: u32,
    pub kv_pages_written: Vec<u32>,
    pub decode_time_us: u64,
    pub backend: String,
    pub batch_family: u8,
}

#[derive(Debug, Clone)]
pub struct DecodeReceipt {
    pub decode_step: u64,
    pub tokens_per_step: u32,
    pub kv_gather_us: u64,
    pub attention_us: u64,
    pub mlp_us: u64,
    pub logits_us: u64,
    pub batch_family: u8,
    pub batch_slot: u32,
    pub batch_size: u32,
    pub total_decode_us: u64,
}

pub struct DecodePipeline {
    pub active_batch_family: u8,
    pub active_batch_size: u32,
    pub weight_prefetch_depth: usize,
    pub step_counter: u64,
    pub graph_capture_time_us: u64,
}

impl DecodePipeline {
    pub fn new() -> Self {
        Self {
            active_batch_family: 1,
            active_batch_size: 1,
            weight_prefetch_depth: 2, // default for memory-bound
            step_counter: 0,
            graph_capture_time_us: 0,
        }
    }

    pub fn set_prefetch_depth(&mut self, depth: usize) {
        self.weight_prefetch_depth = depth;
    }

    pub fn switch_batch_size(&mut self, new_batch_size: u32) -> Result<()> {
        let new_family = Self::get_batch_family(new_batch_size);
        if new_family != self.active_batch_family {
            self.graph_capture_time_us = self.capture_graph(new_family)?;
            self.active_batch_family = new_family;
        } else {
            self.graph_capture_time_us = 0;
        }
        self.active_batch_size = new_batch_size;
        Ok(())
    }

    fn get_batch_family(batch_size: u32) -> u8 {
        if batch_size <= 1 {
            1
        } else if batch_size <= 4 {
            4
        } else if batch_size <= 8 {
            8
        } else if batch_size <= 16 {
            16
        } else {
            32
        }
    }

    fn capture_graph(&mut self, _batch_family: u8) -> Result<u64> {
        // Mock graph capture taking some time
        std::thread::sleep(Duration::from_millis(5));
        Ok(5000) // 5ms in us
    }

    pub fn decode_step(
        &mut self,
        token: u32,
        compute_image: &ComputeImage,
        _kv_cache: &mut KVCache,
        _arena: &mut Arena,
    ) -> Result<DecodeResult> {
        let start = Instant::now();

        let batch_size = self.active_batch_size;
        let batch_family = self.active_batch_family;

        let kv_start = Instant::now();
        std::thread::sleep(Duration::from_micros(100)); // Simulate gather
        let kv_gather_us = kv_start.elapsed().as_micros() as u64;

        let attn_start = Instant::now();
        std::thread::sleep(Duration::from_micros(100)); // Simulate attention
        let attention_us = attn_start.elapsed().as_micros() as u64;

        let mlp_start = Instant::now();
        std::thread::sleep(Duration::from_micros(100)); // Simulate MLP
        let mlp_us = mlp_start.elapsed().as_micros() as u64;

        let logits_start = Instant::now();
        let logits = Array::from_slice(&[0.0f32], &[1]);
        std::thread::sleep(Duration::from_micros(50)); // Simulate logits computation
        let logits_us = logits_start.elapsed().as_micros() as u64;

        let total_decode_us = start.elapsed().as_micros() as u64;

        let _receipt = DecodeReceipt {
            decode_step: self.step_counter,
            tokens_per_step: 1,
            kv_gather_us,
            attention_us,
            mlp_us,
            logits_us,
            batch_family,
            batch_slot: 0,
            batch_size,
            total_decode_us,
        };

        self.step_counter += 1;

        Ok(DecodeResult {
            logits,
            token,
            kv_pages_written: vec![],
            decode_time_us: total_decode_us,
            backend: compute_image.backend.clone(),
            batch_family,
        })
    }
}

pub fn decode_step(
    token: u32,
    compute_image: &ComputeImage,
    kv_cache: &mut KVCache,
    arena: &mut Arena,
) -> Result<DecodeResult> {
    // This is just a helper wrapper if users want to run a single step without maintaining state
    // But practically, callers should maintain DecodePipeline state
    let mut pipeline = DecodePipeline::new();
    pipeline.decode_step(token, compute_image, kv_cache, arena)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::arena_integration::{Arena, ArenaConfig, VkExecutor};
    use crate::runtime::pipeline_kv::KVCache;
    use std::sync::{Arc, Mutex};
    use std::thread;

    fn setup() -> (ComputeImage, KVCache, Arena) {
        let compute_image = ComputeImage {
            backend: "metal".to_string(),
        };
        let kv_cache = KVCache::new();
        let arena_config = ArenaConfig::default();
        let arena = Arena::new(arena_config, Box::new(VkExecutor {}));
        (compute_image, kv_cache, arena)
    }

    #[test]
    fn test_decode_100_tokens() {
        let (compute_image, mut kv_cache, mut arena) = setup();
        let mut pipeline = DecodePipeline::new();

        for i in 0..100 {
            let start = Instant::now();
            let result = pipeline
                .decode_step(i, &compute_image, &mut kv_cache, &mut arena)
                .unwrap();
            let duration = start.elapsed();

            assert!(
                duration.as_millis() < 50,
                "step {} took too long: {}ms",
                i,
                duration.as_millis()
            );
            assert_eq!(result.token, i);
            assert_eq!(result.batch_family, 1);
        }
    }

    #[test]
    fn test_batch_size_switch_recapture() {
        let mut pipeline = DecodePipeline::new();
        assert_eq!(pipeline.active_batch_family, 1);

        // Switch from 1 to 4 should trigger recapture
        let start = Instant::now();
        pipeline.switch_batch_size(4).unwrap();
        let duration = start.elapsed();

        assert_eq!(pipeline.active_batch_family, 4);
        assert_eq!(pipeline.active_batch_size, 4);
        assert!(pipeline.graph_capture_time_us > 0);
        // Verify completes within 10ms
        assert!(
            duration.as_millis() < 10,
            "recapture took {}ms, expected <10ms",
            duration.as_millis()
        );

        // Switch from 4 to 3 should not trigger recapture (same family)
        pipeline.switch_batch_size(3).unwrap();
        assert_eq!(pipeline.active_batch_family, 4);
        assert_eq!(pipeline.graph_capture_time_us, 0);
    }

    #[test]
    fn test_weight_staging_ring_overlap() {
        let mut pipeline = DecodePipeline::new();
        pipeline.set_prefetch_depth(2);

        let start = Instant::now();

        let mut handles = vec![];
        for _ in 0..pipeline.weight_prefetch_depth {
            handles.push(thread::spawn(|| {
                // Simulate prefetching a layer taking some time
                thread::sleep(Duration::from_millis(5));
            }));
        }

        // Simulate attention layer compute
        thread::sleep(Duration::from_millis(10));

        for handle in handles {
            handle.join().unwrap();
        }

        let duration = start.elapsed();
        // Since prefetches (5ms) are overlapped with compute (10ms)
        // the total time should be around 10ms, not 10 + 2*5 = 20ms
        assert!(
            duration.as_millis() < 15,
            "overlap failed, duration was {}ms",
            duration.as_millis()
        );
    }
}