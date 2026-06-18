use anyhow::{anyhow, Result};
use std::time::{Instant, Duration};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::collections::VecDeque;
use std::any::Any;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RingType {
    KV,              // Authoritative KV pages — append-heavy, branch-aware
    SpeculativeKV,   // Provisional speculative branches — rollback invalidates generation
    Activation,      // Transient layer outputs — recycled after fence
    Proposal,        // ANE/Core ML expert-conditioned proposals
    Verifier,        // Packed tree-verification inputs
    Logits,          // Compact logits / candidate scores
    Scratch,         // Per-lane temporary workspace
    WeightStaging,   // Decompressed weight tiles for dynamic loading
}

pub struct RingSlotRef {
    pub ring_type: RingType,
    pub slot_id: usize,
    pub generation: u64,
    pub valid_until: Instant,
}

pub trait TypedRing: Send {
    fn ring_type(&self) -> RingType;
    fn slot_count(&self) -> usize;
    fn slot_size(&self) -> usize;
    fn reserve_slot(&mut self) -> Result<RingSlotRef>;
    fn write_slot(&mut self, slot_id: usize, data: &[u8]) -> Result<()>;
    fn read_slot(&self, slot_id: usize) -> Result<&[u8]>;
    fn release_slot(&mut self, slot_id: usize) -> Result<()>;
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

pub struct ArenaConfig {
    pub kv_slot_count: usize,         // default 32768
    pub spec_kv_slot_count: usize,    // default 2048
    pub activation_slot_count: usize, // default 512
    pub proposal_slot_count: usize,   // default 64
    pub verifier_slot_count: usize,   // default 32
    pub logits_slot_count: usize,     // default 128
    pub scratch_slot_count: usize,    // default 64
    pub staging_slot_count: usize,    // default 128
    pub kv_slot_size: usize,          // default 4096
    pub activation_slot_size: usize,  // default 65536
}

impl Default for ArenaConfig {
    fn default() -> Self {
        Self {
            kv_slot_count: 32768,
            spec_kv_slot_count: 2048,
            activation_slot_count: 512,
            proposal_slot_count: 64,
            verifier_slot_count: 32,
            logits_slot_count: 128,
            scratch_slot_count: 64,
            staging_slot_count: 128,
            kv_slot_size: 4096,
            activation_slot_size: 65536,
        }
    }
}

// -----------------------------------------------------------------------------
// Generic Ring for generic types
// -----------------------------------------------------------------------------
pub struct GenericRing {
    ring_type: RingType,
    slot_count: usize,
    slot_size: usize,
    buffer: Vec<u8>,
    free_list: Vec<usize>,
    pub generations: Vec<u64>,
}

impl GenericRing {
    pub fn new(ring_type: RingType, slot_count: usize, slot_size: usize) -> Self {
        Self {
            ring_type,
            slot_count,
            slot_size,
            buffer: vec![0; slot_count * slot_size],
            free_list: (0..slot_count).rev().collect(),
            generations: vec![0; slot_count],
        }
    }
}

impl TypedRing for GenericRing {
    fn ring_type(&self) -> RingType { self.ring_type }
    fn slot_count(&self) -> usize { self.slot_count }
    fn slot_size(&self) -> usize { self.slot_size }

    fn reserve_slot(&mut self) -> Result<RingSlotRef> {
        if let Some(slot_id) = self.free_list.pop() {
            let gen = self.generations[slot_id];
            Ok(RingSlotRef {
                ring_type: self.ring_type,
                slot_id,
                generation: gen,
                valid_until: Instant::now() + Duration::from_secs(60),
            })
        } else {
            Err(anyhow!("{:?} ring overflow: no free slots available", self.ring_type))
        }
    }

    fn write_slot(&mut self, slot_id: usize, data: &[u8]) -> Result<()> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        if data.len() > self.slot_size { return Err(anyhow!("Data too large for slot")); }
        let start = slot_id * self.slot_size;
        self.buffer[start..start + data.len()].copy_from_slice(data);
        Ok(())
    }

    fn read_slot(&self, slot_id: usize) -> Result<&[u8]> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        let start = slot_id * self.slot_size;
        Ok(&self.buffer[start..start + self.slot_size])
    }

    fn release_slot(&mut self, slot_id: usize) -> Result<()> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        self.generations[slot_id] += 1;
        self.free_list.push(slot_id);
        Ok(())
    }

    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
}

// -----------------------------------------------------------------------------
// KV Ring
// -----------------------------------------------------------------------------
pub struct KVRing {
    slot_count: usize,
    slot_size: usize,
    buffer: Vec<u8>,
    free_list: Vec<usize>,
    allocated_queue: VecDeque<usize>, // tracks oldest slots for eviction
    pub generations: Vec<u64>,
}

impl KVRing {
    pub fn new(slot_count: usize, slot_size: usize) -> Self {
        Self {
            slot_count,
            slot_size,
            buffer: vec![0; slot_count * slot_size],
            free_list: (0..slot_count).rev().collect(),
            allocated_queue: VecDeque::with_capacity(slot_count),
            generations: vec![0; slot_count],
        }
    }
}

impl TypedRing for KVRing {
    fn ring_type(&self) -> RingType { RingType::KV }
    fn slot_count(&self) -> usize { self.slot_count }
    fn slot_size(&self) -> usize { self.slot_size }

    fn reserve_slot(&mut self) -> Result<RingSlotRef> {
        let slot_id = if let Some(id) = self.free_list.pop() {
            id
        } else if let Some(id) = self.allocated_queue.pop_front() {
            // Evict oldest
            self.generations[id] += 1;
            id
        } else {
            return Err(anyhow!("KV ring overflow: unable to allocate or evict"));
        };

        self.allocated_queue.push_back(slot_id);

        let gen = self.generations[slot_id];
        Ok(RingSlotRef {
            ring_type: RingType::KV,
            slot_id,
            generation: gen,
            valid_until: Instant::now() + Duration::from_secs(60),
        })
    }

    fn write_slot(&mut self, slot_id: usize, data: &[u8]) -> Result<()> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        if data.len() > self.slot_size { return Err(anyhow!("Data too large")); }
        let start = slot_id * self.slot_size;
        self.buffer[start..start + data.len()].copy_from_slice(data);
        Ok(())
    }

    fn read_slot(&self, slot_id: usize) -> Result<&[u8]> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        let start = slot_id * self.slot_size;
        Ok(&self.buffer[start..start + self.slot_size])
    }

    fn release_slot(&mut self, slot_id: usize) -> Result<()> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        if let Some(pos) = self.allocated_queue.iter().position(|&x| x == slot_id) {
            self.allocated_queue.remove(pos);
            self.generations[slot_id] += 1;
            self.free_list.push(slot_id);
        }
        Ok(())
    }

    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
}

// -----------------------------------------------------------------------------
// Speculative KV Ring
// -----------------------------------------------------------------------------
pub struct SpeculativeKVRing {
    slot_count: usize,
    slot_size: usize,
    buffer: Vec<u8>,
    free_list: Vec<usize>,
    pub generations: Vec<u64>,
    pub branch_map: Vec<Option<usize>>, // slot_id -> branch_id
}

impl SpeculativeKVRing {
    pub fn new(slot_count: usize, slot_size: usize) -> Self {
        Self {
            slot_count,
            slot_size,
            buffer: vec![0; slot_count * slot_size],
            free_list: (0..slot_count).rev().collect(),
            generations: vec![0; slot_count],
            branch_map: vec![None; slot_count],
        }
    }

    pub fn reserve_for_branch(&mut self, branch_id: usize) -> Result<RingSlotRef> {
        let mut slot_ref = self.reserve_slot()?;
        self.branch_map[slot_ref.slot_id] = Some(branch_id);
        Ok(slot_ref)
    }

    pub fn rollback(&mut self, branch_id: usize) -> Result<()> {
        for i in 0..self.slot_count {
            if self.branch_map[i] == Some(branch_id) {
                self.branch_map[i] = None;
                self.generations[i] += 1;
                self.free_list.push(i);
            }
        }
        Ok(())
    }

    pub fn commit(&mut self, slot_id: usize, kv_ring: &mut KVRing) -> Result<()> {
        if self.branch_map[slot_id].is_none() {
            return Err(anyhow!("Slot not allocated to any branch"));
        }
        let data = self.read_slot(slot_id)?.to_vec();
        let kv_slot = kv_ring.reserve_slot()?;
        kv_ring.write_slot(kv_slot.slot_id, &data)?;

        kv_ring.generations[kv_slot.slot_id] = self.generations[slot_id];

        self.branch_map[slot_id] = None;
        self.generations[slot_id] += 1;
        self.free_list.push(slot_id);
        Ok(())
    }
}

impl TypedRing for SpeculativeKVRing {
    fn ring_type(&self) -> RingType { RingType::SpeculativeKV }
    fn slot_count(&self) -> usize { self.slot_count }
    fn slot_size(&self) -> usize { self.slot_size }

    fn reserve_slot(&mut self) -> Result<RingSlotRef> {
        if let Some(slot_id) = self.free_list.pop() {
            let gen = self.generations[slot_id];
            Ok(RingSlotRef {
                ring_type: RingType::SpeculativeKV,
                slot_id,
                generation: gen,
                valid_until: Instant::now() + Duration::from_secs(60),
            })
        } else {
            Err(anyhow!("Speculative KV ring overflow"))
        }
    }

    fn write_slot(&mut self, slot_id: usize, data: &[u8]) -> Result<()> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        if data.len() > self.slot_size { return Err(anyhow!("Data too large")); }
        let start = slot_id * self.slot_size;
        self.buffer[start..start + data.len()].copy_from_slice(data);
        Ok(())
    }

    fn read_slot(&self, slot_id: usize) -> Result<&[u8]> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        let start = slot_id * self.slot_size;
        Ok(&self.buffer[start..start + self.slot_size])
    }

    fn release_slot(&mut self, slot_id: usize) -> Result<()> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        self.branch_map[slot_id] = None;
        self.generations[slot_id] += 1;
        self.free_list.push(slot_id);
        Ok(())
    }

    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
}

// -----------------------------------------------------------------------------
// Proposal Ring
// -----------------------------------------------------------------------------
pub struct ProposalRing {
    slot_count: usize,
    slot_size: usize,
    buffer: Vec<u8>,
    pub generations: Vec<u64>,
    write_cursor: AtomicUsize,
    read_cursor: AtomicUsize,
}

impl ProposalRing {
    pub fn new(slot_count: usize, slot_size: usize) -> Self {
        Self {
            slot_count,
            slot_size,
            buffer: vec![0; slot_count * slot_size],
            generations: vec![0; slot_count],
            write_cursor: AtomicUsize::new(0),
            read_cursor: AtomicUsize::new(0),
        }
    }
}

impl TypedRing for ProposalRing {
    fn ring_type(&self) -> RingType { RingType::Proposal }
    fn slot_count(&self) -> usize { self.slot_count }
    fn slot_size(&self) -> usize { self.slot_size }

    fn reserve_slot(&mut self) -> Result<RingSlotRef> {
        let w = self.write_cursor.load(Ordering::Relaxed);
        let r = self.read_cursor.load(Ordering::Acquire);
        if w.wrapping_sub(r) >= self.slot_count {
            return Err(anyhow!("Proposal ring overflow"));
        }
        let slot_id = w % self.slot_count;
        let gen = self.generations[slot_id];
        self.write_cursor.store(w.wrapping_add(1), Ordering::Release);

        Ok(RingSlotRef {
            ring_type: RingType::Proposal,
            slot_id,
            generation: gen,
            valid_until: Instant::now() + Duration::from_secs(60),
        })
    }

    fn write_slot(&mut self, slot_id: usize, data: &[u8]) -> Result<()> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        let start = slot_id * self.slot_size;
        self.buffer[start..start + data.len()].copy_from_slice(data);
        Ok(())
    }

    fn read_slot(&self, slot_id: usize) -> Result<&[u8]> {
        if slot_id >= self.slot_count { return Err(anyhow!("Invalid slot id")); }
        let start = slot_id * self.slot_size;
        Ok(&self.buffer[start..start + self.slot_size])
    }

    fn release_slot(&mut self, slot_id: usize) -> Result<()> {
        let r = self.read_cursor.load(Ordering::Relaxed);
        if r == self.write_cursor.load(Ordering::Relaxed) {
            return Err(anyhow!("No slot to release"));
        }
        self.generations[slot_id] += 1;
        self.read_cursor.store(r.wrapping_add(1), Ordering::Release);
        Ok(())
    }

    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
}

// -----------------------------------------------------------------------------
// Ring Registry
// -----------------------------------------------------------------------------
pub struct RingRegistry {
    rings: Vec<Box<dyn TypedRing>>,
}

impl RingRegistry {
    pub fn new(config: &ArenaConfig) -> Self {
        let mut rings: Vec<Box<dyn TypedRing>> = Vec::new();

        rings.push(Box::new(KVRing::new(config.kv_slot_count, config.kv_slot_size)));
        rings.push(Box::new(SpeculativeKVRing::new(config.spec_kv_slot_count, config.kv_slot_size)));
        rings.push(Box::new(GenericRing::new(RingType::Activation, config.activation_slot_count, config.activation_slot_size)));
        rings.push(Box::new(ProposalRing::new(config.proposal_slot_count, 16384)));
        rings.push(Box::new(GenericRing::new(RingType::Verifier, config.verifier_slot_count, 131072)));
        rings.push(Box::new(GenericRing::new(RingType::Logits, config.logits_slot_count, 8192)));
        rings.push(Box::new(GenericRing::new(RingType::Scratch, config.scratch_slot_count, 1048576)));
        rings.push(Box::new(GenericRing::new(RingType::WeightStaging, config.staging_slot_count, 2097152)));

        Self { rings }
    }

    pub fn get(&self, rt: RingType) -> &dyn TypedRing {
        self.rings.iter().find(|r| r.ring_type() == rt).unwrap().as_ref()
    }

    pub fn get_mut(&mut self, rt: RingType) -> &mut dyn TypedRing {
        self.rings.iter_mut().find(|r| r.ring_type() == rt).unwrap().as_mut()
    }
}
