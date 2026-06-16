//! Strongly-typed identifier newtypes for TAIP.
//!
//! Every ID is `Copy + Clone + Eq + Hash + Serialize + Deserialize`.
//! Digests are hex-encoded SHA-256 strings wrapped in newtypes to prevent
//! accidental mix-ups between machine, model, and receipt digests.

use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

// ── Phase / profile / receipt IDs ──────────────────────────────────────────

/// Unique identifier for an `AsyncInferencePhase` within a profile.
///
/// Derived from `PhaseKind` ordinal + per-profile counter. Stable across
/// serialization as long as the profile is not rebuilt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PhaseId(pub u64);

impl PhaseId {
    pub fn new(kind_ordinal: u16, sequence: u32) -> Self {
        // Pack kind (high 16 bits) + sequence (low 32 bits) into u64.
        // Leaves 16 bits free for future flags.
        let v = ((kind_ordinal as u64) << 32) | (sequence as u64);
        Self(v)
    }

    pub fn kind_ordinal(self) -> u16 {
        ((self.0 >> 32) & 0xFFFF) as u16
    }

    pub fn sequence(self) -> u32 {
        (self.0 & 0xFFFF_FFFF) as u32
    }
}

impl fmt::Display for PhaseId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "phase-{:016x}", self.0)
    }
}

/// Unique identifier for an `ExecutionProfile`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProfileId(pub Uuid);

impl ProfileId {
    pub fn new_random() -> Self {
        Self(Uuid::new_v4())
    }
}

impl fmt::Display for ProfileId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "profile-{}", self.0)
    }
}

/// Unique identifier for a `PhaseEvidenceReceipt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ReceiptId(pub Uuid);

impl ReceiptId {
    pub fn new_random() -> Self {
        Self(Uuid::new_v4())
    }
}

impl fmt::Display for ReceiptId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "receipt-{}", self.0)
    }
}

/// Versioned backend adapter identifier.
///
/// Format: `"<adapter-name>@<semver>"`, e.g. `"core-ai@0.1.0"`.
/// Must not contain whitespace.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct BackendAdapterId(pub String);

impl BackendAdapterId {
    pub fn new(name: impl Into<String>, version: impl Into<String>) -> Self {
        Self(format!("{}@{}", name.into(), version.into()))
    }
}

impl fmt::Display for BackendAdapterId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// ── Digest newtypes ─────────────────────────────────────────────────────────

/// SHA-256 hex digest of the canonical JSON serialisation of a `MachineProfile`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MachineProfileDigest(pub String);

impl MachineProfileDigest {
    /// Construct from a pre-computed hex string. Must be 64 lowercase hex chars.
    pub fn from_hex(hex: impl Into<String>) -> Result<Self, DigestError> {
        let s = hex.into();
        validate_hex64(&s)?;
        Ok(Self(s))
    }
}

impl fmt::Display for MachineProfileDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// SHA-256 hex digest of the canonical JSON serialisation of a `ModelProfile`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ModelProfileDigest(pub String);

impl ModelProfileDigest {
    pub fn from_hex(hex: impl Into<String>) -> Result<Self, DigestError> {
        let s = hex.into();
        validate_hex64(&s)?;
        Ok(Self(s))
    }
}

impl fmt::Display for ModelProfileDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// SHA-256 hex digest of a model source file, weight shard, or artifact.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ArtifactDigest(pub String);

impl ArtifactDigest {
    pub fn from_hex(hex: impl Into<String>) -> Result<Self, DigestError> {
        let s = hex.into();
        validate_hex64(&s)?;
        Ok(Self(s))
    }
}

impl fmt::Display for ArtifactDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// ── Digest validation ───────────────────────────────────────────────────────

/// Error returned when a hex digest string fails validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DigestError {
    /// Wrong length — expected 64 lowercase hex characters.
    WrongLength { got: usize },
    /// Contains a character that is not a lowercase hex digit.
    InvalidChar { c: char, pos: usize },
}

impl fmt::Display for DigestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DigestError::WrongLength { got } => {
                write!(f, "digest must be 64 hex chars, got {got}")
            }
            DigestError::InvalidChar { c, pos } => {
                write!(f, "invalid hex char {c:?} at position {pos}")
            }
        }
    }
}

fn validate_hex64(s: &str) -> Result<(), DigestError> {
    if s.len() != 64 {
        return Err(DigestError::WrongLength { got: s.len() });
    }
    for (pos, c) in s.char_indices() {
        if !c.is_ascii_hexdigit() || c.is_ascii_uppercase() {
            return Err(DigestError::InvalidChar { c, pos });
        }
    }
    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_id_round_trips() {
        let id = PhaseId::new(7, 42);
        assert_eq!(id.kind_ordinal(), 7);
        assert_eq!(id.sequence(), 42);
        let json = serde_json::to_string(&id).unwrap();
        let back: PhaseId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn profile_id_display() {
        let id = ProfileId::new_random();
        let s = id.to_string();
        assert!(s.starts_with("profile-"));
    }

    #[test]
    fn receipt_id_display() {
        let id = ReceiptId::new_random();
        let s = id.to_string();
        assert!(s.starts_with("receipt-"));
    }

    #[test]
    fn backend_adapter_id_format() {
        let id = BackendAdapterId::new("core-ai", "0.1.0");
        assert_eq!(id.to_string(), "core-ai@0.1.0");
        let json = serde_json::to_string(&id).unwrap();
        let back: BackendAdapterId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn digest_validates_correctly() {
        let good = "a".repeat(64);
        assert!(MachineProfileDigest::from_hex(&good).is_ok());

        let short = "abc";
        assert!(matches!(
            MachineProfileDigest::from_hex(short),
            Err(DigestError::WrongLength { .. })
        ));

        let mut bad = "a".repeat(63);
        bad.push('G'); // uppercase — invalid
        assert!(matches!(
            MachineProfileDigest::from_hex(&bad),
            Err(DigestError::InvalidChar { .. })
        ));
    }

    #[test]
    fn digest_serde_round_trip() {
        let d = ArtifactDigest::from_hex("b".repeat(64)).unwrap();
        let json = serde_json::to_string(&d).unwrap();
        let back: ArtifactDigest = serde_json::from_str(&json).unwrap();
        assert_eq!(back, d);
    }
}
