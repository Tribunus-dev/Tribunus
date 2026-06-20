use super::schema::{BackendStatus, ComputeImageV0, KvEvidenceQualification};
use sha2::Digest;
use std::collections::HashSet;

pub struct VerifierOptions {
    pub override_dirty_tree: bool,
}

impl Default for VerifierOptions {
    fn default() -> Self {
        Self {
            override_dirty_tree: false,
        }
    }
}

pub fn verify_v0_image(
    image: &ComputeImageV0,
    options: VerifierOptions,
) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    if image.schema != "tribunus.compute_image.v0" {
        errors.push(format!(
            "Missing or incorrect schema version: {}",
            image.schema
        ));
    }

    if image.compute_scope_dirty && !options.override_dirty_tree {
        errors.push("Compute package is dirty. Refusing to verify.".into());
    }

    // Verify source gate paths
    for path in &image.target_context.source_gate_references {
        if !std::path::Path::new(path).exists() {
            errors.push(format!("Source gate path does not exist: {}", path));
        }
    }

    let mut phase_signatures = HashSet::new();
    let mut has_decode_phase = false;
    let mut has_kv_phase = false;

    for phase in &image.phases {
        let sig = format!(
            "{}-{}-{}-{}",
            phase.phase_name, phase.shape_key, phase.dtype, image.target_context.compute_policy
        );
        if !phase_signatures.insert(sig.clone()) {
            errors.push(format!("Duplicate phase conflict: {}", sig));
        }

        if phase.phase_family == "kv_cache" {
            has_kv_phase = true;
            if let Some(mc) = &phase.mutation_contract {
                // If it claims to be RuntimeQualified but the selected backend evidence is not Pass.
                if mc.evidence_qualification == KvEvidenceQualification::RuntimeQualified {
                    if let Some(sb) = &phase.selected_backend {
                        if let Some(cand) = phase
                            .backend_candidates
                            .iter()
                            .find(|c| &c.backend_name == sb)
                        {
                            if cand.status != BackendStatus::Pass {
                                errors.push(format!(
                                    "Phase {} claims runtime qualification but selected backend '{}' only has status {:?}",
                                    phase.phase_name, sb, cand.status
                                ));
                            }
                        }
                    }
                }
            } else {
                errors.push(format!(
                    "Missing mutation contract for KV phase: {}",
                    phase.phase_name
                ));
            }
        } else {
            has_decode_phase = true;
        }

        if let Some(sb) = &phase.selected_backend {
            if let Some(cand) = phase
                .backend_candidates
                .iter()
                .find(|c| &c.backend_name == sb)
            {
                if cand.status != BackendStatus::Pass && cand.status != BackendStatus::ContractOnly
                {
                    errors.push(format!(
                        "Selected backend {} for {} has no passing evidence (status: {:?})",
                        sb, phase.phase_name, cand.status
                    ));
                }

                if sb == "coreml" && cand.status != BackendStatus::Pass {
                    errors.push(format!(
                        "Core ML selected for {} but is not fully runtime qualified (status: {:?})",
                        phase.phase_name, cand.status
                    ));
                }
            } else {
                errors.push(format!(
                    "Selected backend {} not found in candidates for {}",
                    sb, phase.phase_name
                ));
            }
        }

        for fallback in &phase.fallback_order {
            if let Some(cand) = phase
                .backend_candidates
                .iter()
                .find(|c| &c.backend_name == fallback)
            {
                if cand.status != BackendStatus::Pass {
                    errors.push(format!(
                        "Fallback backend {} for {} has no passing evidence",
                        fallback, phase.phase_name
                    ));
                }
            } else {
                errors.push(format!(
                    "Fallback backend {} not found in candidates for {}",
                    fallback, phase.phase_name
                ));
            }
        }
    }

    if !has_decode_phase {
        errors.push("No decode phases found".into());
    }

    if !has_kv_phase {
        errors.push("No KV phases found".into());
    }

    // Verify hash
    let mut canonical = image.clone();
    canonical.schema_hash = "".into();
    canonical.created_at = "".into();
    canonical
        .phases
        .sort_by(|a, b| a.phase_name.cmp(&b.phase_name));
    canonical.dirty_paths_sample.sort();
    let json = serde_json::to_string(&canonical).unwrap();
    let mut hasher = sha2::Sha256::new();
    sha2::Digest::update(&mut hasher, json.as_bytes());
    let recomputed_hash = format!("{:x}", hasher.finalize());

    if recomputed_hash != image.schema_hash {
        errors.push(format!(
            "Schema hash mismatch. Expected {}, got {}",
            image.schema_hash, recomputed_hash
        ));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute_image_v0::schema::{
        BackendCandidate, BackendStatus, BackendVersions, KvMutationContract, PhaseEntry,
        TargetContext,
    };

    fn create_valid_image() -> ComputeImageV0 {
        ComputeImageV0 {
            schema: "tribunus.compute_image.v0".into(),
            schema_hash: "hash".into(),
            created_at: "time".into(),
            run_id: "run".into(),
            git_commit: "commit".into(),
            compute_scope_dirty: false,
            dirty_paths_sample: vec![],
            evidence_root: "/root".into(),
            target_context: TargetContext {
                repository_provenance: "https".into(),
                device_profile: "m3".into(),
                model_profile: "gemma".into(),
                shape_profile: "shape".into(),
                dtype: "f16".into(),
                compute_policy: "policy".into(),
                backend_versions: BackendVersions {
                    mlx: None,
                    coreml: None,
                    accelerate: None,
                },
                source_gate_references: vec![],
            },
            phases: vec![
                PhaseEntry {
                    phase_name: "decode_phase".into(),
                    phase_family: "linear".into(),
                    shape_key: "shape".into(),
                    dtype: "f16".into(),
                    input_contract: vec![],
                    output_contract: vec![],
                    mutation_contract: None,
                    backend_candidates: vec![BackendCandidate {
                        backend_name: "mlx".into(),
                        status: BackendStatus::Pass,
                        evidence_status: "pass".into(),
                    }],
                    selected_backend: Some("mlx".into()),
                    fallback_order: vec![],
                },
                PhaseEntry {
                    phase_name: "kv_phase".into(),
                    phase_family: "kv_cache".into(),
                    shape_key: "shape".into(),
                    dtype: "f16".into(),
                    input_contract: vec![],
                    output_contract: vec![],
                    mutation_contract: Some(KvMutationContract {
                        is_kv_phase: true,
                        allowed_operations: vec![],
                        evidence_qualification: KvEvidenceQualification::RuntimeQualified,
                    }),
                    backend_candidates: vec![BackendCandidate {
                        backend_name: "mlx".into(),
                        status: BackendStatus::Pass,
                        evidence_status: "pass".into(),
                    }],
                    selected_backend: Some("mlx".into()),
                    fallback_order: vec![],
                },
            ],
        }
    }

    #[test]
    fn test_valid_image() {
        let mut image = create_valid_image();

        let mut canonical = image.clone();
        canonical.schema_hash = "".into();
        canonical.created_at = "".into();
        canonical
            .phases
            .sort_by(|a, b| a.phase_name.cmp(&b.phase_name));
        canonical.dirty_paths_sample.sort();
        let json = serde_json::to_string(&canonical).unwrap();
        let mut hasher = sha2::Sha256::new();
        sha2::Digest::update(&mut hasher, json.as_bytes());
        image.schema_hash = format!("{:x}", hasher.finalize());

        assert!(verify_v0_image(&image, VerifierOptions::default()).is_ok());
    }

    #[test]
    fn test_missing_schema() {
        let mut image = create_valid_image();
        image.schema = "wrong_schema".into();
        assert!(verify_v0_image(&image, VerifierOptions::default()).is_err());
    }

    #[test]
    fn test_dirty_tree_fails() {
        let mut image = create_valid_image();
        image.compute_scope_dirty = true;
        assert!(verify_v0_image(&image, VerifierOptions::default()).is_err());
        assert!(
            verify_v0_image(
                &image,
                VerifierOptions {
                    override_dirty_tree: true
                }
            )
            .is_ok(),
            "Should pass with override"
        );
    }

    #[test]
    fn test_stale_evidence_path() {
        let mut image = create_valid_image();
        image
            .target_context
            .source_gate_references
            .push("/does/not/exist/surely.json".into());
        let errs = verify_v0_image(&image, VerifierOptions::default()).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| e.contains("Source gate path does not exist")));
    }

    #[test]
    fn test_duplicate_phase() {
        let mut image = create_valid_image();
        let phase = image.phases[0].clone();
        image.phases.push(phase); // duplicate
        let errs = verify_v0_image(&image, VerifierOptions::default()).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("Duplicate phase conflict")));
    }

    #[test]
    fn test_selected_backend_without_pass() {
        let mut image = create_valid_image();
        image.phases[0].backend_candidates[0].status = BackendStatus::Unsupported;
        let errs = verify_v0_image(&image, VerifierOptions::default()).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("has no passing evidence")));
    }

    #[test]
    fn test_core_ml_runtime_qualified_mismatch() {
        let mut image = create_valid_image();
        // Modify a KV phase to claim RuntimeQualified but backend only has ContractOnly
        let mut cand = image.phases[1].backend_candidates[0].clone();
        cand.status = BackendStatus::ContractOnly;
        image.phases[1].backend_candidates = vec![cand];
        let errs = verify_v0_image(&image, VerifierOptions::default()).unwrap_err();
        assert!(errs
            .iter()
            .any(|e| e.contains("claims runtime qualification but selected backend")));
    }

    #[test]
    fn test_missing_phase() {
        let mut image = create_valid_image();
        // Remove KV phase
        image.phases.remove(1);
        let errs = verify_v0_image(&image, VerifierOptions::default()).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("No KV phases found")));

        let mut image2 = create_valid_image();
        // Remove decode phase
        image2.phases.remove(0);
        let errs = verify_v0_image(&image2, VerifierOptions::default()).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("No decode phases found")));
    }
}
