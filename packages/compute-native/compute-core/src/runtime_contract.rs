//! Runtime Contract
//!
//! This module defines the schemas and policies for Tribunus compute work.
//! It establishes the boundaries for what can be receipted and what requires
//! authority validation.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendTarget {
    Mlx,
    Coreml,
    Accelerate,
    Reference,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityMode {
    Authority,
    Provisional,
    Fallback,
    Research,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetClass {
    Interactive,
    Background,
    Batch,
    Research,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CopyPolicy {
    ZeroCopy,
    MetadataOnlyView,
    LayoutReinterpret,
    LayoutTransformCopy,
    HostMaterializationCopy,
    FrameworkForcedCopy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScratchPolicy {
    None,
    PhaseLocalOnly,
    ReceiptedPrivateScratch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommitPolicy {
    DirectWriteback,
    RingBufferWritebackCopy,
    ReceiptOnly,
    ResearchOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewKind {
    IosurfaceDirectView,
    MappedHostView,
    CpuRingBufferView,
    FrameworkCopiedView,
    OpaquePrivateView,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessMode {
    Read,
    Write,
    ReadWrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub backoff_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackendView {
    pub view_id: String,
    pub tensor_id: String,
    pub view_kind: ViewKind,
    pub access_mode: AccessMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeWorkItem {
    pub schema: String,
    pub schema_version: String,
    pub work_id: String,
    pub run_id: String,
    pub phase_id: String,
    pub canonical_phase: Option<String>,
    pub backend_target: BackendTarget,
    pub island_id: String,
    pub input_tensor_ids: Vec<String>,
    pub output_tensor_ids: Vec<String>,
    pub authority_mode: AuthorityMode,
    pub deadline: String,
    pub budget_class: BudgetClass,
    pub retry_policy: RetryPolicy,
    pub expected_receipts: Vec<String>,
    pub receipt_before_ack: bool,
}

impl RuntimeWorkItem {
    pub fn receipt_before_ack_guard(&self) -> crate::Result<()> {
        if self.receipt_before_ack {
            Ok(())
        } else {
            Err(crate::Error::from_reason(
                "receipt_before_ack must be true for authoritative runtime work",
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhaseScope {
    pub schema: String,
    pub schema_version: String,
    pub phase_scope_id: String,
    pub run_id: String,
    pub phase_id: String,
    pub backend_target: BackendTarget,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub backend_views: Vec<BackendView>,
    pub scratch_policy: ScratchPolicy,
    pub copy_policy: CopyPolicy,
    pub sync_policy: SyncPolicy,
    pub commit_policy: CommitPolicy,
    pub required_receipts: Vec<String>,
    pub authority_mode: AuthorityMode,
    pub golden_path_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncPolicy {
    pub sync_before: bool,
    pub sync_after: bool,
    pub hash_required: bool,
}

impl PhaseScope {
    pub fn authority_guard(&self) -> crate::Result<()> {
        if matches!(self.authority_mode, AuthorityMode::Authority) && self.golden_path_id.is_none()
        {
            return Err(crate::Error::from_reason(
                "authority MLX phase scopes require golden_path_id",
            ));
        }
        if matches!(self.copy_policy, CopyPolicy::FrameworkForcedCopy)
            && matches!(self.authority_mode, AuthorityMode::Authority)
        {
            return Err(crate::Error::from_reason(
                "unknown or forced copies are not authority-eligible",
            ));
        }
        if matches!(self.commit_policy, CommitPolicy::ReceiptOnly)
            && matches!(self.authority_mode, AuthorityMode::Authority)
        {
            return Err(crate::Error::from_reason(
                "authority phase scopes require a real commit policy",
            ));
        }
        Ok(())
    }

    pub fn scratch_can_be_committed_directly(&self) -> bool {
        matches!(self.scratch_policy, ScratchPolicy::None)
            && matches!(self.commit_policy, CommitPolicy::DirectWriteback)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_runtime_work_item() -> RuntimeWorkItem {
        RuntimeWorkItem {
            schema: "tribunus.runtime_work_item.v1".into(),
            schema_version: "v1".into(),
            work_id: "work_001".into(),
            run_id: "run_001".into(),
            phase_id: "phase_001".into(),
            canonical_phase: Some("qkv_projection".into()),
            backend_target: BackendTarget::Mlx,
            island_id: "island_001".into(),
            input_tensor_ids: vec!["tensor_a".into(), "tensor_b".into()],
            output_tensor_ids: vec!["tensor_c".into()],
            authority_mode: AuthorityMode::Authority,
            deadline: "2026-06-14T12:00:00Z".into(),
            budget_class: BudgetClass::Interactive,
            retry_policy: RetryPolicy {
                max_retries: 2,
                backoff_ms: 250,
            },
            expected_receipts: vec![
                "durable_authority_receipt".into(),
                "work_item_receipt".into(),
            ],
            receipt_before_ack: true,
        }
    }

    fn sample_phase_scope() -> PhaseScope {
        PhaseScope {
            schema: "tribunus.phase_scope.v1".into(),
            schema_version: "v1".into(),
            phase_scope_id: "scope_001".into(),
            run_id: "run_001".into(),
            phase_id: "phase_001".into(),
            backend_target: BackendTarget::Mlx,
            inputs: vec!["tensor_a".into(), "tensor_b".into()],
            outputs: vec!["tensor_c".into()],
            backend_views: vec![BackendView {
                view_id: "view_001".into(),
                tensor_id: "tensor_a".into(),
                view_kind: ViewKind::MappedHostView,
                access_mode: AccessMode::ReadWrite,
            }],
            scratch_policy: ScratchPolicy::PhaseLocalOnly,
            copy_policy: CopyPolicy::LayoutReinterpret,
            sync_policy: SyncPolicy {
                sync_before: true,
                sync_after: true,
                hash_required: true,
            },
            commit_policy: CommitPolicy::DirectWriteback,
            required_receipts: vec!["phase_open_receipt".into(), "phase_commit_receipt".into()],
            authority_mode: AuthorityMode::Authority,
            golden_path_id: Some("mlx:qkv_projection:v1".into()),
        }
    }

    #[test]
    fn runtime_work_item_roundtrip() {
        let item = sample_runtime_work_item();
        let json = serde_json::to_string(&item).expect("serialize");
        let parsed: RuntimeWorkItem = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(item, parsed);
        assert!(parsed.receipt_before_ack_guard().is_ok());
    }

    #[test]
    fn phase_scope_roundtrip() {
        let scope = sample_phase_scope();
        let json = serde_json::to_string(&scope).expect("serialize");
        let parsed: PhaseScope = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(scope, parsed);
        assert!(parsed.authority_guard().is_ok());
        assert!(!parsed.scratch_can_be_committed_directly());
    }

    #[test]
    fn authority_mode_validation_blocks_forbidden_states() {
        let mut scope = sample_phase_scope();
        scope.authority_mode = AuthorityMode::Authority;
        scope.golden_path_id = None;
        assert!(scope.authority_guard().is_err());

        let mut work_item = sample_runtime_work_item();
        work_item.receipt_before_ack = false;
        assert!(work_item.receipt_before_ack_guard().is_err());
    }

    #[test]
    fn schema_drift_guard_matches_expected_shape() {
        let work_item = sample_runtime_work_item();
        let value = serde_json::to_value(&work_item).expect("serialize");
        let keys = value
            .as_object()
            .expect("object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(
            keys,
            vec![
                "authority_mode",
                "backend_target",
                "budget_class",
                "canonical_phase",
                "deadline",
                "expected_receipts",
                "input_tensor_ids",
                "island_id",
                "output_tensor_ids",
                "phase_id",
                "receipt_before_ack",
                "retry_policy",
                "run_id",
                "schema",
                "schema_version",
                "work_id",
            ]
        );

        let scope = sample_phase_scope();
        let value = serde_json::to_value(&scope).expect("serialize");
        let keys = value
            .as_object()
            .expect("object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(
            keys,
            vec![
                "authority_mode",
                "backend_target",
                "backend_views",
                "commit_policy",
                "copy_policy",
                "golden_path_id",
                "inputs",
                "outputs",
                "phase_id",
                "phase_scope_id",
                "required_receipts",
                "run_id",
                "schema",
                "schema_version",
                "scratch_policy",
                "sync_policy",
            ]
        );
    }

    #[test]
    fn copy_and_scratch_guards_reject_authority_misuse() {
        let mut scope = sample_phase_scope();
        scope.copy_policy = CopyPolicy::FrameworkForcedCopy;
        assert!(scope.authority_guard().is_err());

        scope.copy_policy = CopyPolicy::ZeroCopy;
        scope.scratch_policy = ScratchPolicy::None;
        scope.commit_policy = CommitPolicy::DirectWriteback;
        assert!(scope.scratch_can_be_committed_directly());
    }
}
