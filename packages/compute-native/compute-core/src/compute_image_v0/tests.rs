#[cfg(test)]
mod tests {
    use crate::compute_image_v0::schema::*;
    use crate::compute_image_v0::evidence::*;
    use crate::compute_image_v0::emitter::*;
    use crate::compute_image_v0::verifier::*;

    // We rely on the internal module tests instead of this stub since we already
    // added robust tests to verifier.rs
}

#[cfg(test)]
mod missing_tests {
    use crate::compute_image_v0::schema::*;
    use crate::compute_image_v0::verifier::*;

    #[test]
    fn test_compile_only_unqualified_kv_not_selected() {
        // Build minimal valid image and inject a CompileOnly KV phase that was selected
        let mut image = ComputeImageV0 {
            schema: "tribunus.compute_image.v0".into(),
            schema_hash: "hash".into(),
            evidence_source_kind: "synthetic_fixture".into(),
            resolution_policy: ResolutionPolicy {
                policy_name: "test".into(),
                backend_preference_order: vec![],
                allow_contract_only_kv: false,
                require_runtime_qualified_kv: true,
                allow_synthetic_evidence: true,
                required_phase_set: "test".into(),
            },
            verdict: "usable".into(),
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
                backend_versions: BackendVersions { mlx: None, coreml: None, accelerate: None },
                source_gate_references: vec![],
            },
            phases: vec![
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
                        evidence_qualification: KvEvidenceQualification::CompileOnly, // The bad state
                    }),
                    backend_candidates: vec![
                        BackendCandidate { backend_name: "mlx".into(), status: BackendStatus::Pass, evidence_status: "pass".into() }
                    ],
                    selected_backend: Some("mlx".into()),
                    fallback_order: vec![],
                }
            ],
        };

        // Recompute hash so the only failure is the verification rules
        image.schema_hash = crate::compute_image_v0::canonical_hash::compute_canonical_hash(&image);
        let errs = verify_v0_image(&image, VerifierOptions::default()).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("cannot be selected for runtime execution")), "{:?}", errs);
    }
    #[test]
    fn test_unqualified_kv_not_selected() {
    let mut image = ComputeImageV0 {
        schema: "tribunus.compute_image.v0".into(),
        schema_hash: "hash".into(),
        evidence_source_kind: "synthetic_fixture".into(),
        resolution_policy: ResolutionPolicy {
            policy_name: "test".into(),
            backend_preference_order: vec![],
            allow_contract_only_kv: false,
            require_runtime_qualified_kv: true,
            allow_synthetic_evidence: true,
            required_phase_set: "test".into(),
        },
        verdict: "usable".into(),
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
            backend_versions: BackendVersions { mlx: None, coreml: None, accelerate: None },
            source_gate_references: vec![],
        },
        phases: vec![
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
                    evidence_qualification: KvEvidenceQualification::Unqualified, // The bad state
                }),
                backend_candidates: vec![
                    BackendCandidate { backend_name: "mlx".into(), status: BackendStatus::Pass, evidence_status: "pass".into() }
                ],
                selected_backend: Some("mlx".into()),
                fallback_order: vec![],
            }
        ],
    };

    // Recompute hash so the only failure is the verification rules
    image.schema_hash = crate::compute_image_v0::canonical_hash::compute_canonical_hash(&image);
    let errs = verify_v0_image(&image, VerifierOptions::default()).unwrap_err();
    assert!(errs.iter().any(|e| e.contains("cannot be selected for runtime execution")), "{:?}", errs);
}
} // End missing_tests module
