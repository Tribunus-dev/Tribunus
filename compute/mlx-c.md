## Overview

`mlx-c` is the C API layer for Apple's MLX framework, providing a stable FFI boundary between the C++ core MLX runtime and language bindings. The Tribunus fork includes macOS 26.5 compatibility patches and minor API adjustments for the ComputeImage pipeline.

## Relationship to Upstream

Upstream `mlx-c` (apple/mlx-c) exposes the MLX C++ runtime through a C API that can be consumed by Rust (via `mlx-sys` and bindgen), Swift, and other languages. The Tribunus fork:

- Preserves the upstream C API surface for compatibility with the `mlx-sys` bindings
- Adds macOS 26.5 build compatibility (Metal 4 API changes, new SDK headers)
- Patches evaluation scheduling entry points for compute image integration
- Exposes IOSurface memory management hooks

## macOS 26.5 Patches

The 26.5 SDK introduces several changes that require patches to the upstream mlx-c:

- **Metal 4 API updates:** `MTL4CommandAllocator` replaces certain command buffer patterns; `MTLStorageMode` constants and behavior changes
- **Header compatibility:** Updated `Metal/Metal.h` and `Foundation/Foundation.h` patterns
- **Compiler flags:** Adjusted for the updated Apple Clang shipped with Xcode 26.5

## Rust Integration

`mlx-sys` consumes the `mlx-c` headers through `bindgen` to generate Rust FFI bindings:

```rust
// mlx-sys/src/lib.rs
include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
```

The generated bindings provide raw `extern "C"` functions for all MLX operations, wrapped by the safe `mlx-rs` API layer.

## Build Configuration

The MLX C library is built alongside the Tribunus workspace. Build configuration for mlx-c is handled through:

| Option | Description |
|---|---|
| `MLX_BUILD_METAL` | Enable Metal GPU support (default on macOS) |
| `MLX_BUILD_ACCELERATE` | Enable Accelerate framework (default on macOS) |
| `MLX_USE_IOSURFACE` | Enable IOSurface memory (Tribunus extension) |

## Versioning

`mlx-sys` follows the versioning of `mlx-c`, as the API surface is generated from the C headers. The main `mlx-rs` crate follows MLX versioning so users can see which MLX version is used under the hood.