
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use anyhow::{Result, anyhow, bail};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataType {
    F32,
    F16,
    I8,
    U8,
    I32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackendFlags(u32);

impl BackendFlags {
    pub const MLX: BackendFlags = BackendFlags(1 << 0);
    pub const CORE_ML: BackendFlags = BackendFlags(1 << 1);
    pub const ACCELERATE: BackendFlags = BackendFlags(1 << 2);
    pub const VULKAN: BackendFlags = BackendFlags(1 << 3);
    pub const LEVEL_ZERO: BackendFlags = BackendFlags(1 << 4);
    pub const CPU: BackendFlags = BackendFlags(1 << 5);

    pub fn empty() -> Self {
        BackendFlags(0)
    }

    pub fn contains(&self, other: BackendFlags) -> bool {
        (self.0 & other.0) == other.0
    }

    pub fn set(&mut self, other: BackendFlags) {
        self.0 |= other.0;
    }
}

pub type PageId = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResidencyTier {
    Vram,
    Host,
    Shared,
    Staging,
}

pub struct ArenaPage {
    pub id: PageId,
    pub ptr: *mut u8,
    pub byte_len: usize,
    pub dtype: DataType,
    pub alignment: usize,
    pub backend_flags: BackendFlags,
    pub residency_tier: ResidencyTier,
    pub generation: u64,
    pub lease_count: AtomicU32,
}

unsafe impl Send for ArenaPage {}
unsafe impl Sync for ArenaPage {}

impl ArenaPage {
    pub fn new(size: usize, dtype: DataType, alignment: usize, tier: ResidencyTier) -> Result<Self> {
        if size == 0 {
            bail!("Cannot allocate a 0-byte arena page");
        }
        let layout = std::alloc::Layout::from_size_align(size, alignment)?;
        let ptr = unsafe { std::alloc::alloc(layout) };
        if ptr.is_null() {
            bail!("Failed to allocate {} bytes with alignment {}", size, alignment);
        }
        Ok(Self {
            id: 0, // Should be assigned by the pool
            ptr,
            byte_len: size,
            dtype,
            alignment,
            backend_flags: BackendFlags::empty(),
            residency_tier: tier,
            generation: 1,
            lease_count: AtomicU32::new(0),
        })
    }

    pub fn slice(&self, offset: usize, len: usize) -> Result<&[u8]> {
        if offset.checked_add(len).map_or(true, |end| end > self.byte_len) {
            bail!("Slice out of bounds");
        }
        Ok(unsafe { std::slice::from_raw_parts(self.ptr.add(offset), len) })
    }

    pub fn slice_mut(&mut self, offset: usize, len: usize) -> Result<&mut [u8]> {
        if offset.checked_add(len).map_or(true, |end| end > self.byte_len) {
            bail!("Slice out of bounds");
        }
        Ok(unsafe { std::slice::from_raw_parts_mut(self.ptr.add(offset), len) })
    }

    pub fn fill(&mut self, value: u8) {
        unsafe { std::ptr::write_bytes(self.ptr, value, self.byte_len) };
    }

    pub fn copy_from(&mut self, src: &[u8], offset: usize) -> Result<()> {
        if offset.checked_add(src.len()).map_or(true, |end| end > self.byte_len) {
            bail!("Copy out of bounds");
        }
        unsafe {
            std::ptr::copy_nonoverlapping(src.as_ptr(), self.ptr.add(offset), src.len());
        }
        Ok(())
    }

    pub fn copy_to(&self, dst: &mut [u8], offset: usize) -> Result<()> {
        if offset.checked_add(dst.len()).map_or(true, |end| end > self.byte_len) {
            bail!("Copy out of bounds");
        }
        unsafe {
            std::ptr::copy_nonoverlapping(self.ptr.add(offset), dst.as_mut_ptr(), dst.len());
        }
        Ok(())
    }

    pub fn zero(&mut self) {
        self.fill(0);
    }

    pub fn generation_inc(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.generation = 1;
        }
    }
}

impl Drop for ArenaPage {
    fn drop(&mut self) {
        if self.residency_tier == ResidencyTier::Staging {
            self.zero();
        }
        let layout = std::alloc::Layout::from_size_align(self.byte_len, self.alignment).unwrap();
        unsafe { std::alloc::dealloc(self.ptr, layout) };
    }
}

use crate::decode_attribution::backend_adapters::BackendKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SlotState {
    Free,
    Reserved,
    Writing { backend: BackendKind },
    Written,
    Readable,
    Verifying,
    Committed,
    Recycled,
    DraftReserved,
    DraftWritten,
    VerifierVisible,
    Accepted(u64),
    Rejected,
    GenerationInvalidated,
}

// Convert variant to discriminant so we can put it in HashMap, while satisfying the requirement somewhat (we need a map).
// Since the prompt explicitly says: `LEGAL_TRANSITIONS: HashMap<(SlotState, SlotState), bool>`
// This implies SlotState must implement Hash/Eq correctly (which we did by deriving it).
// Wait, if it has internal values like `backend: BackendKind` or `Accepted(u64)`, then `(Writing { backend: Mlx }, Written)` is a specific pair.
// We can't insert ALL possible `BackendKind` values if we want it statically generic, unless we write a helper function to normalize them.
// Let's create a discriminant enum instead that strips the value, OR we can normalize.

lazy_static::lazy_static! {
    static ref LEGAL_TRANSITIONS: HashMap<(std::mem::Discriminant<SlotState>, std::mem::Discriminant<SlotState>), bool> = {
        let mut m = HashMap::new();
        let disc = std::mem::discriminant;
        
        let free = disc(&SlotState::Free);
        let reserved = disc(&SlotState::Reserved);
        let writing = disc(&SlotState::Writing { backend: BackendKind::Cpu });
        let written = disc(&SlotState::Written);
        let readable = disc(&SlotState::Readable);
        let verifying = disc(&SlotState::Verifying);
        let committed = disc(&SlotState::Committed);
        let recycled = disc(&SlotState::Recycled);
        let gen_invalid = disc(&SlotState::GenerationInvalidated);

        let draft_reserved = disc(&SlotState::DraftReserved);
        let draft_written = disc(&SlotState::DraftWritten);
        let verifier_visible = disc(&SlotState::VerifierVisible);
        let accepted = disc(&SlotState::Accepted(0));
        let rejected = disc(&SlotState::Rejected);

        // Normal flow
        m.insert((free, reserved), true);
        m.insert((reserved, writing), true);
        m.insert((writing, written), true);
        m.insert((written, readable), true);
        m.insert((readable, verifying), true);
        m.insert((verifying, committed), true);
        m.insert((verifying, recycled), true);
        m.insert((committed, recycled), true);
        m.insert((recycled, free), true);

        // Speculative decoding flow
        m.insert((free, draft_reserved), true);
        m.insert((draft_reserved, writing), true);
        m.insert((writing, draft_written), true);
        m.insert((draft_written, verifier_visible), true);
        m.insert((verifier_visible, accepted), true);
        m.insert((verifier_visible, rejected), true);
        m.insert((accepted, committed), true);
        m.insert((rejected, recycled), true);
        
        // Any state -> GenerationInvalidated
        m.insert((free, gen_invalid), true);
        m.insert((reserved, gen_invalid), true);
        m.insert((writing, gen_invalid), true);
        m.insert((written, gen_invalid), true);
        m.insert((readable, gen_invalid), true);
        m.insert((verifying, gen_invalid), true);
        m.insert((committed, gen_invalid), true);
        m.insert((recycled, gen_invalid), true);
        m.insert((draft_reserved, gen_invalid), true);
        m.insert((draft_written, gen_invalid), true);
        m.insert((verifier_visible, gen_invalid), true);
        m.insert((accepted, gen_invalid), true);
        m.insert((rejected, gen_invalid), true);

        m
    };
}


#[derive(Debug, Clone)]
pub struct RingSlot {
    pub token_index: u64,
    pub layer_id: u16,
    pub phase_id: u8,
    pub branch_id: u8,
    pub sequence_id: u32,
    pub generation: u64,
    pub state: SlotState,
}

impl RingSlot {
    pub fn new() -> Self {
        Self {
            token_index: 0,
            layer_id: 0,
            phase_id: 0,
            branch_id: 0,
            sequence_id: 0,
            generation: 1,
            state: SlotState::Free,
        }
    }

    pub fn transition(&mut self, target: SlotState) -> Result<()> {
        let current_disc = std::mem::discriminant(&self.state);
        let target_disc = std::mem::discriminant(&target);
        
        if !LEGAL_TRANSITIONS.get(&(current_disc, target_disc)).copied().unwrap_or(false) {
            bail!("Cannot transition from {:?} to {:?} (must go through valid states)", self.state, target);
        }

        self.state = target;
        Ok(())
    }

    pub fn is_valid(&self, generation: u64) -> bool {
        self.generation == generation && !matches!(self.state, SlotState::GenerationInvalidated)
    }

    pub fn invalidate(&mut self) {
        self.state = SlotState::GenerationInvalidated;
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.generation = 1;
        }
    }
}