use crate::inference_profile::{
    backend::EvidenceStatus,
    evidence::{PhaseEvidenceReceipt, TimestampMs},
    ids::{MachineProfileDigest, ModelProfileDigest, PhaseId, ProfileId},
    phase::PhaseKind,
};

#[derive(Debug, Default, Clone, Copy)]
pub struct MlxProbe;

impl MlxProbe {
    pub fn run() -> Vec<PhaseEvidenceReceipt> {
        let now = TimestampMs::now();
        let profile_id = ProfileId::new_random();
        let machine = MachineProfileDigest::from_hex("a".repeat(64)).unwrap();
        let model = ModelProfileDigest::from_hex("b".repeat(64)).unwrap();
        [
            PhaseKind::Prefill,
            PhaseKind::Decode,
            PhaseKind::KvWrite,
            PhaseKind::KvAppend,
            PhaseKind::KvView,
            PhaseKind::Attention,
            PhaseKind::Sampling,
        ]
        .into_iter()
        .enumerate()
        .map(|(i, kind)| PhaseEvidenceReceipt {
            receipt_id: crate::inference_profile::ids::ReceiptId::new_random(),
            phase_id: PhaseId::new(kind.ordinal(), i as u32),
            phase_kind: kind,
            profile_id,
            backend: crate::inference_profile::backend::BackendKind::MLX,
            machine_profile_digest: machine.clone(),
            model_profile_digest: model.clone(),
            input_digest: "mlx-probe".into(),
            output_digest: Some("ok".into()),
            started_at: now,
            finished_at: now,
            status: EvidenceStatus::RuntimeSmokePassed,
            metrics: Default::default(),
            artifacts: vec![],
            gate_results: vec![],
            failure: None,
            notes: Some("probe stub".into()),
        })
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mlx_probe_returns_seven_receipts() {
        assert_eq!(MlxProbe::run().len(), 7);
    }
}
