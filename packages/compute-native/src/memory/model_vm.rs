#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Vram,
    Unified,
    Ssd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvictionPolicy {
    Lru,
    Fifo,
    None,
}

#[derive(Debug, Clone)]
pub struct VMConfig {
    pub page_size_bytes: usize,
    pub vram_page_count: usize,
    pub prefetch_ahead: usize,
    pub eviction_policy: EvictionPolicy,
}

impl Default for VMConfig {
    fn default() -> Self {
        Self {
            page_size_bytes: 65536, // 64KB
            vram_page_count: 100,
            prefetch_ahead: 2,
            eviction_policy: EvictionPolicy::Lru,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Receipt {
    pub page_faults: u64,
    pub evictions: u64,
    pub prefetches: u64,
    pub avg_page_load_us: u64,
    pub vram_used_bytes: u64,
    pub tier_hits: TierHits,
}

#[derive(Debug, Clone, Default)]
pub struct TierHits {
    pub vram: u64,
    pub unified: u64,
    pub ssd: u64,
}

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Page {
    pub tier: Tier,
    pub page_id: usize,
    pub offset: usize,
    pub length: usize,
}

#[derive(Debug, Clone, Default)]
pub struct PageTable {
    pub mappings: HashMap<String, Page>,
}

impl PageTable {
    pub fn new() -> Self {
        Self {
            mappings: HashMap::new(),
        }
    }

    pub fn map(&mut self, name: String, page: Page) {
        self.mappings.insert(name, page);
    }

    pub fn get(&self, name: &str) -> Option<&Page> {
        self.mappings.get(name)
    }

    pub fn get_mut(&mut self, name: &str) -> Option<&mut Page> {
        self.mappings.get_mut(name)
    }
}

use std::collections::VecDeque;
use std::time::Instant;



pub struct ModelVM {
    pub config: VMConfig,
    pub page_table: PageTable,
    pub receipt: Receipt,
    
    // Manage eviction: stores logical weight names
    // For LRU, most recently used is at the back. For FIFO, newest is at the back.
    vram_pages: VecDeque<String>,
}

impl ModelVM {
    pub fn new(config: VMConfig) -> Self {
        Self {
            config,
            page_table: PageTable::new(),
            receipt: Receipt::default(),
            vram_pages: VecDeque::new(),
        }
    }

    pub fn map_page(&mut self, name: String, page: Page) {
        if page.tier == Tier::Vram {
            self.vram_pages.push_back(name.clone());
            self.receipt.vram_used_bytes += self.config.page_size_bytes as u64;
        }
        self.page_table.map(name, page);
    }

    pub fn get_weight(&mut self, name: &str) -> Option<()> {
        let start_time = Instant::now();

        // Need to check if it exists in the page table first
        let tier = {
            let page = self.page_table.get(name)?;
            page.tier
        };

        match tier {
            Tier::Vram => {
                self.receipt.tier_hits.vram += 1;
                self.update_access(name);
                Some(())
            }
            Tier::Unified => {
                self.receipt.tier_hits.unified += 1;
                self.handle_page_fault(name.to_string(), start_time);
                Some(())
            }
            Tier::Ssd => {
                self.receipt.tier_hits.ssd += 1;
                self.handle_page_fault(name.to_string(), start_time);
                Some(())
            }
        }
    }

    fn update_access(&mut self, name: &str) {
        if self.config.eviction_policy == EvictionPolicy::Lru {
            if let Some(pos) = self.vram_pages.iter().position(|x| x == name) {
                let val = self.vram_pages.remove(pos).unwrap();
                self.vram_pages.push_back(val);
            }
        }
    }

    fn handle_page_fault(&mut self, name: String, start_time: Instant) {
        self.receipt.page_faults += 1;

        // Evict if necessary
        if self.vram_pages.len() >= self.config.vram_page_count {
            self.evict_page();
        }

        // Simulate page load duration and update stats
        let load_duration = start_time.elapsed().as_micros() as u64; // In real usage this would block/async load
        
        // Rolling average approximation
        if self.receipt.page_faults == 1 {
            self.receipt.avg_page_load_us = load_duration;
        } else {
            self.receipt.avg_page_load_us = (self.receipt.avg_page_load_us * (self.receipt.page_faults - 1) + load_duration) / self.receipt.page_faults;
        }

        // Move to VRAM
        if let Some(page) = self.page_table.get_mut(&name) {
            page.tier = Tier::Vram;
            self.vram_pages.push_back(name.clone());
            self.receipt.vram_used_bytes += self.config.page_size_bytes as u64;
        }

        self.simulate_codec_streaming(&name);
    }

    fn evict_page(&mut self) {
        if self.config.eviction_policy == EvictionPolicy::None || self.vram_pages.is_empty() {
            return;
        }

        // Pop front for both LRU (least recently used) and FIFO (oldest)
        if let Some(evicted_name) = self.vram_pages.pop_front() {
            if let Some(page) = self.page_table.get_mut(&evicted_name) {
                // Demote back to Unified (simulating dropping from VRAM to sysmem)
                page.tier = Tier::Unified;
                self.receipt.evictions += 1;
                self.receipt.vram_used_bytes -= self.config.page_size_bytes as u64;
            }
        }
    }

    // Prefetch next N layers
    pub fn prefetch(&mut self, current_layer: usize) {
        let ahead = self.config.prefetch_ahead;
        for i in 1..=ahead {
            let next_layer = current_layer + i;
            let prefetch_name = format!("layer_{}", next_layer);
            
            // Only prefetch if it's mapped and not in VRAM
            if let Some(page) = self.page_table.get(&prefetch_name) {
                if page.tier != Tier::Vram {
                    self.receipt.prefetches += 1;
                    
                    // Simple prefetch: if VRAM is full, we must evict first
                    if self.vram_pages.len() >= self.config.vram_page_count {
                        self.evict_page();
                    }

                    if let Some(page_mut) = self.page_table.get_mut(&prefetch_name) {
                        page_mut.tier = Tier::Vram;
                        self.vram_pages.push_back(prefetch_name.clone());
                        self.receipt.vram_used_bytes += self.config.page_size_bytes as u64;
                        self.simulate_codec_streaming(&prefetch_name);
                    }
                }
            }
        }
    }

    // Simulate background thread decompression
    fn simulate_codec_streaming(&self, name: &str) {
        let _name_clone = name.to_string();
        // In a real implementation this would spawn a thread to decompress TurboQuant
        // e.g. std::thread::spawn(move || { decode(_name_clone) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_page_allocation_and_fault() {
        let mut config = VMConfig::default();
        config.vram_page_count = 5;
        let mut vm = ModelVM::new(config);

        // Map 10 pages, all in Unified tier initially
        for i in 0..10 {
            vm.map_page(
                format!("layer_{}", i),
                Page {
                    tier: Tier::Unified,
                    page_id: i,
                    offset: i * 65536,
                    length: 65536,
                },
            );
        }

        // Fault on layer_0
        vm.get_weight("layer_0");
        assert_eq!(vm.page_table.get("layer_0").unwrap().tier, Tier::Vram);
        assert_eq!(vm.receipt.page_faults, 1);
        assert_eq!(vm.vram_pages.len(), 1);
    }

    #[test]
    fn test_prefetch() {
        let mut config = VMConfig::default();
        config.vram_page_count = 5;
        config.prefetch_ahead = 2;
        let mut vm = ModelVM::new(config);

        for i in 0..10 {
            vm.map_page(
                format!("layer_{}", i),
                Page {
                    tier: Tier::Unified,
                    page_id: i,
                    offset: i * 65536,
                    length: 65536,
                },
            );
        }

        vm.prefetch(0);
        
        // Should have prefetched layer_1 and layer_2
        assert_eq!(vm.page_table.get("layer_1").unwrap().tier, Tier::Vram);
        assert_eq!(vm.page_table.get("layer_2").unwrap().tier, Tier::Vram);
        assert_eq!(vm.receipt.prefetches, 2);
    }

    #[test]
    fn test_eviction_lru() {
        let mut config = VMConfig::default();
        config.vram_page_count = 3;
        config.eviction_policy = EvictionPolicy::Lru;
        let mut vm = ModelVM::new(config);

        for i in 0..5 {
            vm.map_page(
                format!("layer_{}", i),
                Page {
                    tier: Tier::Unified,
                    page_id: i,
                    offset: i * 65536,
                    length: 65536,
                },
            );
        }

        // Load 3 pages into VRAM
        vm.get_weight("layer_0");
        vm.get_weight("layer_1");
        vm.get_weight("layer_2");

        // VRAM is full: [layer_0, layer_1, layer_2]
        assert_eq!(vm.vram_pages.len(), 3);

        // Access layer_0 to make it MRU
        vm.get_weight("layer_0");
        // VRAM order: [layer_1, layer_2, layer_0]

        // Load layer_3, should evict layer_1 (LRU)
        vm.get_weight("layer_3");
        
        assert_eq!(vm.page_table.get("layer_1").unwrap().tier, Tier::Unified);
        assert_eq!(vm.page_table.get("layer_0").unwrap().tier, Tier::Vram);
        assert_eq!(vm.receipt.evictions, 1);
        assert_eq!(vm.vram_pages.len(), 3);
    }
}
