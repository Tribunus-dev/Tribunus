//! TAIP phase kinds, static metadata, and the `AsyncInferencePhase` struct.
//!
//! A phase is the atomic unit of the Tribunus Async Inference Profile. Each
//! phase has:
//! - A `PhaseKind` declaring its semantic role.
//! - A `PhaseStaticMeta` row encoding invariant behavioural flags.
//! - A set of `EvidenceRequirement`s that must be satisfied before the phase
//!   can be considered qualified on any backend.
//!
//! The `AsyncInferencePhase` struct composes the static metadata with
//! runtime contracts (`BackendOwnerContract`, `MemoryContract`, etc.) to
//! form a node in the `PhaseGraph`.

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::inference_profile::{
    backend::{BackendOwnerContract, EvidenceStatus, FallbackPolicy},
    concurrency::ConcurrencyPolicy,
    ids::PhaseId,
    memory::MemoryContract,
};

// ── PhaseKind ─────────────────────────────────────────────────────────────

/// The semantic kind of an inference phase.
///
/// Each variant maps to a unique row in the `PHASE_STATIC_META` table.
/// Variants are stable — adding a new one is a semver-minor change;
/// removing or renaming one is semver-major.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhaseKind {
    /// Turn external text, images, files, and tool outputs into model inputs.
    TokenizerIngress,
    /// Semantic / vector / graph search over memory banks.
    Retrieval,
    /// Rank retrieved context candidates before prompt assembly.
    Reranking,
    /// Consume the initial token sequence and initialise model state.
    Prefill,
    /// Scaled dot-product attention kernel (query × key → value).
    Attention,
    /// Create or initialise KV state during prefill.
    KvWrite,
    /// Mutate KV state during decode (append new key/value pair).
    KvAppend,
    /// Read a view of KV state for another phase or cross-backend consumer.
    KvView,
    /// Recurrent token-production loop.
    Decode,
    /// Convert logits to a token choice (argmax, top-k, top-p, grammar masks).
    Sampling,
    /// Incrementally validate structured output (JSON, schema, tool protocol).
    StructuredOutputValidation,
    /// Freeze model-visible state, extract and dispatch a tool call.
    ToolCallBoundary,
    /// Read durable or ephemeral memory into the execution context.
    MemoryRead,
    /// Write memories, receipts, checkpoints, or learned facts.
    MemoryWrite,
    /// Capture resumable execution state.
    Checkpoint,
    /// First-class control signal propagated through active phases.
    Cancellation,
    /// Reconstruct safe execution state after crash, timeout, or failure.
    Recovery,
}

impl PhaseKind {
    /// Returns the ordinal used as the high 16 bits of a `PhaseId`.
    ///
    /// Ordinals are stable — they MUST NOT be renumbered once assigned.
    pub fn ordinal(self) -> u16 {
        match self {
            PhaseKind::TokenizerIngress => 0,
            PhaseKind::Retrieval => 1,
            PhaseKind::Reranking => 2,
            PhaseKind::Prefill => 3,
            PhaseKind::Attention => 4,
            PhaseKind::KvWrite => 5,
            PhaseKind::KvAppend => 6,
            PhaseKind::KvView => 7,
            PhaseKind::Decode => 8,
            PhaseKind::Sampling => 9,
            PhaseKind::StructuredOutputValidation => 10,
            PhaseKind::ToolCallBoundary => 11,
            PhaseKind::MemoryRead => 12,
            PhaseKind::MemoryWrite => 13,
            PhaseKind::Checkpoint => 14,
            PhaseKind::Cancellation => 15,
            PhaseKind::Recovery => 16,
        }
    }

    /// All defined phase kinds, in ordinal order.
    pub fn all() -> &'static [PhaseKind] {
        &[
            PhaseKind::TokenizerIngress,
            PhaseKind::Retrieval,
            PhaseKind::Reranking,
            PhaseKind::Prefill,
            PhaseKind::Attention,
            PhaseKind::KvWrite,
            PhaseKind::KvAppend,
            PhaseKind::KvView,
            PhaseKind::Decode,
            PhaseKind::Sampling,
            PhaseKind::StructuredOutputValidation,
            PhaseKind::ToolCallBoundary,
            PhaseKind::MemoryRead,
            PhaseKind::MemoryWrite,
            PhaseKind::Checkpoint,
            PhaseKind::Cancellation,
            PhaseKind::Recovery,
        ]
    }

    /// Reconstruct a `PhaseKind` from its ordinal.
    pub fn from_ordinal(ord: u16) -> Option<PhaseKind> {
        PhaseKind::all()
            .iter()
            .copied()
            .find(|k| k.ordinal() == ord)
    }

    /// Return the static metadata row for this phase kind.
    pub fn static_meta(self) -> PhaseStaticMeta {
        PHASE_STATIC_META[self.ordinal() as usize]
    }
}

impl fmt::Display for PhaseKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            PhaseKind::TokenizerIngress => "tokenizer_ingress",
            PhaseKind::Retrieval => "retrieval",
            PhaseKind::Reranking => "reranking",
            PhaseKind::Prefill => "prefill",
            PhaseKind::Attention => "attention",
            PhaseKind::KvWrite => "kv_write",
            PhaseKind::KvAppend => "kv_append",
            PhaseKind::KvView => "kv_view",
            PhaseKind::Decode => "decode",
            PhaseKind::Sampling => "sampling",
            PhaseKind::StructuredOutputValidation => "structured_output_validation",
            PhaseKind::ToolCallBoundary => "tool_call_boundary",
            PhaseKind::MemoryRead => "memory_read",
            PhaseKind::MemoryWrite => "memory_write",
            PhaseKind::Checkpoint => "checkpoint",
            PhaseKind::Cancellation => "cancellation",
            PhaseKind::Recovery => "recovery",
        };
        f.write_str(s)
    }
}

// ── PhaseStaticMeta ────────────────────────────────────────────────────────

/// Invariant flags and requirements for a phase kind.
///
/// These are facts about the phase's nature — they do not change based on
/// which backend is executing the phase. Runtime contracts (`MemoryContract`,
/// `ConcurrencyPolicy`, etc.) encode the backend-specific details.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhaseStaticMeta {
    /// True if the phase is a significant compute consumer (GPU/ANE dispatch).
    pub compute_heavy: bool,
    /// True if the phase maintains mutable state across steps.
    pub stateful: bool,
    /// True if the phase can produce externally-visible side effects
    /// (network calls, disk writes, tool executions, memory writes).
    pub side_effectful: bool,
    /// True if the phase can be interrupted by a cancellation signal.
    pub cancelable: bool,
    /// True if the phase's state can be captured for resumption.
    pub checkpointable: bool,
    /// True if the phase may mutate shared memory (KV cache, memory banks).
    pub memory_mutating: bool,
    /// True if the phase requires an authority check before execution.
    pub authority_sensitive: bool,
    /// True if the phase MUST have a defined fallback route. Phases where
    /// no fallback exists (e.g. `Cancellation`) set this to `false`.
    pub fallback_required: bool,
}

/// Static metadata table indexed by `PhaseKind::ordinal()`.
///
/// The table MUST have exactly `PhaseKind::all().len()` rows, in ordinal
/// order. Tests enforce this invariant.
static PHASE_STATIC_META: &[PhaseStaticMeta] = &[
    // 0: TokenizerIngress
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: false,
        side_effectful: false,
        cancelable: true,
        checkpointable: true,
        memory_mutating: false,
        authority_sensitive: false,
        fallback_required: false,
    },
    // 1: Retrieval
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: false,
        side_effectful: false,
        cancelable: true,
        checkpointable: true,
        memory_mutating: false,
        authority_sensitive: true,
        fallback_required: true,
    },
    // 2: Reranking
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: false,
        side_effectful: false,
        cancelable: true,
        checkpointable: false,
        memory_mutating: false,
        authority_sensitive: false,
        fallback_required: true,
    },
    // 3: Prefill
    PhaseStaticMeta {
        compute_heavy: true,
        stateful: true,
        side_effectful: false,
        cancelable: true,
        checkpointable: true,
        memory_mutating: true,
        authority_sensitive: false,
        fallback_required: true,
    },
    // 4: Attention
    PhaseStaticMeta {
        compute_heavy: true,
        stateful: false,
        side_effectful: false,
        cancelable: false,
        checkpointable: false,
        memory_mutating: false,
        authority_sensitive: false,
        fallback_required: true,
    },
    // 5: KvWrite
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: true,
        side_effectful: false,
        cancelable: true,
        checkpointable: true,
        memory_mutating: true,
        authority_sensitive: false,
        fallback_required: false,
    },
    // 6: KvAppend
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: true,
        side_effectful: false,
        cancelable: true,
        checkpointable: true,
        memory_mutating: true,
        authority_sensitive: false,
        fallback_required: false,
    },
    // 7: KvView
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: false,
        side_effectful: false,
        cancelable: false,
        checkpointable: false,
        memory_mutating: false,
        authority_sensitive: false,
        fallback_required: false,
    },
    // 8: Decode
    PhaseStaticMeta {
        compute_heavy: true,
        stateful: true,
        side_effectful: false,
        cancelable: true,
        checkpointable: true,
        memory_mutating: true,
        authority_sensitive: false,
        fallback_required: true,
    },
    // 9: Sampling
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: false,
        side_effectful: false,
        cancelable: true,
        checkpointable: false,
        memory_mutating: false,
        authority_sensitive: false,
        fallback_required: false,
    },
    // 10: StructuredOutputValidation
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: true,
        side_effectful: false,
        cancelable: true,
        checkpointable: true,
        memory_mutating: false,
        authority_sensitive: false,
        fallback_required: false,
    },
    // 11: ToolCallBoundary
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: true,
        side_effectful: true,
        cancelable: true,
        checkpointable: true,
        memory_mutating: false,
        authority_sensitive: true,
        fallback_required: false,
    },
    // 12: MemoryRead
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: false,
        side_effectful: false,
        cancelable: true,
        checkpointable: false,
        memory_mutating: false,
        authority_sensitive: true,
        fallback_required: false,
    },
    // 13: MemoryWrite
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: true,
        side_effectful: true,
        cancelable: false,
        checkpointable: true,
        memory_mutating: true,
        authority_sensitive: true,
        fallback_required: false,
    },
    // 14: Checkpoint
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: true,
        side_effectful: true,
        cancelable: false,
        checkpointable: false, // checkpoint cannot checkpoint itself
        memory_mutating: true,
        authority_sensitive: false,
        fallback_required: false,
    },
    // 15: Cancellation
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: true,
        side_effectful: true,
        cancelable: false, // cancellation cannot be cancelled
        checkpointable: false,
        memory_mutating: false,
        authority_sensitive: false,
        fallback_required: false,
    },
    // 16: Recovery
    PhaseStaticMeta {
        compute_heavy: false,
        stateful: true,
        side_effectful: false,
        cancelable: true,
        checkpointable: false,
        memory_mutating: true,
        authority_sensitive: false,
        fallback_required: false,
    },
];

// ── EvidenceRequirement ────────────────────────────────────────────────────

/// A qualification gate that must pass before a phase advances to `Qualified`.
///
/// Every phase kind has a minimum set of required gates. A backend cannot
/// claim `EvidenceStatus::Qualified` for a phase unless all required gates
/// have produced passing `PhaseEvidenceReceipt`s.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceRequirement {
    /// Backend can load the model without crash.
    Load,
    /// Backend can execute the phase end-to-end on toy inputs.
    RuntimeSmoke,
    /// Output matches a CPU reference within ε tolerance.
    Parity,
    /// Phase handles concurrent calls correctly (single-writer invariant etc.).
    Concurrency,
    /// Phase responds correctly to a cancellation signal.
    Cancellation,
    /// Phase can be recovered from a checkpoint.
    Recovery,
    /// Phase handles memory pressure without data corruption.
    MemoryPressure,
    /// Phase latency is within the declared budget.
    Latency,
}

/// Returns the required evidence gates for the given `PhaseKind`.
///
/// All compute-heavy phases require at minimum `[Load, RuntimeSmoke, Parity]`.
/// Control phases (`Cancellation`, `Recovery`) require `[RuntimeSmoke]`.
pub fn required_gates(kind: PhaseKind) -> &'static [EvidenceRequirement] {
    match kind {
        PhaseKind::Prefill | PhaseKind::Decode | PhaseKind::Attention => &[
            EvidenceRequirement::Load,
            EvidenceRequirement::RuntimeSmoke,
            EvidenceRequirement::Parity,
            EvidenceRequirement::Latency,
            EvidenceRequirement::MemoryPressure,
        ],
        PhaseKind::KvWrite | PhaseKind::KvAppend => &[
            EvidenceRequirement::Load,
            EvidenceRequirement::RuntimeSmoke,
            EvidenceRequirement::Concurrency,
            EvidenceRequirement::Cancellation,
        ],
        PhaseKind::KvView => &[EvidenceRequirement::RuntimeSmoke],
        PhaseKind::Sampling | PhaseKind::StructuredOutputValidation => &[
            EvidenceRequirement::RuntimeSmoke,
            EvidenceRequirement::Parity,
        ],
        PhaseKind::ToolCallBoundary | PhaseKind::MemoryWrite => &[
            EvidenceRequirement::RuntimeSmoke,
            EvidenceRequirement::Cancellation,
        ],
        PhaseKind::Checkpoint | PhaseKind::Recovery => &[
            EvidenceRequirement::RuntimeSmoke,
            EvidenceRequirement::Recovery,
        ],
        PhaseKind::Cancellation => &[EvidenceRequirement::RuntimeSmoke],
        _ => &[EvidenceRequirement::RuntimeSmoke],
    }
}

// ── CheckpointPolicy ───────────────────────────────────────────────────────

/// How much of a phase's state can be captured for resumption.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointPolicy {
    /// Phase produces no checkpointable state.
    None,
    /// Phase state can be recreated by replaying the token sequence (no KV).
    TokenReplayOnly,
    /// Backend can resume a session without full replay (opaque session handle).
    BackendSessionResume,
    /// KV cache can be serialised to storage and restored.
    SerializedCache,
    /// KV cache can be transferred across backends.
    PortableCache,
}

// ── CancellationPolicy ─────────────────────────────────────────────────────

/// How the phase responds to a cancellation signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancellationPolicy {
    /// Phase ignores cancellation — it runs to completion.
    NotCancelable,
    /// Phase stops at the next safe point; output so far is discarded.
    DiscardOutput,
    /// Phase stops at the next safe point; output so far is committed.
    CommitPartialOutput,
    /// Phase propagates cancellation to child phases and waits for them.
    PropagateAndWait,
}

// ── PhaseInputContract / PhaseOutputContract ───────────────────────────────

/// Declares the kind of data a phase consumes as input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseInputContract {
    /// Human-readable name of this input slot (e.g. `"token_ids"`).
    pub name: String,
    /// Semantic category.
    pub kind: IoKind,
    /// Whether this input is required or optional.
    pub required: bool,
}

/// Declares the kind of data a phase produces as output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseOutputContract {
    pub name: String,
    pub kind: IoKind,
}

/// Semantic IO categories for phase inputs and outputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IoKind {
    TokenIds,
    Embeddings,
    LogitsVector,
    KvCacheHandle,
    TextString,
    JsonValue,
    ToolCallSpec,
    MemoryItems,
    CheckpointBlob,
    CancellationToken,
    RecoveryHandle,
    AuthorityToken,
    BenchmarkMetrics,
}

// ── AsyncInferencePhase ────────────────────────────────────────────────────

/// A single node in the Tribunus Async Inference `PhaseGraph`.
///
/// Each phase declares its runtime contracts, backend owner, and evidence
/// requirements. The phase graph is validated as a DAG at construction time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsyncInferencePhase {
    /// Unique identifier within the profile.
    pub phase_id: PhaseId,
    /// Semantic kind.
    pub kind: PhaseKind,
    /// Ordinal position for deterministic ordering within the same kind.
    pub ordinal: u32,
    /// Phase IDs that must complete before this phase can begin.
    pub dependencies: Vec<PhaseId>,
    /// Input contracts — what this phase consumes.
    pub inputs: Vec<PhaseInputContract>,
    /// Output contracts — what this phase produces.
    pub outputs: Vec<PhaseOutputContract>,
    /// Which backend owns execution of this phase.
    pub backend_owner: BackendOwnerContract,
    /// Tensor and buffer ownership contract.
    pub memory_contract: MemoryContract,
    /// Concurrency and scheduling policy.
    pub concurrency_policy: ConcurrencyPolicy,
    /// How this phase responds to cancellation.
    pub cancellation_policy: CancellationPolicy,
    /// How much of this phase's state can be checkpointed.
    pub checkpoint_policy: CheckpointPolicy,
    /// What happens if the primary backend fails.
    pub fallback_policy: FallbackPolicy,
    /// Evidence gates required for this phase to reach `Qualified` status.
    pub evidence_requirements: Vec<EvidenceRequirement>,
    /// Current qualification status for the declared backend owner.
    pub qualification_status: EvidenceStatus,
}

impl AsyncInferencePhase {
    /// Construct a phase with default contracts and the static evidence
    /// requirements for its kind. Backend owner and memory contract must be
    /// provided; all other fields default to safe conservative values.
    pub fn new(
        kind: PhaseKind,
        ordinal: u32,
        backend_owner: BackendOwnerContract,
        memory_contract: MemoryContract,
    ) -> Self {
        let phase_id = PhaseId::new(kind.ordinal(), ordinal);
        let evidence_requirements = required_gates(kind).to_vec();
        let meta = kind.static_meta();
        Self {
            phase_id,
            kind,
            ordinal,
            dependencies: Vec::new(),
            inputs: Vec::new(),
            outputs: Vec::new(),
            backend_owner,
            memory_contract,
            concurrency_policy: ConcurrencyPolicy::default_serial(),
            cancellation_policy: if meta.cancelable {
                CancellationPolicy::DiscardOutput
            } else {
                CancellationPolicy::NotCancelable
            },
            checkpoint_policy: if meta.checkpointable {
                CheckpointPolicy::TokenReplayOnly
            } else {
                CheckpointPolicy::None
            },
            fallback_policy: if meta.fallback_required {
                FallbackPolicy::Required
            } else {
                FallbackPolicy::None
            },
            evidence_requirements,
            qualification_status: EvidenceStatus::Unqualified,
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_phase_kinds_have_static_meta_rows() {
        let all = PhaseKind::all();
        assert_eq!(
            all.len(),
            PHASE_STATIC_META.len(),
            "PHASE_STATIC_META must have exactly {} rows",
            all.len()
        );
        for kind in all {
            // Should not panic.
            let _ = kind.static_meta();
        }
    }

    #[test]
    fn ordinals_are_unique_and_contiguous() {
        let mut ords: Vec<u16> = PhaseKind::all().iter().map(|k| k.ordinal()).collect();
        ords.sort_unstable();
        let expected: Vec<u16> = (0..PhaseKind::all().len() as u16).collect();
        assert_eq!(
            ords, expected,
            "ordinals must be unique and contiguous starting at 0"
        );
    }

    #[test]
    fn from_ordinal_round_trips() {
        for kind in PhaseKind::all() {
            let ord = kind.ordinal();
            assert_eq!(PhaseKind::from_ordinal(ord), Some(*kind));
        }
        assert!(PhaseKind::from_ordinal(9999).is_none());
    }

    #[test]
    fn all_phase_kinds_have_evidence_requirements() {
        for kind in PhaseKind::all() {
            let gates = required_gates(*kind);
            assert!(
                !gates.is_empty(),
                "PhaseKind::{kind} must have at least one EvidenceRequirement"
            );
        }
    }

    #[test]
    fn cancellation_is_not_cancelable() {
        let meta = PhaseKind::Cancellation.static_meta();
        assert!(
            !meta.cancelable,
            "Cancellation phase must not itself be cancelable"
        );
    }

    #[test]
    fn checkpoint_is_not_checkpointable() {
        let meta = PhaseKind::Checkpoint.static_meta();
        assert!(
            !meta.checkpointable,
            "Checkpoint phase cannot checkpoint itself"
        );
    }

    #[test]
    fn tool_call_boundary_is_authority_sensitive_and_side_effectful() {
        let meta = PhaseKind::ToolCallBoundary.static_meta();
        assert!(meta.authority_sensitive);
        assert!(meta.side_effectful);
    }

    #[test]
    fn phase_kind_serde_round_trip() {
        for kind in PhaseKind::all() {
            let json = serde_json::to_string(kind).unwrap();
            let back: PhaseKind = serde_json::from_str(&json).unwrap();
            assert_eq!(back, *kind, "serde round-trip failed for {kind}");
        }
    }

    #[test]
    fn phase_kind_display_is_snake_case() {
        let s = PhaseKind::ToolCallBoundary.to_string();
        assert_eq!(s, "tool_call_boundary");
        let s = PhaseKind::KvWrite.to_string();
        assert_eq!(s, "kv_write");
    }

    #[test]
    fn unknown_ordinal_returns_none() {
        assert!(PhaseKind::from_ordinal(255).is_none());
    }
}
