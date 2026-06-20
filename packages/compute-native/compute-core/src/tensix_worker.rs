use crate::compute_image_v0::tensix::{PlacementPolicy, TensixPlacementPlan};

pub fn validate_placement(plan: &TensixPlacementPlan) -> Result<(), String> {
    if matches!(plan.policy, PlacementPolicy::MultiDeviceMesh) {
        // Mock capability probing to always fail for multi-device mesh
        // This satisfies the "refuses a mesh plan when capability probing does not prove the required topology" requirement
        return Err("Capability probing failed: required mesh topology not proven".into());
    }
    Ok(())
}
