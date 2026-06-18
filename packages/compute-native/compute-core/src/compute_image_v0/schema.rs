use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputeImageV0 {
    pub schema: String, // "tribunus.compute_image.v0"
    pub schema_hash: String,
    pub created_at: String,
    pub run_id: String,
    pub git_commit: String,
    pub compute_scope_dirty: bool,
    pub dirty_paths_sample: Vec<String>,
    pub evidence_root: String,
    pub target_context: TargetContext,
    pub phases: Vec<PhaseEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TargetContext {
    pub repository_provenance: String,
    pub device_profile: String,
    pub model_profile: String,
    pub shape_profile: String,
    pub dtype: String,
    pub compute_policy: String,
    pub backend_versions: BackendVersions,
    pub source_gate_references: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackendVersions {
    pub mlx: Option<String>,
    pub coreml: Option<String>,
    pub accelerate: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhaseEntry {
    pub phase_name: String,
    pub phase_family: String,
    pub shape_key: String,
    pub dtype: String,
    pub input_contract: Vec<String>,
    pub output_contract: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_contract: Option<KvMutationContract>,
    pub backend_candidates: Vec<BackendCandidate>,
    pub selected_backend: Option<String>,
    pub fallback_order: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KvMutationContract {
    pub is_kv_phase: bool,
    pub allowed_operations: Vec<String>, // mutate, append, view, alias, copy
    pub evidence_qualification: KvEvidenceQualification,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KvEvidenceQualification {
    RuntimeQualified,
    ContractOnly,
    CompileOnly,
    Unqualified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackendCandidate {
    pub backend_name: String,
    pub status: BackendStatus,
    pub evidence_status: String, // Maps to backend-specific detailed status
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendStatus {
    Pass,
    NumericalDivergence,
    CompileLimited,
    LoadFailed,
    PredictFailed,
    Unsupported,
    NotEvaluated,
    ContractOnly,
}
