use std::convert::{TryFrom, TryInto};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum EngineType {
    Vllm = 0,
    Sglang = 1,
    TensorRtLlm = 2,
    Tribunus = 3,
}

impl TryFrom<u8> for EngineType {
    type Error = &'static str;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(EngineType::Vllm),
            1 => Ok(EngineType::Sglang),
            2 => Ok(EngineType::TensorRtLlm),
            3 => Ok(EngineType::Tribunus),
            _ => Err("Invalid EngineType"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KVBlockHeader {
    pub magic: [u8; 4],        // "KV01"
    pub version: u8,
    pub engine: EngineType,     // vLLM, SGLang, TRTLLM, Tribunus
    pub num_blocks: u32,
    pub block_size: u32,       // tokens per block (default 16)
    pub head_dim: u16,
    pub n_kv_heads: u16,
    pub dtype: u8,             // FP16=0, FP8=1, INT8=2, INT4=3
    pub page_table_offset: u64,
    pub data_offset: u64,
}

impl KVBlockHeader {
    pub const HEADER_SIZE: usize = 64;

    pub fn encode(&self) -> Result<Vec<u8>, &'static str> {
        let mut buf = vec![0u8; Self::HEADER_SIZE];
        
        buf[0..4].copy_from_slice(&self.magic);
        buf[4] = self.version;
        buf[5] = self.engine as u8;
        buf[6..10].copy_from_slice(&self.num_blocks.to_le_bytes());
        buf[10..14].copy_from_slice(&self.block_size.to_le_bytes());
        buf[14..16].copy_from_slice(&self.head_dim.to_le_bytes());
        buf[16..18].copy_from_slice(&self.n_kv_heads.to_le_bytes());
        buf[18] = self.dtype;
        // 19..24 is padding
        buf[24..32].copy_from_slice(&self.page_table_offset.to_le_bytes());
        buf[32..40].copy_from_slice(&self.data_offset.to_le_bytes());
        // 40..64 is padding for 64-byte alignment

        Ok(buf)
    }

    pub fn decode(data: &[u8]) -> Result<Self, &'static str> {
        if data.len() < Self::HEADER_SIZE {
            return Err("Buffer too small for KVBlockHeader");
        }

        let mut magic = [0u8; 4];
        magic.copy_from_slice(&data[0..4]);

        let version = data[4];
        let engine = EngineType::try_from(data[5])?;

        let num_blocks = u32::from_le_bytes(data[6..10].try_into().unwrap());
        let block_size = u32::from_le_bytes(data[10..14].try_into().unwrap());
        let head_dim = u16::from_le_bytes(data[14..16].try_into().unwrap());
        let n_kv_heads = u16::from_le_bytes(data[16..18].try_into().unwrap());
        let dtype = data[18];
        let page_table_offset = u64::from_le_bytes(data[24..32].try_into().unwrap());
        let data_offset = u64::from_le_bytes(data[32..40].try_into().unwrap());

        Ok(KVBlockHeader {
            magic,
            version,
            engine,
            num_blocks,
            block_size,
            head_dim,
            n_kv_heads,
            dtype,
            page_table_offset,
            data_offset,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_decode() {
        let header = KVBlockHeader {
            magic: *b"KV01",
            version: 1,
            engine: EngineType::Tribunus,
            num_blocks: 1024,
            block_size: 16,
            head_dim: 128,
            n_kv_heads: 32,
            dtype: 0,
            page_table_offset: 4096,
            data_offset: 8192,
        };

        let encoded = header.encode().unwrap();
        assert_eq!(encoded.len(), 64);

        let decoded = KVBlockHeader::decode(&encoded).unwrap();
        assert_eq!(header, decoded);
    }

    #[test]
    fn test_decode_invalid_engine() {
        let mut buf = vec![0u8; 64];
        buf[5] = 99; // Invalid engine type
        assert!(KVBlockHeader::decode(&buf).is_err());
    }

    #[test]
    fn test_decode_buffer_too_small() {
        let buf = vec![0u8; 63];
        assert!(KVBlockHeader::decode(&buf).is_err());
    }
}
