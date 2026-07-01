# Core ML Operation Coverage Matrix

Baseline as of 2026-06-21. All operation families start at **not yet**
across compiler emission, loader admission, engine execution, and receipt
provenance. This document tracks coverage expansion over time.

## Status Key

| Symbol | Meaning |
|--------|---------|
| &check; | Implemented and passing |
| &cross; | Not yet implemented |
| &ndash; | Not applicable |

## Matrix

| # | Operation Family | Compiler Emitted | Loader Admitted | Engine Executed | Receipt Proven | Known Limitations |
|---|------------------|:----------------:|:---------------:|:---------------:|:---------------:|-------------------|
| 1 | Identity | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 2 | Constant-heavy | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 3 | Linear | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 4 | RMSNorm | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 5 | LayerNorm | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 6 | GELU | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 7 | SiLU composite | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 8 | Softmax tail | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 9 | Branch-rejoin | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 10 | Reshape-transpose-matmul | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 11 | Multi-output | &cross; | &cross; | &cross; | &cross; | None yet identified |
| 12 | State read/write | &cross; | &cross; | &cross; | &cross; | None yet identified |

## Pipeline Stages

Each column maps to a pipeline stage in the Core ML compilation path:

- **Compiler Emitted** — the operation family is emitted by the compiler
  (in `compiler/lowering/coreml.rs`) as a valid Core ML model program.
- **Loader Admitted** — the loader (`coreml_pipeline.rs`) admits the
  compiled model program and registers it with the cache.
- **Engine Executed** — the engine (`coreml_bridge.rs` /
  `coreml_exec.mm`) successfully executes the compiled model and
  produces correct output tensors.
- **Receipt Proven** — the execution produces a valid evidence receipt
  ([`EvidenceIngestionResult`]) with correct route origin, provenance
  linkage, and checksum, passing the admission gate.

[`EvidenceIngestionResult`]: ../../packages/compute-native/compute-core/src/placement/evidence_ingestion.rs

## Scope

The matrix covers operation families that appear in production-quality
transformer inference graphs (decoder, cross-attention, FFN, embedding)
as routed to the Core ML backend via the graph executor's heterogeneous
dispatch.
