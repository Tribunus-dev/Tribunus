//! Weight reference types for ANE compilation.
//!
//! Defines [`WeightReference`] — a sealed descriptor for a single weight
//! tensor — and the [`WeightProvider`] trait for materializing weight data
//! during compilation.  Also provides [`SimpleWeightProvider`] for testing.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Sealed descriptor for one weight tensor in an ANE subgraph.
///
/// Every field is determined at compile-ahead-of-time and must match the
/// physical data exactly.  `byte_length` is validated against
/// `shape × dtype_bytes` and `sha256` against the materialised bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightReference {
    /// Logical name of the weight tensor (e.g. `"mlp.gate_proj.weight"`).
    pub tensor_name: String,
    /// Element data type: `"f16"` or `"f32"`.
    pub dtype: String,
    /// Shape of the weight tensor (full, not packed).
    pub shape: Vec<i64>,
    /// Expected byte length of the materialised weight data.
    pub byte_length: u64,
    /// Hex-encoded SHA-256 of the materialised weight bytes.
    pub sha256: String,
    /// Relative path within the Core ML package (e.g. `"weights/gate_proj.bin"`).
    pub relative_path: String,
}

impl WeightReference {
    /// Validate this reference against the materialised `data`.
    ///
    /// Checks:
    /// 1. `data.len()` matches `byte_length`
    /// 2. `sha256` matches SHA-256 of `data`
    /// 3. `byte_length` equals `shape × element_size(dtype)`
    pub fn validate(&self, data: &[u8]) -> Result<(), String> {
        // 1. Length check
        if data.len() as u64 != self.byte_length {
            return Err(format!(
                "WeightReference '{}': byte_length {} does not match data length {}",
                self.tensor_name,
                self.byte_length,
                data.len()
            ));
        }

        // 2. SHA-256 check
        let mut hasher = Sha256::new();
        hasher.update(data);
        let actual_hex = format!("{:x}", hasher.finalize());
        if actual_hex != self.sha256 {
            return Err(format!(
                "WeightReference '{}': SHA-256 mismatch (expected {}, got {})",
                self.tensor_name, self.sha256, actual_hex
            ));
        }

        // 3. Shape × dtype-size consistency check
        let element_size = match self.dtype.as_str() {
            "f16" => 2u64,
            "f32" => 4u64,
            other => {
                return Err(format!(
                    "WeightReference '{}': unsupported dtype '{}'",
                    self.tensor_name, other
                ));
            }
        };

        let shape_product: u64 = self.shape.iter().copied().fold(1u64, |acc, d| {
            if d <= 0 {
                // Negative or zero dimensions are invalid for storage.
                u64::MAX
            } else {
                acc.saturating_mul(d as u64)
            }
        });

        if shape_product.saturating_mul(element_size) != self.byte_length {
            return Err(format!(
                "WeightReference '{}': shape × element_size ({shape_product} × {element_size} = {}) != byte_length {}",
                self.tensor_name,
                shape_product.saturating_mul(element_size),
                self.byte_length,
            ));
        }

        Ok(())
    }
}

/// Trait for materialising weight data during ANE compilation.
///
/// Implementations must be `Send + Sync` so that compilation can proceed
/// across threads.  The trait is object-safe and intended to be used
/// behind `Arc<dyn WeightProvider>`.
pub trait WeightProvider: Send + Sync {
    /// Return the raw bytes for `reference`.
    ///
    /// Returning an error aborts the current compilation step.
    fn materialize(&self, reference: &WeightReference) -> Result<Vec<u8>, String>;
}

/// Naive in-memory weight provider backed by a `HashMap`.
///
/// Useful for unit tests and small-scale development.  Keys are tensor
/// names (matching [`WeightReference::tensor_name`]); values are the raw
/// weight bytes.
pub struct SimpleWeightProvider {
    weights: HashMap<String, Vec<u8>>,
}

impl SimpleWeightProvider {
    pub fn new(weights: HashMap<String, Vec<u8>>) -> Self {
        Self { weights }
    }
}

impl WeightProvider for SimpleWeightProvider {
    fn materialize(&self, reference: &WeightReference) -> Result<Vec<u8>, String> {
        self.weights
            .get(&reference.tensor_name)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "SimpleWeightProvider: tensor '{}' not found",
                    reference.tensor_name
                )
            })
    }
}
