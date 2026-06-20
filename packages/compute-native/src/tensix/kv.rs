#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryPlacement {
    Dram,
    L1,
}

#[derive(Debug, Clone)]
pub struct KvBlockTableAbi {
    // Keep an internal logical mapping, but we must materialize it to a flat buffer for the device.
    pub logical_to_physical: std::collections::HashMap<u32, u32>,
    pub generation: u64,
    pub is_cancelled: bool,
    pub placement: MemoryPlacement,
}

// Flat, C-compatible representation of the block table for the Tensix device.
#[repr(C)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TensixBlockTableContract {
    pub generation: u64,
    pub is_cancelled: u32, // 0 = false, 1 = true
    pub placement: u32,    // 0 = Dram, 1 = L1
    pub num_blocks: u32,
    pub padding: u32, // 8-byte alignment
    // Physical block indices in sequence (up to a max size, e.g., 2048)
    pub physical_blocks: [u32; 2048],
}

impl Default for TensixBlockTableContract {
    fn default() -> Self {
        Self {
            generation: 0,
            is_cancelled: 0,
            placement: 0,
            num_blocks: 0,
            padding: 0,
            physical_blocks: [0; 2048],
        }
    }
}

impl KvBlockTableAbi {
    pub fn new() -> Self {
        Self {
            logical_to_physical: std::collections::HashMap::new(),
            generation: 0,
            is_cancelled: false,
            placement: MemoryPlacement::Dram,
        }
    }

    pub fn validate_generation(&self, current_gen: u64) -> Result<(), &'static str> {
        if self.generation != current_gen {
            return Err("Generation mismatch");
        }
        Ok(())
    }

    // Materialize the logical state into a flat, device-visible contract.
    pub fn materialize(&self) -> Result<TensixBlockTableContract, &'static str> {
        let mut contract = TensixBlockTableContract::default();
        contract.generation = self.generation;
        contract.is_cancelled = if self.is_cancelled { 1 } else { 0 };
        contract.placement = match self.placement {
            MemoryPlacement::Dram => 0,
            MemoryPlacement::L1 => 1,
        };

        // For a sequence of tokens, we need the logical blocks 0..N mapped to physical indices.
        // If there are gaps in the logical indices, this basic mapping will fail,
        // but typically a request has contiguous logical blocks.
        let num_blocks = self.logical_to_physical.len();
        if num_blocks > 2048 {
            return Err("Too many blocks for contract");
        }
        contract.num_blocks = num_blocks as u32;

        for i in 0..num_blocks {
            if let Some(&physical) = self.logical_to_physical.get(&(i as u32)) {
                contract.physical_blocks[i] = physical;
            } else {
                return Err("Missing logical block in sequence");
            }
        }

        Ok(contract)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kv_block_table_abi_creation() {
        let table = KvBlockTableAbi::new();
        assert_eq!(table.generation, 0);
        assert_eq!(table.is_cancelled, false);
        assert_eq!(table.placement, MemoryPlacement::Dram);
        assert!(table.logical_to_physical.is_empty());
    }

    #[test]
    fn test_validate_generation() {
        let mut table = KvBlockTableAbi::new();
        table.generation = 42;

        assert_eq!(table.validate_generation(42), Ok(()));
        assert_eq!(table.validate_generation(43), Err("Generation mismatch"));
    }

    #[test]
    fn test_materialize() {
        let mut table = KvBlockTableAbi::new();
        table.generation = 123;
        table.is_cancelled = false;
        table.placement = MemoryPlacement::L1;
        table.logical_to_physical.insert(0, 100);
        table.logical_to_physical.insert(1, 101);

        let contract = table.materialize().unwrap();
        assert_eq!(contract.generation, 123);
        assert_eq!(contract.is_cancelled, 0);
        assert_eq!(contract.placement, 1);
        assert_eq!(contract.num_blocks, 2);
        assert_eq!(contract.physical_blocks[0], 100);
        assert_eq!(contract.physical_blocks[1], 101);
    }

    #[test]
    fn test_materialize_missing_block() {
        let mut table = KvBlockTableAbi::new();
        table.logical_to_physical.insert(0, 100);
        table.logical_to_physical.insert(2, 102); // Missing logical block 1

        let result = table.materialize();
        assert_eq!(result, Err("Missing logical block in sequence"));
    }
}
