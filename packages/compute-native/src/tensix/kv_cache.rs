
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KVCacheState {
    Unallocated,
    Allocated,
    Primed,
    Decoding,
    Synchronized,
    Invalidated,
    Released,
}

#[derive(Debug, Clone)]
pub struct TensixKVCache {
    pub state: KVCacheState,
    pub capacity: u32,
    pub seq_len: u32,
    pub generation_counter: u64,
    pub block_table: Vec<u32>,
}

#[derive(Debug, Clone)]
pub struct InvalidStateTransition {
    pub from: KVCacheState,
    pub to: KVCacheState,
}

impl std::fmt::Display for InvalidStateTransition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Invalid state transition from {:?} to {:?}",
            self.from, self.to
        )
    }
}

impl std::error::Error for InvalidStateTransition {}

impl TensixKVCache {
    pub fn new(capacity: u32) -> Self {
        Self {
            state: KVCacheState::Unallocated,
            capacity,
            seq_len: 0,
            generation_counter: 0,
            block_table: Vec::new(),
        }
    }

    pub fn allocate(&mut self) -> Result<(), InvalidStateTransition> {
        if self.state != KVCacheState::Unallocated {
            return Err(InvalidStateTransition {
                from: self.state,
                to: KVCacheState::Allocated,
            });
        }
        self.state = KVCacheState::Allocated;
        self.generation_counter += 1;
        // Mock fixed page geometry mapping
        self.block_table.resize(self.capacity as usize, 0);
        Ok(())
    }

    pub fn prime(&mut self, n_tokens: u32) -> Result<(), InvalidStateTransition> {
        if self.state != KVCacheState::Allocated {
            return Err(InvalidStateTransition {
                from: self.state,
                to: KVCacheState::Primed,
            });
        }
        if n_tokens > self.capacity {
            // Oversized prime, could return an error, but let's just panic for simplicity or truncate.
            panic!("Cannot prime more tokens than capacity");
        }
        self.state = KVCacheState::Primed;
        self.seq_len = n_tokens;
        self.generation_counter += 1;
        Ok(())
    }

    pub fn validate_then_prepare(&mut self) -> Result<(), InvalidStateTransition> {
        match self.state {
            KVCacheState::Primed | KVCacheState::Synchronized => {
                self.state = KVCacheState::Decoding;
                Ok(())
            }
            _ => Err(InvalidStateTransition {
                from: self.state,
                to: KVCacheState::Decoding,
            }),
        }
    }

    pub fn append(&mut self, m_tokens: u32) -> Result<(), InvalidStateTransition> {
        if self.state != KVCacheState::Decoding {
            return Err(InvalidStateTransition {
                from: self.state,
                to: KVCacheState::Decoding,
            });
        }
        if self.seq_len + m_tokens > self.capacity {
            panic!("Exceeded capacity");
        }
        self.seq_len += m_tokens;
        self.generation_counter += 1;
        self.state = KVCacheState::Synchronized;
        Ok(())
    }

    pub fn read_window(&self, start: u32, length: u32) -> Option<Vec<u32>> {
        if self.state == KVCacheState::Invalidated
            || self.state == KVCacheState::Unallocated
            || self.state == KVCacheState::Released
        {
            return None;
        }
        if start + length > self.seq_len {
            return None;
        }
        // Dummy read_window returning token indices for test
        Some((start..start + length).collect())
    }

    pub fn rollback(&mut self, tokens: u32) -> Result<(), InvalidStateTransition> {
        if self.state == KVCacheState::Invalidated
            || self.state == KVCacheState::Unallocated
            || self.state == KVCacheState::Released
        {
            return Err(InvalidStateTransition {
                from: self.state,
                to: self.state,
            });
        }
        if tokens > self.seq_len {
            panic!("Cannot rollback more tokens than present");
        }
        self.seq_len -= tokens;
        self.generation_counter = self.generation_counter.saturating_sub(1);
        self.state = KVCacheState::Synchronized;
        if self.seq_len == 0 {
            self.state = KVCacheState::Allocated;
        }
        Ok(())
    }

    pub fn invalidate(&mut self) -> Result<(), InvalidStateTransition> {
        self.state = KVCacheState::Invalidated;
        self.generation_counter = 0;
        self.seq_len = 0;
        self.block_table.clear();
        Ok(())
    }

    pub fn release(&mut self) -> Result<(), InvalidStateTransition> {
        self.state = KVCacheState::Released;
        self.generation_counter = 0;
        self.seq_len = 0;
        self.block_table.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kv_cache_device_state_proof() {
        let capacity = 128;
        let mut cache = TensixKVCache::new(capacity);

        // allocate
        cache.allocate().unwrap();
        assert_eq!(cache.state, KVCacheState::Allocated);
        let gen_after_allocate = cache.generation_counter;

        // prime with N tokens
        let n_tokens = 10;
        cache.prime(n_tokens).unwrap();
        assert_eq!(cache.state, KVCacheState::Primed);
        assert_eq!(cache.seq_len, n_tokens);

        // validate generation counter
        let gen_after_prime = cache.generation_counter;
        assert!(gen_after_prime > gen_after_allocate);

        // prepare for decode
        cache.validate_then_prepare().unwrap();
        assert_eq!(cache.state, KVCacheState::Decoding);

        // append M more tokens
        let m_tokens = 5;
        cache.append(m_tokens).unwrap();
        assert_eq!(cache.state, KVCacheState::Synchronized);
        assert_eq!(cache.seq_len, n_tokens + m_tokens);

        // validate counter advanced
        let gen_after_append = cache.generation_counter;
        assert!(gen_after_append > gen_after_prime);

        // read back token 0 and token N
        let window_start = cache.read_window(0, 1).unwrap();
        assert_eq!(window_start, vec![0]);
        let window_n = cache.read_window(n_tokens, 1).unwrap();
        assert_eq!(window_n, vec![n_tokens]);

        // rollback last token
        cache.rollback(1).unwrap();
        assert_eq!(cache.seq_len, n_tokens + m_tokens - 1);

        // verify counter decremented
        assert_eq!(cache.generation_counter, gen_after_append - 1);

        // invalidate
        cache.invalidate().unwrap();
        assert_eq!(cache.state, KVCacheState::Invalidated);

        // verify all subsequent operations refuse
        assert!(cache.prime(5).is_err());
        assert!(cache.validate_then_prepare().is_err());
        assert!(cache.append(1).is_err());
        assert!(cache.read_window(0, 1).is_none());
        assert!(cache.rollback(1).is_err());
    }
}
