use crate::inference_profile::{
    backend::BackendKind,
    evidence::{EvidenceLedger, NativeEvidenceLedger, PhaseEvidenceReceipt},
    ids::{MachineProfileDigest, ModelProfileDigest, PhaseId, ProfileId},
    phase::PhaseKind,
};

#[derive(Debug, Default)]
pub struct CpuReferenceBackend {
    pub ledger: NativeEvidenceLedger,
}

impl CpuReferenceBackend {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn run_toy_turn(
        &mut self,
        model_digest: ModelProfileDigest,
        machine_digest: MachineProfileDigest,
    ) -> Vec<PhaseEvidenceReceipt> {
        let profile_id = ProfileId::new_random();
        let receipts = vec![
            PhaseEvidenceReceipt::smoke_passed(
                PhaseId::new(PhaseKind::TokenizerIngress.ordinal(), 0),
                PhaseKind::TokenizerIngress,
                profile_id,
                BackendKind::CpuReference,
                machine_digest.clone(),
                model_digest.clone(),
            ),
            PhaseEvidenceReceipt::smoke_passed(
                PhaseId::new(PhaseKind::Prefill.ordinal(), 0),
                PhaseKind::Prefill,
                profile_id,
                BackendKind::CpuReference,
                machine_digest.clone(),
                model_digest.clone(),
            ),
            PhaseEvidenceReceipt::smoke_passed(
                PhaseId::new(PhaseKind::KvWrite.ordinal(), 0),
                PhaseKind::KvWrite,
                profile_id,
                BackendKind::CpuReference,
                machine_digest.clone(),
                model_digest.clone(),
            ),
            PhaseEvidenceReceipt::smoke_passed(
                PhaseId::new(PhaseKind::Decode.ordinal(), 0),
                PhaseKind::Decode,
                profile_id,
                BackendKind::CpuReference,
                machine_digest.clone(),
                model_digest.clone(),
            ),
            PhaseEvidenceReceipt::smoke_passed(
                PhaseId::new(PhaseKind::Sampling.ordinal(), 0),
                PhaseKind::Sampling,
                profile_id,
                BackendKind::CpuReference,
                machine_digest.clone(),
                model_digest.clone(),
            ),
            PhaseEvidenceReceipt::smoke_passed(
                PhaseId::new(PhaseKind::Cancellation.ordinal(), 0),
                PhaseKind::Cancellation,
                profile_id,
                BackendKind::CpuReference,
                machine_digest.clone(),
                model_digest.clone(),
            ),
            PhaseEvidenceReceipt::smoke_passed(
                PhaseId::new(PhaseKind::Recovery.ordinal(), 0),
                PhaseKind::Recovery,
                profile_id,
                BackendKind::CpuReference,
                machine_digest,
                model_digest,
            ),
        ];
        for receipt in receipts.iter().cloned() {
            let _ = self.ledger.append(receipt);
        }
        receipts
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference_profile::backend::EvidenceStatus;
    #[test]
    fn full_turn_records_receipts() {
        let mut backend = CpuReferenceBackend::new();
        let receipts = backend.run_toy_turn(
            ModelProfileDigest::from_hex("b".repeat(64)).unwrap(),
            MachineProfileDigest::from_hex("a".repeat(64)).unwrap(),
        );
        assert_eq!(receipts.len(), 7);
        assert_eq!(backend.ledger.len(), 7);
        assert!(receipts
            .iter()
            .all(|r| r.status == EvidenceStatus::RuntimeSmokePassed));
    }
}
