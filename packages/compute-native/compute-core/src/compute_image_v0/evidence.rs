use super::schema::{BackendStatus, KvEvidenceQualification};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedPhaseEvidence {
    pub phase_name: String,
    pub phase_family: String,
    pub shape_key: String,
    pub dtype: String,
    pub input_contract: Vec<String>,
    pub output_contract: Vec<String>,
    pub is_kv_phase: bool,
    pub kv_allowed_operations: Vec<String>,
    pub kv_qualification: KvEvidenceQualification,
    pub backend_evidence: Vec<BackendEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendEvidence {
    pub backend_name: String,
    pub status: BackendStatus,
    pub raw_status_string: String,
}

pub trait EvidenceAdapter {
    fn load_evidence(&self) -> Result<Vec<NormalizedPhaseEvidence>, String>;
}

/// A synthetic adapter for testing.
pub struct SyntheticFixtureAdapter {
    pub scenarios: Vec<NormalizedPhaseEvidence>,
}

impl EvidenceAdapter for SyntheticFixtureAdapter {
    fn load_evidence(&self) -> Result<Vec<NormalizedPhaseEvidence>, String> {
        Ok(self.scenarios.clone())
    }
}

pub fn default_synthetic_fixtures() -> Vec<NormalizedPhaseEvidence> {
    vec![
        NormalizedPhaseEvidence {
            phase_name: "matmul".into(),
            phase_family: "linear".into(),
            shape_key: "batch_1_seq_1_hidden_4096".into(),
            dtype: "f16".into(),
            input_contract: vec!["input".into(), "weight".into()],
            output_contract: vec!["output".into()],
            is_kv_phase: false,
            kv_allowed_operations: vec![],
            kv_qualification: KvEvidenceQualification::Unqualified,
            backend_evidence: vec![
                BackendEvidence {
                    backend_name: "mlx".into(),
                    status: BackendStatus::Pass,
                    raw_status_string: "pass".into(),
                },
                BackendEvidence {
                    backend_name: "coreml".into(),
                    status: BackendStatus::Pass,
                    raw_status_string: "pass".into(),
                },
                BackendEvidence {
                    backend_name: "accelerate".into(),
                    status: BackendStatus::Pass,
                    raw_status_string: "pass".into(),
                },
            ],
        },
        NormalizedPhaseEvidence {
            phase_name: "softmax_tail".into(),
            phase_family: "activation".into(),
            shape_key: "batch_1_seq_1".into(),
            dtype: "f16".into(),
            input_contract: vec!["input".into()],
            output_contract: vec!["output".into()],
            is_kv_phase: false,
            kv_allowed_operations: vec![],
            kv_qualification: KvEvidenceQualification::Unqualified,
            backend_evidence: vec![
                BackendEvidence {
                    backend_name: "mlx".into(),
                    status: BackendStatus::Pass,
                    raw_status_string: "pass".into(),
                },
                BackendEvidence {
                    backend_name: "coreml".into(),
                    status: BackendStatus::CompileLimited,
                    raw_status_string: "compile_limited".into(),
                },
            ],
        },
        NormalizedPhaseEvidence {
            phase_name: "KvAppend".into(),
            phase_family: "kv_cache".into(),
            shape_key: "batch_1_seq_1".into(),
            dtype: "f16".into(),
            input_contract: vec!["cache".into(), "new_k".into(), "new_v".into()],
            output_contract: vec!["cache_updated".into()],
            is_kv_phase: true,
            kv_allowed_operations: vec!["append".into(), "mutate".into()],
            kv_qualification: KvEvidenceQualification::ContractOnly,
            backend_evidence: vec![BackendEvidence {
                backend_name: "mlx".into(),
                status: BackendStatus::ContractOnly,
                raw_status_string: "contract_only".into(),
            }],
        },
    ]
}
