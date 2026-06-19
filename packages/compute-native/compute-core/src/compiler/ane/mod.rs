//! ANE legality and artifact modeling — Mission 0010.
//!
//! Evaluates scheduled regions against Orion-derived ANE restrictions
//! without invoking `_ANECompiler`. Produces legality receipts,
//! rewrite suggestions, and derived artifact plans.

pub mod artifacts;
pub mod legality;
pub mod rules;

#[cfg(test)]
mod tests;
