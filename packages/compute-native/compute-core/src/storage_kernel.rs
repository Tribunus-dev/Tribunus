//! Storage Kernel Contract
//!
//! This module is the Rust authority facade over Tribunus storage engines.
//! It does not replace PGlite, Valkey, or DuckDB.
//! It prevents them from becoming competing sources of truth.
//!
//! PGlite/PostgreSQL is durable authority.
//! Valkey is coordination visibility.
//! DuckDB is projection.
//! The storage kernel is the contract between them.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DurableReceiptRecord {
    pub receipt_id: String,
    pub work_id: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoordinationWorkRecord {
    pub work_id: String,
    pub state: String,
    pub acked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionRecord {
    pub record_id: String,
    pub receipt_id: Option<String>,
    pub data_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StorageReconciliationViolation {
    AckWithoutReceipt(String),
    ProjectionWithoutReceipt(String),
    ProjectionClaimingAuthority(String),
    ActiveWorkWithoutVisibility(String),
}

#[async_trait]
pub trait DurableAuthorityPort: Send + Sync {
    async fn get_receipt(&self, work_id: &str) -> crate::Result<Option<DurableReceiptRecord>>;
    async fn commit_receipt(&self, record: DurableReceiptRecord) -> crate::Result<()>;
}

#[async_trait]
pub trait CoordinationPort: Send + Sync {
    async fn get_work(&self, work_id: &str) -> crate::Result<Option<CoordinationWorkRecord>>;
}

#[async_trait]
pub trait ProjectionPort: Send + Sync {
    async fn get_projection(&self, record_id: &str) -> crate::Result<Option<ProjectionRecord>>;
}

pub struct StorageReconciler<'a> {
    durable: &'a dyn DurableAuthorityPort,
    coordination: &'a dyn CoordinationPort,
    projection: &'a dyn ProjectionPort,
}

impl<'a> StorageReconciler<'a> {
    pub fn new(
        durable: &'a dyn DurableAuthorityPort,
        coordination: &'a dyn CoordinationPort,
        projection: &'a dyn ProjectionPort,
    ) -> Self {
        Self {
            durable,
            coordination,
            projection,
        }
    }

    pub async fn reconcile_work(
        &self,
        work_id: &str,
    ) -> crate::Result<Vec<StorageReconciliationViolation>> {
        let mut violations = Vec::new();
        let receipt = self.durable.get_receipt(work_id).await?;
        let coordination = self.coordination.get_work(work_id).await?;

        // Invariant: A Valkey terminal state (acked) without a PGlite receipt is a violation.
        if let Some(ref coord) = coordination {
            if coord.acked && receipt.is_none() {
                violations.push(StorageReconciliationViolation::AckWithoutReceipt(
                    work_id.to_string(),
                ));
            }
        }

        // Invariant: A PGlite active work item with no Valkey visibility requires a recovery receipt.
        // (Simplified for now: if we have a receipt but no coordination record, it's a gap in visibility)
        if receipt.is_some() && coordination.is_none() {
            violations.push(StorageReconciliationViolation::ActiveWorkWithoutVisibility(
                work_id.to_string(),
            ));
        }

        Ok(violations)
    }

    pub async fn reconcile_projection(
        &self,
        record_id: &str,
    ) -> crate::Result<Vec<StorageReconciliationViolation>> {
        let mut violations = Vec::new();
        let projection = self.projection.get_projection(record_id).await?;

        if let Some(proj) = projection {
            // Invariant: A DuckDB projection row without a durable receipt reference is a violation.
            if proj.receipt_id.is_none() {
                violations.push(StorageReconciliationViolation::ProjectionWithoutReceipt(
                    record_id.to_string(),
                ));
            }

            // Invariant: A DuckDB projection that claims authority (e.g. by having a record_id that looks like a receipt_id but isn't one)
            // (Mocking this check for now)
            if proj.record_id.starts_with("auth:") {
                violations.push(StorageReconciliationViolation::ProjectionClaimingAuthority(
                    record_id.to_string(),
                ));
            }
        }

        Ok(violations)
    }
}

pub struct MockStorageKernel {
    pub receipts: HashMap<String, DurableReceiptRecord>,
    pub work: HashMap<String, CoordinationWorkRecord>,
    pub projections: HashMap<String, ProjectionRecord>,
}

#[async_trait]
impl DurableAuthorityPort for MockStorageKernel {
    async fn get_receipt(&self, work_id: &str) -> crate::Result<Option<DurableReceiptRecord>> {
        Ok(self.receipts.get(work_id).cloned())
    }
    async fn commit_receipt(&self, _record: DurableReceiptRecord) -> crate::Result<()> {
        Ok(())
    }
}

#[async_trait]
impl CoordinationPort for MockStorageKernel {
    async fn get_work(&self, work_id: &str) -> crate::Result<Option<CoordinationWorkRecord>> {
        Ok(self.work.get(work_id).cloned())
    }
}

#[async_trait]
impl ProjectionPort for MockStorageKernel {
    async fn get_projection(&self, record_id: &str) -> crate::Result<Option<ProjectionRecord>> {
        Ok(self.projections.get(record_id).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ack_without_receipt_violation() {
        let mut kernel = MockStorageKernel {
            receipts: HashMap::new(),
            work: HashMap::new(),
            projections: HashMap::new(),
        };

        kernel.work.insert(
            "work-1".to_string(),
            CoordinationWorkRecord {
                work_id: "work-1".to_string(),
                state: "acked".to_string(),
                acked: true,
            },
        );

        let reconciler = StorageReconciler::new(&kernel, &kernel, &kernel);
        let violations = reconciler.reconcile_work("work-1").await.unwrap();
        assert!(
            violations.contains(&StorageReconciliationViolation::AckWithoutReceipt(
                "work-1".to_string()
            ))
        );
    }

    #[tokio::test]
    async fn test_projection_without_receipt_reference_violation() {
        let mut kernel = MockStorageKernel {
            receipts: HashMap::new(),
            work: HashMap::new(),
            projections: HashMap::new(),
        };

        kernel.projections.insert(
            "proj-1".to_string(),
            ProjectionRecord {
                record_id: "proj-1".to_string(),
                receipt_id: None,
                data_hash: "hash".to_string(),
            },
        );

        let reconciler = StorageReconciler::new(&kernel, &kernel, &kernel);
        let violations = reconciler.reconcile_projection("proj-1").await.unwrap();
        assert!(
            violations.contains(&StorageReconciliationViolation::ProjectionWithoutReceipt(
                "proj-1".to_string()
            ))
        );
    }

    #[tokio::test]
    async fn test_projection_claiming_authority_violation() {
        let mut kernel = MockStorageKernel {
            receipts: HashMap::new(),
            work: HashMap::new(),
            projections: HashMap::new(),
        };

        kernel.projections.insert(
            "auth:1".to_string(),
            ProjectionRecord {
                record_id: "auth:1".to_string(),
                receipt_id: Some("receipt-1".to_string()),
                data_hash: "hash".to_string(),
            },
        );

        let reconciler = StorageReconciler::new(&kernel, &kernel, &kernel);
        let violations = reconciler.reconcile_projection("auth:1").await.unwrap();
        assert!(violations.contains(
            &StorageReconciliationViolation::ProjectionClaimingAuthority("auth:1".to_string())
        ));
    }

    #[tokio::test]
    async fn test_active_work_without_visibility_requires_recovery() {
        let mut kernel = MockStorageKernel {
            receipts: HashMap::new(),
            work: HashMap::new(),
            projections: HashMap::new(),
        };

        kernel.receipts.insert(
            "work-1".to_string(),
            DurableReceiptRecord {
                receipt_id: "receipt-1".to_string(),
                work_id: "work-1".to_string(),
                timestamp: 123,
            },
        );

        let reconciler = StorageReconciler::new(&kernel, &kernel, &kernel);
        let violations = reconciler.reconcile_work("work-1").await.unwrap();
        assert!(violations.contains(
            &StorageReconciliationViolation::ActiveWorkWithoutVisibility("work-1".to_string())
        ));
    }
}
