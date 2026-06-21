#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KvCacheState {
    Unallocated,
    Allocated,
    Primed,
    Decoding,
    Synchronized,
    Invalidated,
    Released,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KvCacheError {
    InvalidStateTransition {
        from: KvCacheState,
        to: KvCacheState,
    },
    GenerationMismatch {
        expected: u64,
        actual: u64,
    },
    InsufficientPages {
        requested: usize,
        available: usize,
    },
    SequenceNotFound(SequenceId),
    SequenceAlreadyExists(SequenceId),
}

use std::collections::HashMap;

pub type PageId = u32;
pub type SequenceId = u32;

pub trait EvictionPolicy: Send + Sync {
    fn on_evict(&self, seq_id: SequenceId, page_ids: &[PageId]);
}

pub struct DummyEvictionPolicy;
impl EvictionPolicy for DummyEvictionPolicy {
    fn on_evict(&self, _seq_id: SequenceId, _page_ids: &[PageId]) {}
}

#[derive(Debug)]
pub struct PagePool {
    pub total_pages: u32,
    pub free_pages: Vec<PageId>,
    pub active_pages: HashMap<SequenceId, Vec<PageId>>,
}

impl PagePool {
    pub fn new(total_pages: u32) -> Self {
        Self {
            total_pages,
            free_pages: (0..total_pages).collect(),
            active_pages: HashMap::new(),
        }
    }

    pub fn allocate(
        &mut self,
        seq_id: SequenceId,
        count: usize,
    ) -> Result<Vec<PageId>, KvCacheError> {
        if self.free_pages.len() < count {
            return Err(KvCacheError::InsufficientPages {
                requested: count,
                available: self.free_pages.len(),
            });
        }

        let mut allocated = Vec::with_capacity(count);
        for _ in 0..count {
            allocated.push(self.free_pages.pop().unwrap());
        }

        self.active_pages
            .entry(seq_id)
            .or_insert_with(Vec::new)
            .extend(allocated.clone());
        Ok(allocated)
    }

    pub fn free(&mut self, seq_id: SequenceId) -> Option<Vec<PageId>> {
        if let Some(pages) = self.active_pages.remove(&seq_id) {
            self.free_pages.extend(pages.clone());
            Some(pages)
        } else {
            None
        }
    }
}

pub struct KvScheduler {
    pub pool: PagePool,
    pub sequences: HashMap<SequenceId, KvCacheRuntime>,
    pub eviction_policy: Box<dyn EvictionPolicy>,
}

impl KvScheduler {
    pub fn new(total_pages: u32, eviction_policy: Box<dyn EvictionPolicy>) -> Self {
        Self {
            pool: PagePool::new(total_pages),
            sequences: HashMap::new(),
            eviction_policy,
        }
    }

    pub fn allocate_sequence(
        &mut self,
        seq_id: SequenceId,
        num_pages: usize,
    ) -> Result<(), KvCacheError> {
        if self.sequences.contains_key(&seq_id) {
            return Err(KvCacheError::SequenceAlreadyExists(seq_id));
        }

        self.pool.allocate(seq_id, num_pages)?;

        let mut runtime = KvCacheRuntime::new();
        runtime.allocate()?;
        self.sequences.insert(seq_id, runtime);
        Ok(())
    }

    pub fn prime_sequence(&mut self, seq_id: SequenceId) -> Result<(), KvCacheError> {
        let runtime = self
            .sequences
            .get_mut(&seq_id)
            .ok_or(KvCacheError::SequenceNotFound(seq_id))?;
        runtime.prime()?;
        Ok(())
    }

    pub fn append_tokens(
        &mut self,
        seq_id: SequenceId,
        expected_generation: u64,
    ) -> Result<(), KvCacheError> {
        let runtime = self
            .sequences
            .get_mut(&seq_id)
            .ok_or(KvCacheError::SequenceNotFound(seq_id))?;
        runtime.validate_then_prepare(expected_generation)?;
        runtime.synchronize()?;
        Ok(())
    }

    pub fn cancel_sequence(&mut self, seq_id: SequenceId) -> Result<(), KvCacheError> {
        if let Some(mut runtime) = self.sequences.remove(&seq_id) {
            runtime.release()?;
            if let Some(pages) = self.pool.free(seq_id) {
                self.eviction_policy.on_evict(seq_id, &pages);
            }
            Ok(())
        } else {
            Err(KvCacheError::SequenceNotFound(seq_id))
        }
    }
}

pub struct KvCacheRuntime {
    state: KvCacheState,
    generation_counter: u64,
    saved_state_on_prepare: Option<(KvCacheState, u64)>,
}

impl KvCacheRuntime {
    pub fn new() -> Self {
        Self {
            state: KvCacheState::Unallocated,
            generation_counter: 0,
            saved_state_on_prepare: None,
        }
    }

    pub fn state(&self) -> KvCacheState {
        self.state
    }

    pub fn generation_counter(&self) -> u64 {
        self.generation_counter
    }

    pub fn allocate(&mut self) -> Result<(), KvCacheError> {
        if self.state != KvCacheState::Unallocated {
            return Err(KvCacheError::InvalidStateTransition {
                from: self.state,
                to: KvCacheState::Allocated,
            });
        }
        self.state = KvCacheState::Allocated;
        Ok(())
    }

    pub fn prime(&mut self) -> Result<(), KvCacheError> {
        if self.state != KvCacheState::Allocated {
            return Err(KvCacheError::InvalidStateTransition {
                from: self.state,
                to: KvCacheState::Primed,
            });
        }
        self.state = KvCacheState::Primed;
        self.generation_counter += 1;
        Ok(())
    }

    pub fn validate_then_prepare(&mut self, expected_generation: u64) -> Result<(), KvCacheError> {
        if self.state != KvCacheState::Primed && self.state != KvCacheState::Synchronized {
            return Err(KvCacheError::InvalidStateTransition {
                from: self.state,
                to: KvCacheState::Decoding,
            });
        }
        if self.generation_counter != expected_generation {
            return Err(KvCacheError::GenerationMismatch {
                expected: expected_generation,
                actual: self.generation_counter,
            });
        }
        self.saved_state_on_prepare = Some((self.state, self.generation_counter));
        self.state = KvCacheState::Decoding;
        self.generation_counter += 1;
        Ok(())
    }

    pub fn synchronize(&mut self) -> Result<(), KvCacheError> {
        if self.state != KvCacheState::Decoding {
            return Err(KvCacheError::InvalidStateTransition {
                from: self.state,
                to: KvCacheState::Synchronized,
            });
        }
        self.state = KvCacheState::Synchronized;
        self.saved_state_on_prepare = None;
        Ok(())
    }

    pub fn rollback(&mut self) -> Result<(), KvCacheError> {
        if self.state != KvCacheState::Decoding {
            return Err(KvCacheError::InvalidStateTransition {
                from: self.state,
                to: KvCacheState::Invalidated, // or back to prev?
            });
        }
        if let Some((prev_state, prev_gen)) = self.saved_state_on_prepare.take() {
            self.state = prev_state;
            self.generation_counter = prev_gen;
            Ok(())
        } else {
            // Should not happen if we transitioned to Decoding properly
            self.state = KvCacheState::Invalidated;
            Ok(())
        }
    }

    pub fn invalidate(&mut self) -> Result<(), KvCacheError> {
        self.state = KvCacheState::Invalidated;
        Ok(())
    }

    pub fn release(&mut self) -> Result<(), KvCacheError> {
        self.state = KvCacheState::Released;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kv_cache_acceptance_sequence() {
        let mut runtime = KvCacheRuntime::new();
        assert_eq!(runtime.state(), KvCacheState::Unallocated);

        // allocate
        runtime.allocate().unwrap();
        assert_eq!(runtime.state(), KvCacheState::Allocated);

        // prime with prefill output
        runtime.prime().unwrap();
        assert_eq!(runtime.state(), KvCacheState::Primed);
        let gen = runtime.generation_counter();

        // validate generation counter, append decode tokens (prepare)
        runtime.validate_then_prepare(gen).unwrap();
        assert_eq!(runtime.state(), KvCacheState::Decoding);

        // roll back on a simulated cancellation
        runtime.rollback().unwrap();
        assert_eq!(runtime.state(), KvCacheState::Primed);
        assert_eq!(runtime.generation_counter(), gen);

        // release
        runtime.release().unwrap();
        assert_eq!(runtime.state(), KvCacheState::Released);
    }
}

#[cfg(test)]
mod multi_sequence_tests {
    use super::*;

    #[test]
    fn test_multi_sequence_scheduler() {
        let mut scheduler = KvScheduler::new(10, Box::new(DummyEvictionPolicy));

        // Allocate pages for 3 sequences
        scheduler.allocate_sequence(1, 2).unwrap();
        scheduler.allocate_sequence(2, 3).unwrap();
        scheduler.allocate_sequence(3, 4).unwrap();

        // Check pool state
        assert_eq!(scheduler.pool.free_pages.len(), 1);
        assert_eq!(scheduler.pool.active_pages.get(&1).unwrap().len(), 2);
        assert_eq!(scheduler.pool.active_pages.get(&2).unwrap().len(), 3);
        assert_eq!(scheduler.pool.active_pages.get(&3).unwrap().len(), 4);

        // Prime them all
        scheduler.prime_sequence(1).unwrap();
        scheduler.prime_sequence(2).unwrap();
        scheduler.prime_sequence(3).unwrap();

        // Append tokens to each independently
        let gen1 = scheduler.sequences.get(&1).unwrap().generation_counter();
        let gen2 = scheduler.sequences.get(&2).unwrap().generation_counter();
        let gen3 = scheduler.sequences.get(&3).unwrap().generation_counter();

        scheduler.append_tokens(1, gen1).unwrap();
        scheduler.append_tokens(2, gen2).unwrap();
        scheduler.append_tokens(3, gen3).unwrap();

        // Validate generation counter progressed
        assert_eq!(
            scheduler.sequences.get(&1).unwrap().generation_counter(),
            gen1 + 1
        );

        // Cancel sequence 2
        scheduler.cancel_sequence(2).unwrap();

        // Verify its pages returned to free pool
        assert_eq!(scheduler.pool.free_pages.len(), 4); // 1 originally free + 3 from seq 2
        assert!(!scheduler.pool.active_pages.contains_key(&2));
        assert!(!scheduler.sequences.contains_key(&2));

        // Reuse pages for a new sequence
        scheduler.allocate_sequence(4, 4).unwrap();
        assert_eq!(scheduler.pool.free_pages.len(), 0);
        assert_eq!(scheduler.pool.active_pages.get(&4).unwrap().len(), 4);
    }
}
