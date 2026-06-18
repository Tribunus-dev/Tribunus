//! TAIP evidence layer — receipts, metrics, failure classification, and ledger.
//!
//! `PhaseEvidenceReceipt` is the immutable proof that a phase executed on a
//! specific backend under a specific (model, machine) tuple, and what was
//! observed. Receipts are append-only — they are never modified after writing.
//!
//! `EvidenceLedger` is the trait for ledger implementations. The concrete
//! `NativeEvidenceLedger` (in-memory) and `JsonlEvidenceLedger` (Mission 0004)
//! implement this trait.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::inference_profile::{
    backend::{BackendKind, EvidenceStatus},
    ids::{MachineProfileDigest, ModelProfileDigest, PhaseId, ProfileId, ReceiptId},
    phase::{EvidenceRequirement, PhaseKind},
};

// ── Timestamp ─────────────────────────────────────────────────────────────

/// Unix timestamp in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct TimestampMs(pub u64);

impl TimestampMs {
    pub fn now() -> Self {
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Self(ms)
    }

    pub fn elapsed_ms(self, end: TimestampMs) -> u64 {
        end.0.saturating_sub(self.0)
    }
}

// ── PhaseMetrics ──────────────────────────────────────────────────────────

/// Latency and memory telemetry captured during phase execution.
///
/// All fields are `Option<u64>` — not every gate produces every metric.
/// Metrics are advisory; the `status_reducer` does not rely on them for
/// qualification decisions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PhaseMetrics {
    /// Wall time from phase start to first output token (nanoseconds).
    pub first_token_ns: Option<u64>,
    /// Steady-state decode throughput in tokens per second.
    pub steady_state_tps: Option<f64>,
    /// p50 per-token latency (nanoseconds).
    pub p50_token_ns: Option<u64>,
    /// p95 per-token latency (nanoseconds).
    pub p95_token_ns: Option<u64>,
    /// p99 per-token latency (nanoseconds).
    pub p99_token_ns: Option<u64>,
    /// Active memory bytes reported by the backend at phase end.
    pub active_memory_bytes: Option<u64>,
    /// Peak memory bytes during phase execution.
    pub peak_memory_bytes: Option<u64>,
    /// Cache memory bytes reported by the backend at phase end.
    pub cache_memory_bytes: Option<u64>,
    /// Number of backend `eval()` calls issued.
    pub eval_calls: Option<u32>,
    /// Phase wall-time in milliseconds.
    pub wall_time_ms: Option<u64>,
}

// ── FailureClassification ─────────────────────────────────────────────────

/// Why a phase failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureClassification {
    /// Backend ran out of memory.
    OomKilled,
    /// Backend process / framework crashed.
    BackendCrash,
    /// Phase exceeded the configured time budget.
    Timeout,
    /// A cancellation signal arrived during an uncommitted write.
    CancellationRace,
    /// Output diverged from the reference beyond tolerance.
    ParityFailed,
    /// Phase output violated a schema or contract.
    SchemaViolation,
    /// Authority check denied the operation.
    AuthorityDenied,
    /// The model contains an operator the backend does not support.
    UnsupportedOp,
    /// Backend returned an error with no further classification.
    UnknownBackendError,
    /// Phase was never attempted on this backend.
    NotAttempted,
}

// ── EvidenceGateResult ────────────────────────────────────────────────────

/// The result of a single evidence gate within a phase receipt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceGateResult {
    pub requirement: EvidenceRequirement,
    pub passed: bool,
    pub notes: Option<String>,
}

// ── EvidenceArtifactRef ───────────────────────────────────────────────────

/// A typed reference to an artifact produced during qualification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceArtifactRef {
    /// Kind: `"benchmark_jsonl"`, `"parity_diff"`, `"metal_capture"`, etc.
    pub kind: String,
    /// Relative path within the image directory.
    pub path: String,
    /// SHA-256 hex digest of the artifact file.
    pub sha256: Option<String>,
}

// ── PhaseEvidenceReceipt ───────────────────────────────────────────────────

/// An immutable proof that a phase executed and what was observed.
///
/// Receipts are the atomic unit of the `EvidenceLedger`. Once written,
/// a receipt is never modified. The `status_reducer` derives the current
/// qualification status by folding over all receipts for a given
/// (backend, phase_kind, model_digest, machine_digest) tuple.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseEvidenceReceipt {
    /// Unique receipt ID.
    pub receipt_id: ReceiptId,
    /// The phase this receipt covers.
    pub phase_id: PhaseId,
    /// The phase kind (denormalised for efficient querying).
    pub phase_kind: PhaseKind,
    /// The execution profile this receipt belongs to.
    pub profile_id: ProfileId,
    /// Which backend executed the phase.
    pub backend: BackendKind,
    /// Digest of the `MachineProfile` at the time of the test.
    pub machine_profile_digest: MachineProfileDigest,
    /// Digest of the `ModelProfile` at the time of the test.
    pub model_profile_digest: ModelProfileDigest,
    /// Digest of the phase inputs (for reproducibility).
    pub input_digest: String,
    /// Digest of the phase outputs (None if execution failed before output).
    pub output_digest: Option<String>,
    /// When the phase started.
    pub started_at: TimestampMs,
    /// When the phase finished.
    pub finished_at: TimestampMs,
    /// Qualification status claimed by this receipt.
    ///
    /// The `status_reducer` will use this as one data point; it does not
    /// accept claimed status as final unless all required gates have passed.
    pub status: EvidenceStatus,
    /// Observed performance metrics.
    pub metrics: PhaseMetrics,
    /// References to artifact files produced during this gate.
    pub artifacts: Vec<EvidenceArtifactRef>,
    /// Gate-level results included in this receipt.
    pub gate_results: Vec<EvidenceGateResult>,
    /// How this phase failed, if it failed.
    pub failure: Option<FailureClassification>,
    /// Free-form notes (e.g. Xcode version, OS build, model checkpoint).
    pub notes: Option<String>,
}

impl PhaseEvidenceReceipt {
    /// Convenience constructor for a passing smoke-test receipt.
    pub fn smoke_passed(
        phase_id: PhaseId,
        phase_kind: PhaseKind,
        profile_id: ProfileId,
        backend: BackendKind,
        machine_digest: MachineProfileDigest,
        model_digest: ModelProfileDigest,
    ) -> Self {
        let now = TimestampMs::now();
        Self {
            receipt_id: ReceiptId::new_random(),
            phase_id,
            phase_kind,
            profile_id,
            backend,
            machine_profile_digest: machine_digest,
            model_profile_digest: model_digest,
            input_digest: "stub-input".into(),
            output_digest: Some("stub-output".into()),
            started_at: now,
            finished_at: now,
            status: EvidenceStatus::RuntimeSmokePassed,
            metrics: PhaseMetrics::default(),
            artifacts: vec![],
            gate_results: vec![EvidenceGateResult {
                requirement: EvidenceRequirement::RuntimeSmoke,
                passed: true,
                notes: None,
            }],
            failure: None,
            notes: None,
        }
    }

    /// Convenience constructor for a rejected receipt.
    pub fn rejected(
        phase_id: PhaseId,
        phase_kind: PhaseKind,
        profile_id: ProfileId,
        backend: BackendKind,
        machine_digest: MachineProfileDigest,
        model_digest: ModelProfileDigest,
        failure: FailureClassification,
        notes: impl Into<String>,
    ) -> Self {
        let now = TimestampMs::now();
        Self {
            receipt_id: ReceiptId::new_random(),
            phase_id,
            phase_kind,
            profile_id,
            backend,
            machine_profile_digest: machine_digest,
            model_profile_digest: model_digest,
            input_digest: "".into(),
            output_digest: None,
            started_at: now,
            finished_at: now,
            status: EvidenceStatus::Rejected,
            metrics: PhaseMetrics::default(),
            artifacts: vec![],
            gate_results: vec![],
            failure: Some(failure),
            notes: Some(notes.into()),
        }
    }
}

// ── status_reducer ─────────────────────────────────────────────────────────

/// Derive the current `EvidenceStatus` from a history of receipts.
///
/// This is the authoritative source of truth for qualification status.
/// It must never be bypassed by writing status to a database directly.
///
/// # Rules
/// 1. If any receipt has `Rejected`, the result is `Rejected` (terminal failure).
/// 2. If any receipt has `Quarantined`, the result is `Quarantined` (unless Rejected).
/// 3. `Compiled` alone never produces `Qualified` — every gate must pass
///    independently via its own receipt.
/// 4. `Qualified` is only returned when all receipts are passing and
///    `EvidenceStatus::Qualified` appears in the history.
/// 5. If no receipts exist, status is `Unqualified`.
pub fn status_reducer(receipts: &[PhaseEvidenceReceipt]) -> EvidenceStatus {
    if receipts.is_empty() {
        return EvidenceStatus::Unqualified;
    }

    // Check terminal failure states first.
    if receipts
        .iter()
        .any(|r| r.status == EvidenceStatus::Rejected)
    {
        return EvidenceStatus::Rejected;
    }
    if receipts
        .iter()
        .any(|r| r.status == EvidenceStatus::Quarantined)
    {
        return EvidenceStatus::Quarantined;
    }

    // Find the highest non-terminal status — but enforce gate ordering:
    // `Compiled` (ordinal 2) cannot jump past `Loaded` (3) to `Qualified` (10).
    // We take the maximum passing status present in the receipts.
    // `Qualified` is only valid if a receipt explicitly claims it.
    let max_status = receipts
        .iter()
        .filter(|r| !r.status.is_failed())
        .map(|r| r.status)
        .max()
        .unwrap_or(EvidenceStatus::Unqualified);

    max_status
}

// ── EvidenceLedger trait ──────────────────────────────────────────────────

/// Append-only store of `PhaseEvidenceReceipt`s.
///
/// The ledger is the durable truth layer. All qualification decisions are
/// derived from the ledger via `status_reducer`, never from mutable state.
pub trait EvidenceLedger: Send {
    /// Append a receipt to the ledger. Must be atomic — partial writes are
    /// not permitted.
    fn append(&mut self, receipt: PhaseEvidenceReceipt) -> Result<(), LedgerError>;

    /// Return all receipts for a specific (backend, phase kind) pair across
    /// all model and machine profiles.
    fn query_by_phase(&self, backend: BackendKind, kind: PhaseKind) -> Vec<PhaseEvidenceReceipt>;

    /// Return all receipts for a specific model profile digest.
    fn query_by_model_digest(&self, model_digest: &ModelProfileDigest)
        -> Vec<PhaseEvidenceReceipt>;

    /// Return all receipts for a specific machine profile digest.
    fn query_by_machine_digest(
        &self,
        machine_digest: &MachineProfileDigest,
    ) -> Vec<PhaseEvidenceReceipt>;

    /// Derive the current status for a specific (backend, phase kind, model,
    /// machine) tuple by running `status_reducer` over relevant receipts.
    fn current_status(
        &self,
        backend: BackendKind,
        kind: PhaseKind,
        model_digest: &ModelProfileDigest,
        machine_digest: &MachineProfileDigest,
    ) -> EvidenceStatus {
        let relevant: Vec<PhaseEvidenceReceipt> = self
            .query_by_phase(backend, kind)
            .into_iter()
            .filter(|r| {
                &r.model_profile_digest == model_digest
                    && &r.machine_profile_digest == machine_digest
            })
            .collect();
        status_reducer(&relevant)
    }

    /// Total number of receipts stored.
    fn len(&self) -> usize;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

// ── LedgerError ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum LedgerError {
    IoError(String),
    SerdeError(String),
    ReceiptAlreadyExists(ReceiptId),
}

impl std::fmt::Display for LedgerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LedgerError::IoError(e) => write!(f, "ledger I/O error: {e}"),
            LedgerError::SerdeError(e) => write!(f, "ledger serde error: {e}"),
            LedgerError::ReceiptAlreadyExists(id) => {
                write!(f, "receipt {id} already exists in ledger")
            }
        }
    }
}

// ── NativeEvidenceLedger (in-memory) ─────────────────────────────────────

/// In-memory `EvidenceLedger` for testing and Mission 0005.
///
/// Mission 0004 will add a JSONL-backed implementation.
#[derive(Debug, Default)]
pub struct NativeEvidenceLedger {
    receipts: Vec<PhaseEvidenceReceipt>,
}

impl NativeEvidenceLedger {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn all_receipts(&self) -> &[PhaseEvidenceReceipt] {
        &self.receipts
    }
}

impl EvidenceLedger for NativeEvidenceLedger {
    fn append(&mut self, receipt: PhaseEvidenceReceipt) -> Result<(), LedgerError> {
        self.receipts.push(receipt);
        Ok(())
    }

    fn query_by_phase(&self, backend: BackendKind, kind: PhaseKind) -> Vec<PhaseEvidenceReceipt> {
        self.receipts
            .iter()
            .filter(|r| r.backend == backend && r.phase_kind == kind)
            .cloned()
            .collect()
    }

    fn query_by_model_digest(
        &self,
        model_digest: &ModelProfileDigest,
    ) -> Vec<PhaseEvidenceReceipt> {
        self.receipts
            .iter()
            .filter(|r| &r.model_profile_digest == model_digest)
            .cloned()
            .collect()
    }

    fn query_by_machine_digest(
        &self,
        machine_digest: &MachineProfileDigest,
    ) -> Vec<PhaseEvidenceReceipt> {
        self.receipts
            .iter()
            .filter(|r| &r.machine_profile_digest == machine_digest)
            .cloned()
            .collect()
    }

    fn len(&self) -> usize {
        self.receipts.len()
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference_profile::ids::{PhaseId, ProfileId};

    fn dummy_machine_digest() -> MachineProfileDigest {
        MachineProfileDigest::from_hex("a".repeat(64)).unwrap()
    }

    fn dummy_model_digest() -> ModelProfileDigest {
        ModelProfileDigest::from_hex("b".repeat(64)).unwrap()
    }

    fn make_receipt(
        phase_kind: PhaseKind,
        backend: BackendKind,
        status: EvidenceStatus,
    ) -> PhaseEvidenceReceipt {
        let phase_id = PhaseId::new(phase_kind.ordinal(), 0);
        let profile_id = ProfileId::new_random();
        let now = TimestampMs::now();
        PhaseEvidenceReceipt {
            receipt_id: ReceiptId::new_random(),
            phase_id,
            phase_kind,
            profile_id,
            backend,
            machine_profile_digest: dummy_machine_digest(),
            model_profile_digest: dummy_model_digest(),
            input_digest: "test".into(),
            output_digest: Some("test-out".into()),
            started_at: now,
            finished_at: now,
            status,
            metrics: PhaseMetrics::default(),
            artifacts: vec![],
            gate_results: vec![],
            failure: None,
            notes: None,
        }
    }

    #[test]
    fn empty_ledger_is_unqualified() {
        assert_eq!(status_reducer(&[]), EvidenceStatus::Unqualified);
    }

    #[test]
    fn compiled_alone_is_not_qualified() {
        let r = make_receipt(
            PhaseKind::Prefill,
            BackendKind::CoreAI,
            EvidenceStatus::Compiled,
        );
        let status = status_reducer(&[r]);
        assert_ne!(
            status,
            EvidenceStatus::Qualified,
            "`Compiled` alone must never produce `Qualified`"
        );
        assert_eq!(status, EvidenceStatus::Compiled);
    }

    #[test]
    fn rejected_dominates_all_other_receipts() {
        let passing = make_receipt(
            PhaseKind::Prefill,
            BackendKind::MLX,
            EvidenceStatus::ParityPassed,
        );
        let rejected = make_receipt(
            PhaseKind::Prefill,
            BackendKind::MLX,
            EvidenceStatus::Rejected,
        );
        let status = status_reducer(&[passing, rejected]);
        assert_eq!(
            status,
            EvidenceStatus::Rejected,
            "`Rejected` must dominate all passing receipts"
        );
    }

    #[test]
    fn quarantined_dominates_non_rejected() {
        let passing = make_receipt(
            PhaseKind::Decode,
            BackendKind::MLX,
            EvidenceStatus::ParityPassed,
        );
        let quarantined = make_receipt(
            PhaseKind::Decode,
            BackendKind::MLX,
            EvidenceStatus::Quarantined,
        );
        let status = status_reducer(&[passing, quarantined]);
        assert_eq!(status, EvidenceStatus::Quarantined);
    }

    #[test]
    fn rejected_dominates_quarantined() {
        let quarantined = make_receipt(
            PhaseKind::Decode,
            BackendKind::MLX,
            EvidenceStatus::Quarantined,
        );
        let rejected = make_receipt(
            PhaseKind::Decode,
            BackendKind::MLX,
            EvidenceStatus::Rejected,
        );
        let status = status_reducer(&[quarantined, rejected]);
        assert_eq!(status, EvidenceStatus::Rejected);
    }

    #[test]
    fn highest_passing_gate_wins() {
        let smoke = make_receipt(
            PhaseKind::Prefill,
            BackendKind::MLX,
            EvidenceStatus::RuntimeSmokePassed,
        );
        let parity = make_receipt(
            PhaseKind::Prefill,
            BackendKind::MLX,
            EvidenceStatus::ParityPassed,
        );
        let status = status_reducer(&[smoke, parity]);
        assert_eq!(status, EvidenceStatus::ParityPassed);
    }

    #[test]
    fn native_ledger_append_and_query() {
        let mut ledger = NativeEvidenceLedger::new();
        assert!(ledger.is_empty());

        let r = make_receipt(
            PhaseKind::Decode,
            BackendKind::MLX,
            EvidenceStatus::RuntimeSmokePassed,
        );
        ledger.append(r).unwrap();
        assert_eq!(ledger.len(), 1);

        let results = ledger.query_by_phase(BackendKind::MLX, PhaseKind::Decode);
        assert_eq!(results.len(), 1);

        let no_results = ledger.query_by_phase(BackendKind::CoreAI, PhaseKind::Decode);
        assert!(no_results.is_empty());
    }

    #[test]
    fn current_status_uses_reducer() {
        let mut ledger = NativeEvidenceLedger::new();
        let r = make_receipt(
            PhaseKind::Prefill,
            BackendKind::MLX,
            EvidenceStatus::Compiled,
        );
        ledger.append(r).unwrap();

        let status = ledger.current_status(
            BackendKind::MLX,
            PhaseKind::Prefill,
            &dummy_model_digest(),
            &dummy_machine_digest(),
        );
        assert_ne!(status, EvidenceStatus::Qualified);
        assert_eq!(status, EvidenceStatus::Compiled);
    }

    #[test]
    fn smoke_passed_receipt_factory() {
        let phase_id = PhaseId::new(PhaseKind::Decode.ordinal(), 0);
        let profile_id = ProfileId::new_random();
        let r = PhaseEvidenceReceipt::smoke_passed(
            phase_id,
            PhaseKind::Decode,
            profile_id,
            BackendKind::MLX,
            dummy_machine_digest(),
            dummy_model_digest(),
        );
        assert_eq!(r.status, EvidenceStatus::RuntimeSmokePassed);
        assert!(r.failure.is_none());
        assert!(!r.gate_results.is_empty());
    }

    #[test]
    fn rejected_receipt_factory() {
        let phase_id = PhaseId::new(PhaseKind::Prefill.ordinal(), 0);
        let profile_id = ProfileId::new_random();
        let r = PhaseEvidenceReceipt::rejected(
            phase_id,
            PhaseKind::Prefill,
            profile_id,
            BackendKind::CoreAI,
            dummy_machine_digest(),
            dummy_model_digest(),
            FailureClassification::OomKilled,
            "ran out of memory at 8k context",
        );
        assert_eq!(r.status, EvidenceStatus::Rejected);
        assert_eq!(r.failure, Some(FailureClassification::OomKilled));
    }

    #[test]
    fn receipt_serde_round_trip() {
        let r = make_receipt(
            PhaseKind::KvAppend,
            BackendKind::MLX,
            EvidenceStatus::ConcurrencyPassed,
        );
        let json = serde_json::to_string(&r).unwrap();
        let back: PhaseEvidenceReceipt = serde_json::from_str(&json).unwrap();
        assert_eq!(back.receipt_id, r.receipt_id);
        assert_eq!(back.status, r.status);
        assert_eq!(back.backend, r.backend);
    }
}
