use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct ArenaConfig {
    pub max_total_bytes: usize,
    pub max_arenas_per_key: usize,
    pub manifest_total_bytes: usize,
}

impl Default for ArenaConfig {
    fn default() -> Self {
        ArenaConfig {
            max_total_bytes: 1024 * 1024 * 1024,
            max_arenas_per_key: 16,
            manifest_total_bytes: 1024 * 1024 * 1024,
        }
    }
}

pub trait BackendLane: Send + Sync {
    fn submit(&mut self, command: LaneCommand) -> Result<LaneReceipt, String>;
}

#[derive(Clone)]
pub struct LaneCommand {
    pub id: u64,
    pub phase_id: u64,
}

#[derive(Debug)]
pub struct LaneReceipt {
    pub command_id: u64,
    pub duration_ns: u64,
    pub bytes_read: usize,
    pub bytes_written: usize,
}

pub struct VkExecutor {}
pub struct ArcExecutor {}

pub struct CompiledPhase {
    pub id: u64,
    pub expected_bytes_read: usize,
    pub expected_bytes_written: usize,
    pub required_pages: usize,
}

pub struct RingRegistry {
    pub kv_ring: Vec<u64>,
    pub speculative_kv_ring: HashMap<u8, Vec<u64>>,
    pub proposal_ring: HashMap<u8, Vec<u64>>,
    pub verifier_ring: HashMap<u8, Vec<u64>>,
    pub logits_ring: Vec<f32>,
    pub capacity: usize,
}
impl RingRegistry {
    pub fn new() -> Self { 
        RingRegistry { 
            kv_ring: Vec::new(),
            speculative_kv_ring: HashMap::new(),
            proposal_ring: HashMap::new(),
            verifier_ring: HashMap::new(),
            logits_ring: Vec::new(),
            capacity: 1024,
        } 
    }
}

#[derive(Clone, Debug)]
pub struct Lease {
    pub id: u64,
    pub branch_id: Option<u8>,
}

pub struct LeaseManager {
    pub active_leases: HashMap<u64, Lease>,
    next_id: u64,
}
impl LeaseManager {
    pub fn new() -> Self { 
        LeaseManager { active_leases: HashMap::new(), next_id: 1 } 
    }
    
    pub fn acquire(&mut self, branch_id: Option<u8>) -> Result<Lease, String> {
        let lease = Lease { id: self.next_id, branch_id };
        self.next_id += 1;
        self.active_leases.insert(lease.id, lease.clone());
        Ok(lease)
    }
    
    pub fn release(&mut self, lease_id: u64) {
        self.active_leases.remove(&lease_id);
    }
}

pub struct LaneManager {
    pub active_commands: Vec<LaneCommand>,
}
impl LaneManager {
    pub fn new() -> Self { 
        LaneManager { active_commands: Vec::new() } 
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PageClass {
    Small,   // 4 KB
    Medium,  // 64 KB
    Large,   // 1 MB
    Huge,    // 2 MB
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PageId(pub u64);

pub struct ArenaPage {
    pub id: PageId,
    pub class: PageClass,
    pub data: Vec<u8>,
}

pub struct ArenaPagePool {
    classes: HashMap<PageClass, Vec<ArenaPage>>,
    total_bytes: usize,
    used_bytes: usize,
    next_id: u64,
    active_pages: HashMap<PageId, usize>,
}

impl ArenaPagePool {
    pub fn new(config: &ArenaConfig) -> Self {
        let mut classes = HashMap::new();
        classes.insert(PageClass::Small, Vec::new());
        classes.insert(PageClass::Medium, Vec::new());
        classes.insert(PageClass::Large, Vec::new());
        classes.insert(PageClass::Huge, Vec::new());
        
        ArenaPagePool {
            classes,
            total_bytes: config.manifest_total_bytes, // from manifest
            used_bytes: 0,
            next_id: 1,
            active_pages: HashMap::new(),
        }
    }

    pub fn allocate(&mut self, class: PageClass) -> Result<PageId, String> {
        let size = match class {
            PageClass::Small => 4 * 1024,
            PageClass::Medium => 64 * 1024,
            PageClass::Large => 1024 * 1024,
            PageClass::Huge => 2 * 1024 * 1024,
        };
        
        if self.used_bytes + size > self.total_bytes {
            return Err("OOM".to_string());
        }
        
        let id = PageId(self.next_id);
        self.next_id += 1;
        
        self.used_bytes += size;
        self.active_pages.insert(id, size);
        Ok(id)
    }

    pub fn release(&mut self, page_id: PageId) {
        if let Some(size) = self.active_pages.remove(&page_id) {
            self.used_bytes = self.used_bytes.saturating_sub(size);
        }
    }

    pub fn get_page(&self, _page_id: PageId) -> Result<&ArenaPage, String> {
        Err("Not implemented".to_string())
    }

    pub fn get_page_mut(&mut self, _page_id: PageId) -> Result<&mut ArenaPage, String> {
        Err("Not implemented".to_string())
    }

    pub fn total_bytes(&self) -> usize {
        self.total_bytes
    }

    pub fn used_bytes(&self) -> usize {
        self.used_bytes
    }

    pub fn available_ratio(&self) -> f64 {
        if self.total_bytes == 0 {
            1.0
        } else {
            1.0 - (self.used_bytes as f64 / self.total_bytes as f64)
        }
    }
}

pub struct Arena {
    pub name: String,
    pub pages: ArenaPagePool,
    pub rings: RingRegistry,
    pub leases: LeaseManager,
    pub lanes: LaneManager,
    cpu_lane: Box<dyn BackendLane>,
}

impl Arena {
    pub fn new(config: ArenaConfig, cpu_lane: Box<dyn BackendLane>) -> Self {
        Arena {
            name: "MasterArena".to_string(),
            pages: ArenaPagePool::new(&config),
            rings: RingRegistry::new(),
            leases: LeaseManager::new(),
            lanes: LaneManager::new(),
            cpu_lane,
        }
    }

    pub fn page_pool(&self) -> &ArenaPagePool { &self.pages }
    pub fn rings(&self) -> &RingRegistry { &self.rings }
    pub fn rings_mut(&mut self) -> &mut RingRegistry { &mut self.rings }
    pub fn leases(&self) -> &LeaseManager { &self.leases }
    pub fn leases_mut(&mut self) -> &mut LeaseManager { &mut self.leases }
    pub fn lanes(&self) -> &LaneManager { &self.lanes }
    pub fn lanes_mut(&mut self) -> &mut LaneManager { &mut self.lanes }

    pub fn lifecycle_dump(&self) -> String {
        format!(
            "Arena Lifecycle Dump\nActive Leases: {}\nActive Commands: {}\nUsed Bytes: {}/{}",
            self.leases.active_leases.len(),
            self.lanes.active_commands.len(),
            self.pages.used_bytes,
            self.pages.total_bytes
        )
    }

    pub fn register_vulkan_lane(&mut self, _executor: Arc<Mutex<VkExecutor>>) -> Result<(), String> { Ok(()) }
    pub fn register_levelzero_lane(&mut self, _executor: Arc<Mutex<ArcExecutor>>) -> Result<(), String> { Ok(()) }
    pub fn register_disk_lane(&mut self) -> Result<(), String> { Ok(()) }

    pub fn speculative_rollback(&mut self, branch_id: u8) -> Result<(), String> {
        // Atomic rollback
        // 1. SpeculativeKV ring
        self.rings.speculative_kv_ring.remove(&branch_id);
        
        // 2. Proposal ring
        self.rings.proposal_ring.remove(&branch_id);
        
        // 3. Verifier ring
        self.rings.verifier_ring.remove(&branch_id);
        
        // 4. LeaseManager
        let mut to_remove = Vec::new();
        for (id, lease) in self.leases.active_leases.iter() {
            if lease.branch_id == Some(branch_id) {
                to_remove.push(*id);
            }
        }
        for id in to_remove {
            self.leases.release(id);
        }
        
        Ok(())
    }

    pub fn speculative_commit(&mut self, branch_id: u8, token_ids: &[u64]) -> Result<(), String> {
        // 1. Migrate slots
        if self.rings.kv_ring.len() + token_ids.len() > self.rings.capacity {
            return Err("RingOverflow".to_string());
        }
        self.rings.kv_ring.extend_from_slice(token_ids);
        self.rings.speculative_kv_ring.remove(&branch_id);
        
        // 2. Verifier complete
        self.rings.verifier_ring.remove(&branch_id);
        self.rings.proposal_ring.remove(&branch_id);
        
        // 3. Logits commit (mock)
        self.rings.logits_ring.push(1.0);
        
        // 4. Invalidate leases
        let mut to_remove = Vec::new();
        for (id, lease) in self.leases.active_leases.iter() {
            if lease.branch_id == Some(branch_id) {
                to_remove.push(*id);
            }
        }
        for id in to_remove {
            self.leases.release(id);
        }
        
        Ok(())
    }

    pub fn inference_step(&mut self, phase: &CompiledPhase) -> Result<Vec<LaneReceipt>, String> {
        let mut acquired_pages = Vec::new();
        let mut acquired_leases = Vec::new();
        
        // 1. Acquire arena pages
        for _ in 0..phase.required_pages {
            match self.pages.allocate(PageClass::Small) {
                Ok(id) => acquired_pages.push(id),
                Err(e) => {
                    // release all if failed
                    for p in acquired_pages {
                        self.pages.release(p);
                    }
                    return Err(e);
                }
            }
        }
        
        // 2. Grant leases
        match self.leases.acquire(None) {
            Ok(lease) => acquired_leases.push(lease.id),
            Err(e) => {
                for p in acquired_pages {
                    self.pages.release(p);
                }
                return Err(e);
            }
        }
        
        // 3. Submit
        let cmd = LaneCommand { id: 1, phase_id: phase.id };
        self.lanes.active_commands.push(cmd.clone());
        let res = self.cpu_lane.submit(cmd);
        
        // 6. Release leases, recycle activation pages
        for l in acquired_leases {
            self.leases.release(l);
        }
        for p in acquired_pages {
            self.pages.release(p);
        }
        self.lanes.active_commands.clear();
        
        // 7. Return receipts
        match res {
            Ok(receipt) => Ok(vec![receipt]),
            Err(e) => Err(e),
        }
    }
}
