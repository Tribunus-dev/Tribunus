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

fn create_mock_evidence(name: &str, family: &str) -> NormalizedPhaseEvidence {
    NormalizedPhaseEvidence {
        phase_name: name.into(),
        phase_family: family.into(),
        shape_key: "batch_1_seq_1_hidden_4096".into(),
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
        ],
    }
}

pub fn default_synthetic_fixtures() -> Vec<NormalizedPhaseEvidence> {
    let mut fixtures = vec![
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
            backend_evidence: vec![
                BackendEvidence {
                    backend_name: "mlx".into(),
                    status: BackendStatus::ContractOnly,
                    raw_status_string: "contract_only".into(),
                },
            ],
        },
        NormalizedPhaseEvidence {
            phase_name: "KvWrite".into(),
            phase_family: "kv_cache".into(),
            shape_key: "batch_1_seq_1".into(),
            dtype: "f16".into(),
            input_contract: vec!["cache".into(), "k".into(), "v".into()],
            output_contract: vec!["cache_updated".into()],
            is_kv_phase: true,
            kv_allowed_operations: vec!["mutate".into()],
            kv_qualification: KvEvidenceQualification::RuntimeQualified,
            backend_evidence: vec![
                BackendEvidence {
                    backend_name: "mlx".into(),
                    status: BackendStatus::Pass,
                    raw_status_string: "pass".into(),
                },
            ],
        },
        NormalizedPhaseEvidence {
            phase_name: "KvView".into(),
            phase_family: "kv_cache".into(),
            shape_key: "batch_1_seq_1".into(),
            dtype: "f16".into(),
            input_contract: vec!["cache".into()],
            output_contract: vec!["view".into()],
            is_kv_phase: true,
            kv_allowed_operations: vec!["view".into()],
            kv_qualification: KvEvidenceQualification::RuntimeQualified,
            backend_evidence: vec![
                BackendEvidence {
                    backend_name: "mlx".into(),
                    status: BackendStatus::Pass,
                    raw_status_string: "pass".into(),
                },
            ],
        },
    ];

    let other_phases = vec![
        "reshape_transpose_matmul", "branch_rejoin",
        "silu_or_composite", "identity_passthrough", "constant_heavy",
        "multi_output",
    ];

    for name in other_phases {
        fixtures.push(create_mock_evidence(name, "misc"));
    }

    fixtures
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedJsonEvidenceWrapper {
    pub schema: String,
    pub evidence_source_kind: String,
    pub source_gate_references: Option<Vec<String>>,
    pub phases: Vec<NormalizedPhaseEvidence>,
}

pub struct NormalizedJsonAdapter {
    pub filepath: String,
}

impl EvidenceAdapter for NormalizedJsonAdapter {
    fn load_evidence(&self) -> Result<Vec<NormalizedPhaseEvidence>, String> {
        let json_str = std::fs::read_to_string(&self.filepath).map_err(|e| format!("read file {}: {}", self.filepath, e))?;
        let wrapper: NormalizedJsonEvidenceWrapper = serde_json::from_str(&json_str).map_err(|e| format!("parse JSON from {}: {}", self.filepath, e))?;
        Ok(wrapper.phases)
    }
}
