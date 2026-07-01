//! Runtime Orchestration
//!
//! This module handles the coordination of work items across the lifecycle.
//! It enforces the invariant that an acknowledgment (ack) cannot occur
//! without a durable receipt from the storage authority.

use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::runtime_contract::{PhaseScope, RuntimeWorkItem};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CoordinationState {
    Admitted,
    Claimed,
    PhaseOpened,
    BackendProvisional,
    ReceiptCommitted,
    AckEligible,
    Acked,
    ReclaimCandidate,
    DeadLetter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeReceipt {
    pub work_id: String,
    pub phase_scope_id: String,
    pub durable: bool,
    pub backend_executed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeOrchestrationRecord {
    pub work_item: RuntimeWorkItem,
    pub phase_scope: Option<PhaseScope>,
    pub state: CoordinationState,
    pub receipt: Option<RuntimeReceipt>,
}

#[async_trait]
pub trait CoordinationFabric {
    async fn admit(
        &mut self,
        work_item: RuntimeWorkItem,
    ) -> crate::Result<RuntimeOrchestrationRecord>;
    async fn claim(&mut self, work_id: &str) -> crate::Result<RuntimeOrchestrationRecord>;
    async fn heartbeat(&mut self, work_id: &str) -> crate::Result<()>;
    async fn ack(&mut self, work_id: &str) -> crate::Result<()>;
    async fn reclaim_candidates(&self) -> Vec<String>;
    async fn dead_letter(&mut self, work_id: &str) -> crate::Result<RuntimeOrchestrationRecord>;
}

#[derive(Debug, Default)]
pub struct InMemoryCoordinationFabric {
    records: HashMap<String, RuntimeOrchestrationRecord>,
    heartbeats: HashSet<String>,
}

impl InMemoryCoordinationFabric {
    fn open_phase_scope(work_item: &RuntimeWorkItem) -> PhaseScope {
        PhaseScope {
            schema: "tribunus.phase_scope.v1".into(),
            schema_version: "v1".into(),
            phase_scope_id: format!("scope:{}", work_item.work_id),
            run_id: work_item.run_id.clone(),
            phase_id: work_item.phase_id.clone(),
            backend_target: work_item.backend_target.clone(),
            inputs: work_item.input_tensor_ids.clone(),
            outputs: work_item.output_tensor_ids.clone(),
            backend_views: Vec::new(),
            scratch_policy: crate::runtime_contract::ScratchPolicy::PhaseLocalOnly,
            copy_policy: crate::runtime_contract::CopyPolicy::MetadataOnlyView,
            sync_policy: crate::runtime_contract::SyncPolicy {
                sync_before: true,
                sync_after: true,
                hash_required: true,
            },
            commit_policy: crate::runtime_contract::CommitPolicy::DirectWriteback,
            required_receipts: work_item.expected_receipts.clone(),
            authority_mode: work_item.authority_mode.clone(),
            golden_path_id: work_item.canonical_phase.clone(),
        }
    }

    fn receipt_for(work_item: &RuntimeWorkItem, phase_scope: &PhaseScope) -> RuntimeReceipt {
        RuntimeReceipt {
            work_id: work_item.work_id.clone(),
            phase_scope_id: phase_scope.phase_scope_id.clone(),
            durable: true,
            backend_executed: true,
        }
    }

    pub fn record(&self, work_id: &str) -> Option<&RuntimeOrchestrationRecord> {
        self.records.get(work_id)
    }
}

#[async_trait]
impl CoordinationFabric for InMemoryCoordinationFabric {
    async fn admit(
        &mut self,
        work_item: RuntimeWorkItem,
    ) -> crate::Result<RuntimeOrchestrationRecord> {
        work_item.receipt_before_ack_guard()?;
        let phase_scope = Self::open_phase_scope(&work_item);
        phase_scope.authority_guard()?;
        let record = RuntimeOrchestrationRecord {
            work_item: work_item.clone(),
            phase_scope: Some(phase_scope),
            state: CoordinationState::Admitted,
            receipt: None,
        };
        self.records
            .insert(work_item.work_id.clone(), record.clone());
        Ok(record)
    }

    async fn claim(&mut self, work_id: &str) -> crate::Result<RuntimeOrchestrationRecord> {
        let record = self
            .records
            .get_mut(work_id)
            .ok_or_else(|| crate::Error::from_reason("work item not admitted"))?;
        if matches!(record.state, CoordinationState::DeadLetter) {
            return Err(crate::Error::from_reason(
                "dead-lettered work cannot be claimed",
            ));
        }
        record.state = CoordinationState::Claimed;
        Ok(record.clone())
    }

    async fn heartbeat(&mut self, work_id: &str) -> crate::Result<()> {
        if self.records.contains_key(work_id) {
            self.heartbeats.insert(work_id.to_string());
            Ok(())
        } else {
            Err(crate::Error::from_reason("work item not admitted"))
        }
    }

    async fn ack(&mut self, work_id: &str) -> crate::Result<()> {
        let record = self
            .records
            .get_mut(work_id)
            .ok_or_else(|| crate::Error::from_reason("work item not admitted"))?;
        if !matches!(
            record.state,
            CoordinationState::ReceiptCommitted | CoordinationState::AckEligible
        ) {
            return Err(crate::Error::from_reason(
                "receipt must be committed before ack is eligible",
            ));
        }
        record.state = CoordinationState::Acked;
        Ok(())
    }

    async fn reclaim_candidates(&self) -> Vec<String> {
        self.records
            .iter()
            .filter(|(work_id, record)| {
                !self.heartbeats.contains(work_id.as_str())
                    && !matches!(
                        record.state,
                        CoordinationState::Acked | CoordinationState::DeadLetter
                    )
            })
            .map(|(work_id, _)| work_id.clone())
            .collect()
    }

    async fn dead_letter(&mut self, work_id: &str) -> crate::Result<RuntimeOrchestrationRecord> {
        let record = self
            .records
            .get_mut(work_id)
            .ok_or_else(|| crate::Error::from_reason("work item not admitted"))?;
        record.state = CoordinationState::DeadLetter;
        Ok(record.clone())
    }
}

impl InMemoryCoordinationFabric {
    pub async fn execute_backend(
        &mut self,
        work_id: &str,
    ) -> crate::Result<RuntimeOrchestrationRecord> {
        let record = self
            .records
            .get_mut(work_id)
            .ok_or_else(|| crate::Error::from_reason("work item not admitted"))?;
        if !matches!(
            record.state,
            CoordinationState::Claimed | CoordinationState::PhaseOpened
        ) {
            return Err(crate::Error::from_reason(
                "backend execution requires a claimed or opened phase",
            ));
        }
        record.state = CoordinationState::BackendProvisional;
        Ok(record.clone())
    }

    pub async fn commit_receipt(
        &mut self,
        work_id: &str,
    ) -> crate::Result<RuntimeOrchestrationRecord> {
        let record = self
            .records
            .get_mut(work_id)
            .ok_or_else(|| crate::Error::from_reason("work item not admitted"))?;
        let phase_scope = record
            .phase_scope
            .clone()
            .ok_or_else(|| crate::Error::from_reason("phase scope missing"))?;
        let receipt = Self::receipt_for(&record.work_item, &phase_scope);
        record.receipt = Some(receipt);
        record.state = CoordinationState::ReceiptCommitted;
        Ok(record.clone())
    }

    pub async fn open_phase(&mut self, work_id: &str) -> crate::Result<RuntimeOrchestrationRecord> {
        let record = self
            .records
            .get_mut(work_id)
            .ok_or_else(|| crate::Error::from_reason("work item not admitted"))?;
        if record.phase_scope.is_none() {
            return Err(crate::Error::from_reason("phase scope missing"));
        }
        record.state = CoordinationState::PhaseOpened;
        Ok(record.clone())
    }

    pub async fn mark_ack_eligible(
        &mut self,
        work_id: &str,
    ) -> crate::Result<RuntimeOrchestrationRecord> {
        let record = self
            .records
            .get_mut(work_id)
            .ok_or_else(|| crate::Error::from_reason("work item not admitted"))?;
        if record.receipt.is_none() {
            return Err(crate::Error::from_reason(
                "ack eligibility requires a durable receipt",
            ));
        }
        record.state = CoordinationState::AckEligible;
        Ok(record.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_contract::{AuthorityMode, BackendTarget, BudgetClass, RetryPolicy};

    fn sample_work_item() -> RuntimeWorkItem {
        RuntimeWorkItem {
            schema: "tribunus.runtime_work_item.v1".into(),
            schema_version: "v1".into(),
            work_id: "work_001".into(),
            run_id: "run_001".into(),
            phase_id: "phase_001".into(),
            canonical_phase: Some("qkv_projection".into()),
            backend_target: BackendTarget::Mlx,
            island_id: "island_001".into(),
            input_tensor_ids: vec!["tensor_a".into()],
            output_tensor_ids: vec!["tensor_b".into()],
            authority_mode: AuthorityMode::Authority,
            deadline: "2026-06-14T12:00:00Z".into(),
            budget_class: BudgetClass::Interactive,
            retry_policy: RetryPolicy {
                max_retries: 1,
                backoff_ms: 100,
            },
            expected_receipts: vec!["receipt_001".into()],
            receipt_before_ack: true,
        }
    }

    #[tokio::test]
    async fn admit_open_and_commit_enable_ack() {
        let mut fabric = InMemoryCoordinationFabric::default();
        let admitted = fabric.admit(sample_work_item()).await.expect("admit");
        assert!(matches!(admitted.state, CoordinationState::Admitted));

        let opened = fabric.open_phase("work_001").await.expect("open");
        assert!(matches!(opened.state, CoordinationState::PhaseOpened));

        let provisional = fabric.execute_backend("work_001").await.expect("backend");
        assert!(matches!(
            provisional.state,
            CoordinationState::BackendProvisional
        ));

        assert!(fabric.ack("work_001").await.is_err());

        let committed = fabric.commit_receipt("work_001").await.expect("commit");
        assert!(matches!(
            committed.state,
            CoordinationState::ReceiptCommitted
        ));

        let eligible = fabric
            .mark_ack_eligible("work_001")
            .await
            .expect("eligible");
        assert!(matches!(eligible.state, CoordinationState::AckEligible));

        fabric.ack("work_001").await.expect("ack");
        assert!(matches!(
            fabric.record("work_001").unwrap().state,
            CoordinationState::Acked
        ));
    }

    #[tokio::test]
    async fn reclaim_and_dead_letter_do_not_create_durable_authority() {
        let mut fabric = InMemoryCoordinationFabric::default();
        fabric.admit(sample_work_item()).await.expect("admit");

        let candidates = fabric.reclaim_candidates().await;
        assert_eq!(candidates, vec!["work_001".to_string()]);

        let dead = fabric.dead_letter("work_001").await.expect("dead letter");
        assert!(matches!(dead.state, CoordinationState::DeadLetter));
        assert!(dead.receipt.is_none());
        assert!(fabric.ack("work_001").await.is_err());
    }

    #[tokio::test]
    async fn ack_is_rejected_before_durable_receipt_commit() {
        let mut fabric = InMemoryCoordinationFabric::default();
        fabric.admit(sample_work_item()).await.expect("admit");
        fabric.open_phase("work_001").await.expect("open");
        fabric.execute_backend("work_001").await.expect("backend");
        let err = fabric.ack("work_001").await.expect_err("ack must fail");
        assert!(format!("{err}").contains("receipt must be committed"));
    }
}
