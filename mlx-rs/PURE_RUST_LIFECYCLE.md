# Pure Rust Lifecycle Notes

## Build Hygiene Discovered

During the setup of the MLX Rust foundation for Tribunus Compute, we encountered an important build hygiene issue on Linux regarding half-precision floats (`f16` and `bf16`).

The generated `mlx_sys` bindings for C++ effectively hide or fail to properly declare the `float16_t` and `bfloat16_t` symbols outside of Apple platforms in standard GNU build configurations. When compiling `mlx-rs` without Apple acceleration dependencies (`metal`/`accelerate`), the FFI surface boundary throws unresolved type errors on these types.

### Target-Gated Resolution

To resolve this safely without hiding valid MLX execution errors behind panics on Apple Silicon (where Tribunus actually intends to orchestrate execution), we applied a precise target-gated resolution via `cfg-if`.

The `f16` and `bf16` functionality inside `mlx-rs` (specifically `ArrayElement`, `FromSliceElement`, `Guard`, and internal conversion factories) is preserved exclusively under the configuration:
```rust
#[cfg(any(target_os = "macos", target_os = "ios"))]
```

On Linux or pure metadata-validation runs, these types safely gracefully omit from the build structure entirely.

### Future Implications for Tribunus

Consequently, **half-precision models are deferred from the initial Tribunus foundation scope**. The `MlxBackendCapabilities` currently statically reports `DType::F32` as the sole foundational dtype capable of round-trip creation, mathematical computation, and verified readback to the host without platform-specific issues.
