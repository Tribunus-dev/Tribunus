//! Worker readiness states for the ANE dispatch lifecycle.
//!
//! A worker progresses through a strict linear sequence of readiness
//! states from `Unknown` to `ModelReady`.  Each transition is validated
//! by [`WorkerReadiness::can_transition_to`].

use std::fmt;

/// Ordered readiness states for a compute worker.
///
/// Workers must advance through this sequence in order; skipping a state
/// is invalid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WorkerReadiness {
    /// Initial state — no image bound yet.
    Unknown,
    /// ComputeImage directory verified, manifest parsed.
    ComputeImageBound,
    /// All Core ML artifact manifests verified.
    CoreMlArtifactsVerified,
    /// All Core ML models loaded into memory.
    CoreMlModelsLoaded,
    /// ANE warmup predictions succeeded for all segments.
    AneWarmupPassed,
    /// Real model weights loaded and verified by prediction.
    AnePrepared,
    /// All route backends verified.
    RoutesValidated,
    /// Ready to generate tokens.
    ModelReady,
}

impl WorkerReadiness {
    /// Return `true` if `self` can legally transition to `next`.
    ///
    /// The only valid transition is from a state to its immediate successor
    /// in the linear ordering.  Staying in the same state or jumping ahead
    /// is disallowed.
    pub fn can_transition_to(&self, next: &WorkerReadiness) -> bool {
        use WorkerReadiness::*;
        matches!(
            (self, next),
            (Unknown, ComputeImageBound)
                | (ComputeImageBound, CoreMlArtifactsVerified)
                | (CoreMlArtifactsVerified, CoreMlModelsLoaded)
                | (CoreMlModelsLoaded, AneWarmupPassed)
                | (AneWarmupPassed, AnePrepared)
                | (AnePrepared, RoutesValidated)
                | (RoutesValidated, ModelReady)
        )
    }
}

impl fmt::Display for WorkerReadiness {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown => write!(f, "Unknown"),
            Self::ComputeImageBound => write!(f, "ComputeImageBound"),
            Self::CoreMlArtifactsVerified => write!(f, "CoreMlArtifactsVerified"),
            Self::CoreMlModelsLoaded => write!(f, "CoreMlModelsLoaded"),
            Self::AneWarmupPassed => write!(f, "AneWarmupPassed"),
            Self::AnePrepared => write!(f, "AnePrepared"),
            Self::RoutesValidated => write!(f, "RoutesValidated"),
            Self::ModelReady => write!(f, "ModelReady"),
        }
    }
}

/// Captures a transition between two readiness states.
#[derive(Debug, Clone)]
pub struct ReadinessTransitions {
    /// Previous readiness state.
    pub from: WorkerReadiness,
    /// New readiness state.
    pub to: WorkerReadiness,
    /// Timestamp of the transition (seconds since epoch).
    pub timestamp_secs: u64,
}

impl ReadinessTransitions {
    /// Create a new transition record, validating the state change.
    ///
    /// Returns `Err` if `from → to` is not a legal transition.
    pub fn new(from: WorkerReadiness, to: WorkerReadiness, timestamp_secs: u64) -> Result<Self, String> {
        if !from.can_transition_to(&to) {
            return Err(format!(
                "Illegal readiness transition: {} → {}",
                from, to
            ));
        }
        Ok(Self {
            from,
            to,
            timestamp_secs,
        })
    }
}
