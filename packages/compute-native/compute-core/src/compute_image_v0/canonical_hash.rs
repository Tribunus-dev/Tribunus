use super::schema::ComputeImageV0;
use sha2::{Digest, Sha256};

pub fn compute_canonical_hash(image: &ComputeImageV0) -> String {
    // Clone and clear volatile fields for deterministic hashing
    let mut canonical = image.clone();
    canonical.schema_hash = "".into();
    canonical.created_at = "".into();

    // Sort phases by full signature
    canonical.phases.sort_by(|a, b| {
        let sig_a = format!("{}-{}-{}", a.phase_name, a.shape_key, a.dtype);
        let sig_b = format!("{}-{}-{}", b.phase_name, b.shape_key, b.dtype);
        sig_a.cmp(&sig_b)
    });

    // Sort candidates and lists inside phases
    for phase in &mut canonical.phases {
        phase.backend_candidates.sort_by(|a, b| a.backend_name.cmp(&b.backend_name));
        phase.input_contract.sort();
        phase.output_contract.sort();
        if let Some(mc) = &mut phase.mutation_contract {
            mc.allowed_operations.sort();
        }
        // Do NOT sort fallback_order, it is semantically meaningful
    }

    // Sort top-level lists
    canonical.dirty_paths_sample.sort();
    canonical.target_context.source_gate_references.sort();

    let json = serde_json::to_string(&canonical).expect("Failed to serialize canonical image");
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    format!("{:x}", hasher.finalize())
}
