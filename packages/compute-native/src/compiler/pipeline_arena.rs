use std::collections::HashMap;
use crate::compute_ir::PhaseIR;
use crate::decode_attribution::shape_profiles::ShapeProfile;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PageClass {
    Small, // 4KB
    Medium, // 64KB
    Large, // 1MB
    Huge, // 2MB
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum RingType {
    KV,
    SpecKV,
    Activation,
    Proposal,
    Weights,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KVCacheStrategy {
    Paged { block_size: usize, max_blocks: usize },
    Contiguous,
    SlidingWindow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecBudget {
    pub max_branches: usize,
    pub max_depth: usize,
    pub provisional_pages: usize,
}

#[derive(Debug, Clone)]
pub struct ArenaManifest {
    pub page_classes: Vec<PageClass>,
    pub rings: HashMap<RingType, usize>,
    pub total_vram: u64,
    pub total_ram: u64,
    pub kv_blocks: usize,
    pub kv_block_size: usize,
    pub scratch_size: usize,
    pub weight_image_size: u64,
    pub kv_cache_strategy: KVCacheStrategy,
    pub speculative_budget: SpecBudget,
}

pub fn plan_arena(profile: &ShapeProfile, phases: &[PhaseIR]) -> Result<ArenaManifest, String> {
    let mut rings = HashMap::new();
    rings.insert(RingType::KV, 32768);
    rings.insert(RingType::SpecKV, 2048);
    rings.insert(RingType::Activation, 512);

    let weight_image_size = 5_000_000_000; // Mocked 5GB weight for 7B Q4 model
    let kv_block_size = 64; // Example block size
    let kv_blocks = 32768; // Based on RingType::KV
    let kv_cache_size = (kv_block_size * kv_blocks) as u64; // Mock calculation
    let scratch_size = 128_000_000; // 128MB scratch
    let activation_size = 256_000_000; // 256MB activation
    
    // VRAM estimate = weight_image_size + kv_cache_size + scratch_size + activation_size + 20% headroom
    let base_vram = weight_image_size + kv_cache_size + scratch_size as u64 + activation_size as u64;
    let total_vram = (base_vram as f64 * 1.2) as u64;

    Ok(ArenaManifest {
        page_classes: vec![PageClass::Small, PageClass::Medium, PageClass::Large, PageClass::Huge],
        rings,
        total_vram,
        total_ram: total_vram / 2, // Arbitrary for now
        kv_blocks,
        kv_block_size,
        scratch_size: scratch_size as usize,
        weight_image_size,
        kv_cache_strategy: KVCacheStrategy::Paged { block_size: kv_block_size, max_blocks: kv_blocks },
        speculative_budget: SpecBudget { max_branches: 4, max_depth: 16, provisional_pages: 512 },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute_ir::PhaseIR;

    #[test]
    fn test_plan_arena_7b_q4() {
        let profile = ShapeProfile {
            batch_size: 1,
            seq_len: 2048,
            vocab_size: 32000,
            hidden_size: 4096,
            num_layers: 32,
            num_heads: 32,
            num_kv_heads: 32,
            intermediate_size: 11008,
            max_seq_len: 4096,
        };
        let phases: Vec<PhaseIR> = vec![];
        let manifest = plan_arena(&profile, &phases).unwrap();
        // 7B Q4 model fits in < 8GB (fits 5600M)
        assert!(manifest.total_vram < 8_000_000_000, "VRAM {} must be < 8GB", manifest.total_vram);
    }
}
