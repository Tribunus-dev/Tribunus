use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResidencyHandle(pub usize);

pub trait DeviceWeightResidency {
    fn load_weights(&mut self, tensor_id: &str, data: &[i8], shape: &[usize]) -> Result<ResidencyHandle, String>;
    fn release_weights(&mut self, handle: ResidencyHandle) -> Result<(), String>;
}
