use super::evidence::NormalizedPhaseEvidence;
use super::schema::{
    BackendCandidate, BackendStatus, KvEvidenceQualification, KvMutationContract, PhaseEntry,
};

pub struct Resolver {
    pub allow_contract_only_kv: bool,
}

impl Resolver {
    pub fn new(allow_contract_only_kv: bool) -> Self {
        Self {
            allow_contract_only_kv,
        }
    }

    pub fn resolve_phase(&self, ev: &NormalizedPhaseEvidence) -> PhaseEntry {
        let mut candidates = Vec::new();
        for b in &ev.backend_evidence {
            candidates.push(BackendCandidate {
                backend_name: b.backend_name.clone(),
                status: b.status.clone(),
                evidence_status: b.raw_status_string.clone(),
            });
        }

        let selected_backend =
            self.select_backend(&candidates, ev.is_kv_phase, &ev.kv_qualification);

        let mut fallback_order = Vec::new();
        // MLX -> CoreML -> Accelerate is the default order for truth and debuggability.
        for preferred in &["mlx", "coreml", "accelerate"] {
            if let Some(c) = candidates.iter().find(|c| c.backend_name == *preferred) {
                if c.status == BackendStatus::Pass
                    || (ev.is_kv_phase
                        && self.allow_contract_only_kv
                        && c.status == BackendStatus::ContractOnly)
                {
                    if Some(c.backend_name.clone()) != selected_backend {
                        fallback_order.push(c.backend_name.clone());
                    }
                }
            }
        }

        let mutation_contract = if ev.is_kv_phase {
            Some(KvMutationContract {
                is_kv_phase: true,
                allowed_operations: ev.kv_allowed_operations.clone(),
                evidence_qualification: ev.kv_qualification.clone(),
            })
        } else {
            None
        };

        PhaseEntry {
            phase_name: ev.phase_name.clone(),
            phase_family: ev.phase_family.clone(),
            shape_key: ev.shape_key.clone(),
            dtype: ev.dtype.clone(),
            input_contract: ev.input_contract.clone(),
            output_contract: ev.output_contract.clone(),
            mutation_contract,
            backend_candidates: candidates,
            selected_backend,
            fallback_order,
        }
    }

    fn select_backend(
        &self,
        candidates: &[BackendCandidate],
        is_kv_phase: bool,
        kv_qualification: &KvEvidenceQualification,
    ) -> Option<String> {
        if is_kv_phase {
            if *kv_qualification == KvEvidenceQualification::ContractOnly
                && !self.allow_contract_only_kv
            {
                return None; // Blocked unless explicitly allowed
            }
        }

        // 1. MLX first if passing
        if let Some(c) = candidates.iter().find(|c| c.backend_name == "mlx") {
            if c.status == BackendStatus::Pass
                || (is_kv_phase
                    && self.allow_contract_only_kv
                    && c.status == BackendStatus::ContractOnly)
            {
                return Some("mlx".into());
            }
        }

        // 2. CoreML if fully qualified (pass)
        if let Some(c) = candidates.iter().find(|c| c.backend_name == "coreml") {
            if c.status == BackendStatus::Pass {
                return Some("coreml".into());
            }
        }

        // 3. Accelerate fallback
        if let Some(c) = candidates.iter().find(|c| c.backend_name == "accelerate") {
            if c.status == BackendStatus::Pass {
                return Some("accelerate".into());
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute_image_v0::evidence::{BackendEvidence, NormalizedPhaseEvidence};
    use crate::compute_image_v0::schema::{BackendStatus, KvEvidenceQualification};

    #[test]
    fn test_mlx_preferred() {
        let resolver = Resolver::new(false);
        let ev = NormalizedPhaseEvidence {
            phase_name: "test".into(),
            phase_family: "test".into(),
            shape_key: "test".into(),
            dtype: "test".into(),
            input_contract: vec![],
            output_contract: vec![],
            is_kv_phase: false,
            kv_allowed_operations: vec![],
            kv_qualification: KvEvidenceQualification::Unqualified,
            backend_evidence: vec![
                BackendEvidence {
                    backend_name: "coreml".into(),
                    status: BackendStatus::Pass,
                    raw_status_string: "pass".into(),
                },
                BackendEvidence {
                    backend_name: "mlx".into(),
                    status: BackendStatus::Pass,
                    raw_status_string: "pass".into(),
                },
            ],
        };

        let resolved = resolver.resolve_phase(&ev);
        assert_eq!(resolved.selected_backend, Some("mlx".into()));
        assert_eq!(resolved.fallback_order, vec!["coreml".to_string()]);
    }

    #[test]
    fn test_coreml_only_if_fully_qualified() {
        let resolver = Resolver::new(false);
        let ev = NormalizedPhaseEvidence {
            phase_name: "test".into(),
            phase_family: "test".into(),
            shape_key: "test".into(),
            dtype: "test".into(),
            input_contract: vec![],
            output_contract: vec![],
            is_kv_phase: false,
            kv_allowed_operations: vec![],
            kv_qualification: KvEvidenceQualification::Unqualified,
            backend_evidence: vec![BackendEvidence {
                backend_name: "coreml".into(),
                status: BackendStatus::CompileLimited,
                raw_status_string: "compile_limited".into(),
            }],
        };

        let resolved = resolver.resolve_phase(&ev);
        assert_eq!(resolved.selected_backend, None);
        assert_eq!(resolved.fallback_order.len(), 0);
    }
}
