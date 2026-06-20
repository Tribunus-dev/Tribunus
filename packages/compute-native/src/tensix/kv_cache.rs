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
