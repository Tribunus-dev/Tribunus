//! Transformer slice reference harness.
//!
//! Creates the deterministic model-slice fixture that all current integration
//! work can share. Known transformed weights, fixed token/hidden-state inputs,
//! expected intermediate outputs per stage, numerical tolerances by stage,
//! and a pure-Rust CPU reference path.

pub mod fixture;
pub mod reference;
