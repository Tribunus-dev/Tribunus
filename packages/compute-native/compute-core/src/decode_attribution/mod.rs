//! Decode Attribution Data Collection Gate.
//!
//! This module implements a measurement harness for Core ML decode
//! attribution: structured JSONL receipts capturing materialization,
//! compilation, load, warmup, and prediction timing across matrices
//! (compute-unit × graph family, shape × graph family), with reference
//! numerical conformance against the pure-Rust evaluator.

pub mod artifact_hash;
pub mod backend_adapters;
pub mod breadcrumb;
pub mod compute_plan;
pub mod coreml_minimal_repro;
pub mod decode_microphase_shape_map;
pub mod defect_clustering;
pub mod environment;
pub mod gap_report;
pub mod graph_catalog;
pub mod harness;
pub mod lattice;
pub mod lattice_validation;
pub mod matrices;
pub mod negative_evidence;
pub mod receipt;
pub mod report;
pub mod shape_profiles;
pub mod statistics;
pub mod suite_manifest;
pub mod timer_calibration;
