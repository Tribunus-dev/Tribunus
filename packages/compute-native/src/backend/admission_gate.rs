use tribunus_compute_core::compute_image::Manifest;
use tribunus_compute_core::compute_image_v0::tensix::{
    TensixArtifactCacheKey, TensixArtifactState,
};
use tribunus_compute_core::inference_profile::evidence::{EvidenceStatus, PhaseEvidenceReceipt};

#[derive(Debug, PartialEq)]
pub enum AdmissionResult {
    Admitted,
    Quarantined {
        reason: String,
        compiler_output: Option<String>,
        device_logs: Option<String>,
        numerical_mismatch: Option<String>,
    },
}

pub struct ArtifactAdmissionGate {
    pub conformance_policy: fn(&Manifest) -> bool,
    pub tolerance_policy: fn(&PhaseEvidenceReceipt) -> bool,
}

impl ArtifactAdmissionGate {
    pub fn new() -> Self {
        Self {
            conformance_policy: |_| true,
            tolerance_policy: |_| true,
        }
    }

    pub fn process(
        &self,
        key: &TensixArtifactCacheKey,
        manifest: &Manifest,
        receipt: &PhaseEvidenceReceipt,
        compiler_output: Option<String>,
        device_logs: Option<String>,
        numerical_mismatch: Option<String>,
    ) -> (TensixArtifactState, AdmissionResult) {
        if !(self.conformance_policy)(manifest) {
            return (
                TensixArtifactState::Quarantined,
                AdmissionResult::Quarantined {
                    reason: "failed conformance validation".to_string(),
                    compiler_output,
                    device_logs,
                    numerical_mismatch,
                },
            );
        }

        if receipt.status == EvidenceStatus::Rejected {
            return (
                TensixArtifactState::Quarantined,
                AdmissionResult::Quarantined {
                    reason: "device profiling failed".to_string(),
                    compiler_output,
                    device_logs,
                    numerical_mismatch,
                },
            );
        }

        if !(self.tolerance_policy)(receipt) {
            return (
                TensixArtifactState::Quarantined,
                AdmissionResult::Quarantined {
                    reason: "numerical tolerance check failed".to_string(),
                    compiler_output,
                    device_logs,
                    numerical_mismatch,
                },
            );
        }

        (TensixArtifactState::Admitted, AdmissionResult::Admitted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tribunus_compute_core::inference_profile::backend::BackendKind;
    use tribunus_compute_core::inference_profile::ids::{PhaseId, ProfileId, ReceiptId};
    use tribunus_compute_core::inference_profile::phase::PhaseKind;
    use tribunus_compute_core::inference_profile::serde_schema::{
        MachineProfileDigest, ModelProfileDigest,
    };

    fn dummy_receipt() -> PhaseEvidenceReceipt {
        PhaseEvidenceReceipt {
            receipt_id: ReceiptId::new_random(),
            phase_id: PhaseId::new(1, 1),
            phase_kind: PhaseKind::Decode,
            profile_id: ProfileId::new_random(),
            backend: BackendKind::MLX,
            machine_profile_digest: MachineProfileDigest::from_hex("a".repeat(64)).unwrap(),
            model_profile_digest: ModelProfileDigest::from_hex("a".repeat(64)).unwrap(),
            input_digest: "test".to_string(),
            output_digest: None,
            started_at: 0,
            finished_at: 0,
            status: EvidenceStatus::Qualified,
            metrics: Default::default(),
            artifacts: vec![],
            gate_results: vec![],
            failure: None,
            notes: None,
        }
    }

    fn dummy_manifest() -> Manifest {
        Manifest {
            version: "v1".to_string(),
            schema_version: 1,
            authoring_tool: "test".to_string(),
            creation_timestamp: 0,
            capabilities_required: vec![],
            supported_machine_profiles: vec![],
            source_model_profile: ModelProfileDigest::from_hex("a".repeat(64)).unwrap(),
            image_hash: "test".to_string(),
            segments: vec![],
            tensor_table: vec![],
            execution_plan: tribunus_compute_core::compute_image::ExecutionPlan {
                layers: vec![],
                decoding_strategy: "test".to_string(),
                vocabulary_size: 1,
                max_sequence_length: 1,
                precision_policy: "test".to_string(),
            },
        }
    }

    #[test]
    fn test_admitted_progresses() {
        let gate = ArtifactAdmissionGate::new();
        let key = TensixArtifactCacheKey {
            hash: "test".to_string(),
            shape_profile: "test".to_string(),
        };
        let manifest = dummy_manifest();
        let receipt = dummy_receipt();

        let (state, result) = gate.process(&key, &manifest, &receipt, None, None, None);
        assert_eq!(state, TensixArtifactState::Admitted);
        assert_eq!(result, AdmissionResult::Admitted);
    }

    #[test]
    fn test_quarantine_with_diagnostics() {
        let mut gate = ArtifactAdmissionGate::new();
        gate.conformance_policy = |_| false;
        let key = TensixArtifactCacheKey {
            hash: "test".to_string(),
            shape_profile: "test".to_string(),
        };
        let manifest = dummy_manifest();
        let receipt = dummy_receipt();

        let (state, result) = gate.process(
            &key,
            &manifest,
            &receipt,
            Some("compiler error".to_string()),
            Some("device error".to_string()),
            Some("mismatch".to_string()),
        );

        assert_eq!(state, TensixArtifactState::Quarantined);
        assert_eq!(
            result,
            AdmissionResult::Quarantined {
                reason: "failed conformance validation".to_string(),
                compiler_output: Some("compiler error".to_string()),
                device_logs: Some("device error".to_string()),
                numerical_mismatch: Some("mismatch".to_string()),
            }
        );
    }
}
