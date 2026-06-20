use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TensixMemoryType {
    Dram,
    L1,
    CircularBuffer,
    HostStaging,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ownership {
    Host,
    Device,
    Shared,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TensorTileLayout {
    pub tile_width: usize,
    pub tile_height: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NocContract {
    pub source: u32,
    pub dest: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompletionSemantics {
    Blocking,
    AsyncEvents,
}

#[derive(Debug, Clone)]
pub struct TensixRegionMaterialization {
    pub memory_type: TensixMemoryType,
    pub ownership: Ownership,
    pub byte_range: (usize, usize),
    pub tile_layout: TensorTileLayout,
    pub page_size: usize,
    pub noc_contract: NocContract,
    pub completion: CompletionSemantics,
    pub data: Vec<u8>,
}

impl TensixRegionMaterialization {
    pub fn new(
        memory_type: TensixMemoryType,
        ownership: Ownership,
        byte_range: (usize, usize),
        tile_layout: TensorTileLayout,
        page_size: usize,
        noc_contract: NocContract,
        completion: CompletionSemantics,
    ) -> Self {
        let size = byte_range.1 - byte_range.0;
        Self {
            memory_type,
            ownership,
            byte_range,
            tile_layout,
            page_size,
            noc_contract,
            completion,
            data: vec![0; size],
        }
    }
}

pub struct Receipt {
    pub hash: String,
}

pub fn explicit_host_to_tensix(
    host_buffer: &[u8],
    tensix_region: &mut TensixRegionMaterialization,
) -> Receipt {
    assert_eq!(
        host_buffer.len(),
        tensix_region.data.len(),
        "Buffer sizes must match"
    );
    tensix_region.data.copy_from_slice(host_buffer);

    let mut hasher = Sha256::new();
    hasher.update(host_buffer);
    Receipt {
        hash: format!("{:x}", hasher.finalize()),
    }
}

pub fn explicit_tensix_to_host(
    tensix_region: &TensixRegionMaterialization,
    host_buffer: &mut [u8],
) -> Receipt {
    assert_eq!(
        host_buffer.len(),
        tensix_region.data.len(),
        "Buffer sizes must match"
    );
    host_buffer.copy_from_slice(&tensix_region.data);

    let mut hasher = Sha256::new();
    hasher.update(&tensix_region.data);
    Receipt {
        hash: format!("{:x}", hasher.finalize()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_movement_parity() {
        let size = 1024;
        let host_buffer: Vec<u8> = (0..size).map(|i| (i % 256) as u8).collect();

        let mut tensix_region = TensixRegionMaterialization::new(
            TensixMemoryType::Dram,
            Ownership::Device,
            (0, size as usize),
            TensorTileLayout {
                tile_width: 32,
                tile_height: 32,
            },
            1024,
            NocContract { source: 0, dest: 1 },
            CompletionSemantics::Blocking,
        );

        let receipt1 = explicit_host_to_tensix(&host_buffer, &mut tensix_region);

        let mut readback_buffer = vec![0u8; size];
        let receipt2 = explicit_tensix_to_host(&tensix_region, &mut readback_buffer);

        assert_eq!(
            host_buffer, readback_buffer,
            "Byte-for-byte parity check failed"
        );
        assert_eq!(receipt1.hash, receipt2.hash, "Receipt hashes must match");
    }
}
