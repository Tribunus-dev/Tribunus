# Tribunus MLX Backend Foundation

This document explains the role of `mlx-rs-fork` as a foundational execution backend for Tribunus Compute.

## Role & Boundary

The primary objective of this fork is not to implement full model inference, tokenization, multi-user schedulers, or LLM chat servers. The goal is to act as a **stable, explicitly-typed, evidence-producing backend ABI** for Apple Silicon.

`mlx-rs-fork` answers:
> "What can MLX do safely, deterministically, and observably from Rust on this machine?"

Tribunus Compute answers:
> "Which model phase should run on MLX, under which policy, with which fallback, with which evidence?"

## Explicit Evaluation

MLX is natively a **lazy evaluation** framework. This means that invoking an operator wrapper only creates an intermediate graph, rather than immediately allocating and computing the final result. For conformance testing and Tribunus gate qualification, this behavior must be made observable.

Therefore, numerical tests and test examples *must* forcefully synchronize and evaluate before invoking numerical comparisons to correctly surface device failures and readback failures. See `backend::eval` helpers for explicit materialization patterns.

## Foundational Operator Surface

This minimal foundation explicitly qualifies the following operations:
- Identity
- Constant creation
- Add
- Multiply
- Matmul
- Reshape
- Transpose
- Sigmoid
- Softmax
- Composite SiLU (`x * sigmoid(x)`)

The exact capabilities mapping and runtime details can be explored locally using the example scripts.

## Classification & Capabilities

To expose errors systematically, failures mapped from `mlx-c` APIs are structured into the typed enum `MlxError`. These encompass shapes, ops, readbacks, evaluations, and boundary issues rather than arbitrary panic strings.
Operations natively untested, untested DTypes (such as `bf16`/`f16` in CI loops lacking MLX acceleration), and unsupported dimensions are reported clearly via JSON telemetry (`BackendConformanceRunner`).

### Deferred Features
- Canonical Capability JSON Hashing has been temporarily deferred in `v0`. Future adapters should hash `MlxBackendCapabilities` excluding volatile properties.

## Examples

To print the system capability schema:
```sh
cargo run --example backend_capabilities --features evidence
```

To run and emit the numerical conformance gate telemetry to stdout as `JSONL`:
```sh
cargo run --example backend_conformance --features evidence
```
