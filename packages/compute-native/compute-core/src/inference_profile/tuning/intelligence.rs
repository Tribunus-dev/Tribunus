use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::inference_profile::evidence::{EvidenceArtifactRef, TimestampMs};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenericEvalKind {
    InstructionFollowing,
    CodeEditAccuracy,
    ToolCallArgumentValidity,
    JsonSchemaValidity,
    RetrievalGroundedAnswering,
    LongContextRecall,
    SummarizationFaithfulness,
    RefusalSafetyBehavior,
    MultilingualConsistency,
    ReasoningStability,
    DeterministicReplayUnderFixedSeed,
    CustomRegression,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TribunusNativeEvalKind {
    MissionPacketToTaskList,
    BackendFailureReceiptClassification,
    SafeFallbackPlanGeneration,
    AuthorityBoundaryCompliance,
    CodeReviewBundleSummarization,
    StructuredArtifactEmission,
    PhaseGraphInstructionFollowing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IntelligenceBenchmarkKind {
    Generic {
        eval: GenericEvalKind,
        custom_tag: Option<String>,
    },
    TribunusNative {
        eval: TribunusNativeEvalKind,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntelligenceBenchmarkSpec {
    pub spec_id: String,
    pub benchmark_kind: IntelligenceBenchmarkKind,
    pub prompt_template: Option<String>,
    pub expected_schema: Option<serde_json::Value>,
    pub scoring_rubric: String,
    pub repetitions: u32,
    pub fixed_seed: Option<u64>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntelligenceBenchmarkReceipt {
    pub receipt_id: String,
    pub spec_id: String,
    pub started_at: TimestampMs,
    pub finished_at: TimestampMs,
    pub score: f64,
    pub score_breakdown: HashMap<String, f64>,
    pub passed_hard_gate: bool,
    pub comparison_delta: Option<f64>,
    pub determinism_verified: Option<bool>,
    pub eval_evidence: Vec<EvidenceArtifactRef>,
    pub notes: Option<String>,
}
