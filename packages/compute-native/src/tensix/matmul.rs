use super::weight_loader::{DeviceWeightResidency, ResidencyHandle};

#[derive(Debug, Clone)]
pub struct MatmulProvider {
    pub required_tensor_ids: Vec<String>,
}

impl MatmulProvider {
    pub fn new(required_tensor_ids: Vec<String>) -> Self {
        Self {
            required_tensor_ids,
        }
    }

    pub fn execute(&self, residency: &DeviceWeightResidency) -> Result<(), String> {
        // Resolve weight handles
        let mut handles = Vec::new();
        for tensor_id in &self.required_tensor_ids {
            if let Some(handle) = residency.resolve_handle(tensor_id) {
                handles.push(handle.clone());
            } else {
                return Err(format!(
                    "Tensor ID {} not found in residency map",
                    tensor_id
                ));
            }
        }

        // Mock device execution
        println!(
            "Executing BF16 projection on device using handles: {:?}",
            handles
        );
        Ok(())
    }
}
