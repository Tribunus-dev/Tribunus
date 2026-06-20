//! ANE subgraph build descriptor.
//!
//! [`AneSubgraphBuild`] is the sealed compile-ahead-of-time specification
//! for one ANE subgraph.  It carries everything needed to lower a model
//! segment: shape contract, identity of canonical inputs/outputs,
//! weight reference metadata, a weight provider, compute-unit policy,
//! provenance and opset version.

use crate::compiler::ane::weight::{WeightProvider, WeightReference};
use crate::compute_image::CoreMlProvenance;
use std::sync::Arc;

/// Sealed specification for compiling one ANE subgraph.
///
/// Once constructed, this struct is consumed by the ANE compiler to
/// produce a `.mlpackage` + external weights, then a sealed
/// ComputeImage artifact.
pub struct AneSubgraphBuild {
    /// Unique identifier for this subgraph segment.
    pub segment_id: String,
    /// Expected tensor shape contract (flat, in element counts).
    pub shape_contract: Vec<i64>,
    /// Canonical tensor ids that feed into this subgraph.
    pub canonical_input_ids: Vec<String>,
    /// Canonical tensor ids that this subgraph produces.
    pub canonical_output_ids: Vec<String>,
    /// Weight references describing each weight tensor used by this subgraph.
    pub weight_references: Vec<WeightReference>,
    /// Provider for materialising weight data during compilation.
    pub weight_provider: Arc<dyn WeightProvider>,
    /// Compute-unit policy (e.g. `"cpuAndNeuralEngine"`, `"all"`).
    pub compute_units: String,
    /// Core ML opset version (e.g. `"CoreML9"`).
    pub opset: String,
    /// Provenance linking to canonical ComputeImage tensors.
    pub provenance: CoreMlProvenance,
}

impl AneSubgraphBuild {
    /// Construct a new `AneSubgraphBuild`.
    pub fn new(
        segment_id: String,
        shape_contract: Vec<i64>,
        canonical_input_ids: Vec<String>,
        canonical_output_ids: Vec<String>,
        weight_references: Vec<WeightReference>,
        weight_provider: Arc<dyn WeightProvider>,
        compute_units: String,
        opset: String,
        provenance: CoreMlProvenance,
    ) -> Self {
        Self {
            segment_id,
            shape_contract,
            canonical_input_ids,
            canonical_output_ids,
            weight_references,
            weight_provider,
            compute_units,
            opset,
            provenance,
        }
    }
}
