use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResidencyHandle(pub u64);

#[derive(Debug, Clone)]
pub struct DeviceWeightResidency {
    pub id: String,
    pub segment_map: HashMap<String, ResidencyHandle>,
    pub checksum: String,
    pub size_bytes: u64,
}

impl DeviceWeightResidency {
    pub fn new(id: String, checksum: String, size_bytes: u64) -> Self {
        Self {
            id,
            segment_map: HashMap::new(),
            checksum,
            size_bytes,
        }
    }

    pub fn insert_segment(&mut self, tensor_id: String, handle: ResidencyHandle) {
        self.segment_map.insert(tensor_id, handle);
    }

    pub fn resolve_handle(&self, tensor_id: &str) -> Option<&ResidencyHandle> {
        self.segment_map.get(tensor_id)
    }
}
