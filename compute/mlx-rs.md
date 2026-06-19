## Overview

`mlx-rs` provides Rust bindings for Apple's MLX array framework. The Tribunus fork extends the upstream oxideai/mlx-rs project with a memory module, quantization API, and backend conformance gate that are foundational to the ComputeImage pipeline.

## Relationship to Upstream

Upstream `mlx-rs` (oxideai/mlx-rs, v0.21.x) provides safe, idiomatic Rust bindings to the MLX C API via the `mlx-sys` crate. The Tribunus fork preserves the upstream API surface while adding Tribunus-specific extensions:

- **Shared:** Core array operations (matmul, reshape, transpose, softmax, sigmoid), lazy evaluation model, Metal/Accelerate feature flags
- **Added by Tribunus:** Memory module with IOSurface integration, typed quantization API, backend conformance runner, explicit evaluation helpers

## Tribunus Extensions

### Memory Module

The memory module provides IOSurface-backed allocation for zero-copy sharing with Core ML and the GPU. This enables the SharedMemoryIsland arena runtime:

- `IOSurfaceBuffer` — wraps an IOSurface as an MLX-compatible memory backing
- `ArenaAllocator` — ring-buffer page allocator with generation counter
- `SharedTensor` — tensor view backed by externally-managed IOSurface memory

### Quantization API

A typed quantization API for in-flight KV cache compression:

- **TurboQuant:** sub-2-bit quantization with SIMD-Blake3 validation
- **Per-group quantization:** configurable group sizes with min/max/scale/zero-point
- **Dequantization:** on-the-fly dequantization during attention computation

### Backend Conformance

The `BackendConformanceRunner` provides JSON telemetry output for verifying backend capabilities:

- Operator coverage matrix per dtype
- Latency benchmarks per shape class
- Numerical correctness gate against reference implementations
- Error classification via typed `MlxError` enum

## Building

```toml
[dependencies]
mlx-rs = { git = "https://github.com/Tribunus-dev/Tribunus", package = "mlx-rs" }
```

Feature flags:
- `metal` — enables Metal GPU execution
- `accelerate` — enables Accelerate framework integration
- `evidence` — enables backend conformance runner and telemetry

## Half-Precision Support

FP16 and BF16 support is target-gated to Apple Silicon (`cfg(target_os = "macos")`) due to C++ FFI symbol availability on Linux. On Apple Silicon, all standard dtypes are supported for round-trip creation, computation, and verified readback.