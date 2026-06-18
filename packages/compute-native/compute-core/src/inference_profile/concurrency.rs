//! TAIP concurrency policy — scheduling modes, stream affinity, barriers.
//!
//! MLX is the primary reference for Apple-silicon concurrency semantics:
//! independent operations on CPU/GPU streams can run in parallel, and
//! dependent operations get scheduler-inserted dependency fences.
//! Core AI / Core ML scheduling is `BackendManaged` by default.

use serde::{Deserialize, Serialize};

// ── SchedulingMode ─────────────────────────────────────────────────────────

/// How the phase is scheduled relative to other phases in the graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchedulingMode {
    /// Only one instance runs at a time on this stream.
    Serial,
    /// May run in parallel with independent phases (no shared state).
    ParallelIfIndependent,
    /// Operations are pipelined across compute streams.
    Pipelined,
    /// Speculative execution — results may be discarded.
    Speculative,
    /// Batched across multiple requests.
    Batched,
    /// Backend manages scheduling internally (Core AI, Core ML).
    BackendManaged,
}

// ── StreamAffinity ─────────────────────────────────────────────────────────

/// Which compute stream(s) the phase has affinity for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamAffinity {
    /// Prefers CPU streams.
    Cpu,
    /// Prefers GPU streams.
    Gpu,
    /// Runs on whichever stream has capacity (MLX unified scheduler).
    Any,
    /// Stream affinity is managed by the backend.
    BackendManaged,
}

// ── ReadWriteModel ─────────────────────────────────────────────────────────

/// The read/write concurrency model for shared mutable state (KV cache, etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadWriteModel {
    /// Single writer; no concurrent readers.
    SingleWriterNoReaders,
    /// Single writer; multiple concurrent read-only views allowed.
    SingleWriterMultipleReaders,
    /// Multiple readers; no writers (immutable phase).
    MultipleReadersNoWriter,
    /// Exclusive access — no concurrency.
    Exclusive,
}

// ── BarrierKind ────────────────────────────────────────────────────────────

/// The type of synchronization barrier required between phases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BarrierKind {
    /// All preceding operations must complete (full GPU/CPU flush).
    FullFlush,
    /// Dependency fence inserted automatically by the backend scheduler.
    BackendInsertedFence,
    /// Explicit `eval()` call (MLX materialization fence).
    EvalFence,
    /// Lease handoff — ownership transferred via the arena lease system.
    LeaseHandoff,
    /// No barrier required (phases are independent).
    None,
}

// ── RacePolicy ─────────────────────────────────────────────────────────────

/// How the phase handles concurrent access races.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RacePolicy {
    /// Races are not possible by construction (serial schedule).
    NotPossible,
    /// Races detected by assertion; panic in debug, undefined in release.
    AssertNoRace,
    /// Races resolved by last-writer-wins.
    LastWriterWins,
    /// Races resolved by first-writer-wins (idempotent writes).
    FirstWriterWins,
}

// ── ConcurrencyPolicy ─────────────────────────────────────────────────────

/// Declares the concurrency semantics of a phase.
///
/// Most compute-heavy phases on MLX use `Serial` scheduling with
/// `BackendInsertedFence` barriers. Phases that run on Core AI or Core ML
/// use `BackendManaged` throughout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConcurrencyPolicy {
    /// How the phase is scheduled.
    pub scheduling: SchedulingMode,
    /// Preferred compute stream(s).
    pub stream_affinity: StreamAffinity,
    /// How concurrent reads/writes to shared state are managed.
    pub read_write_model: ReadWriteModel,
    /// Maximum number of parallel instances of this phase (1 = serial).
    pub max_parallel_instances: u32,
    /// Barriers required before this phase may begin.
    pub dependency_barriers: Vec<BarrierKind>,
    /// How concurrency races are handled.
    pub race_policy: RacePolicy,
}

impl ConcurrencyPolicy {
    /// Conservative serial policy — single instance, no concurrency, no barriers.
    pub fn default_serial() -> Self {
        Self {
            scheduling: SchedulingMode::Serial,
            stream_affinity: StreamAffinity::Any,
            read_write_model: ReadWriteModel::Exclusive,
            max_parallel_instances: 1,
            dependency_barriers: vec![],
            race_policy: RacePolicy::NotPossible,
        }
    }

    /// MLX-style policy: backend manages fences; GPU/CPU streams may run ops
    /// in parallel when data-independent, inserting fences automatically.
    pub fn mlx_backend_managed() -> Self {
        Self {
            scheduling: SchedulingMode::ParallelIfIndependent,
            stream_affinity: StreamAffinity::Any,
            read_write_model: ReadWriteModel::SingleWriterMultipleReaders,
            max_parallel_instances: 1,
            dependency_barriers: vec![BarrierKind::BackendInsertedFence],
            race_policy: RacePolicy::NotPossible,
        }
    }

    /// Policy for Core AI / Core ML: everything is backend-managed.
    pub fn opaque_backend() -> Self {
        Self {
            scheduling: SchedulingMode::BackendManaged,
            stream_affinity: StreamAffinity::BackendManaged,
            read_write_model: ReadWriteModel::Exclusive,
            max_parallel_instances: 1,
            dependency_barriers: vec![BarrierKind::BackendInsertedFence],
            race_policy: RacePolicy::NotPossible,
        }
    }

    /// Policy for the KV cache (single-writer, with an explicit eval fence).
    pub fn kv_cache_append() -> Self {
        Self {
            scheduling: SchedulingMode::Serial,
            stream_affinity: StreamAffinity::Any,
            read_write_model: ReadWriteModel::SingleWriterNoReaders,
            max_parallel_instances: 1,
            dependency_barriers: vec![BarrierKind::EvalFence],
            race_policy: RacePolicy::AssertNoRace,
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_serial_is_exclusive() {
        let p = ConcurrencyPolicy::default_serial();
        assert_eq!(p.scheduling, SchedulingMode::Serial);
        assert_eq!(p.max_parallel_instances, 1);
        assert_eq!(p.read_write_model, ReadWriteModel::Exclusive);
    }

    #[test]
    fn mlx_policy_allows_parallel_independent_ops() {
        let p = ConcurrencyPolicy::mlx_backend_managed();
        assert_eq!(p.scheduling, SchedulingMode::ParallelIfIndependent);
        assert!(p
            .dependency_barriers
            .contains(&BarrierKind::BackendInsertedFence));
    }

    #[test]
    fn kv_cache_policy_requires_eval_fence() {
        let p = ConcurrencyPolicy::kv_cache_append();
        assert_eq!(p.read_write_model, ReadWriteModel::SingleWriterNoReaders);
        assert!(p.dependency_barriers.contains(&BarrierKind::EvalFence));
    }

    #[test]
    fn concurrency_policy_serde_round_trip() {
        let p = ConcurrencyPolicy::mlx_backend_managed();
        let json = serde_json::to_string(&p).unwrap();
        let back: ConcurrencyPolicy = serde_json::from_str(&json).unwrap();
        assert_eq!(back.scheduling, p.scheduling);
        assert_eq!(back.max_parallel_instances, p.max_parallel_instances);
    }

    #[test]
    fn scheduling_mode_serde_round_trip() {
        for mode in [
            SchedulingMode::Serial,
            SchedulingMode::ParallelIfIndependent,
            SchedulingMode::BackendManaged,
            SchedulingMode::Speculative,
        ] {
            let json = serde_json::to_string(&mode).unwrap();
            let back: SchedulingMode = serde_json::from_str(&json).unwrap();
            assert_eq!(back, mode);
        }
    }
}
