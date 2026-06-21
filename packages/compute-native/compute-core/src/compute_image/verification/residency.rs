use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResidencyVerificationReceipt {
    pub artifact_identity: String,
    pub residency_ok: bool,
    pub total_weight_bytes: u64,
    pub mandatory_object_count: u32,
    pub peak_activation_bytes: u64,
}
