# TRIBUNUS-COMPUTE-MLX-FORK-IMPORT-STABILIZATION-0009 Discovery Report

## Dependency Chain Mapping
- **Crate/Package Importing mlx-rs-fork**: `tribunus-compute-native` (at `packages/compute-native`) and `tribunus-compute-core` (at `packages/compute-native/compute-core`).
- **Import Mechanism**: Currently imported via **Git dependency** in the workspace `Cargo.toml` (`https://github.com/Tribunus-dev/mlx-rs-fork.git`).
- **mlx-rs-fork -> mlx-c-fork Linkage**: `mlx-sys` (part of the `mlx-rs-fork` repo) contains `mlx-c` source code in `mlx-sys/src/mlx-c`.
- **mlx-c-fork -> Upstream MLX Linkage**: `mlx-c` uses **CMake FetchContent** to download upstream MLX core.
- **First Failing Command**: `cargo check -p tribunus-compute-core` (within `packages/compute-native`).
- **Failure Type**: `mlx-sys` build script failure (panic in `cmake` crate).
- **Platform Specificity**: Fails on macOS when the Metal toolchain is not found by `xcrun`. It will likely fail on Linux CI as well if it attempts to build MLX with Metal/Accelerate unconditionally.
- **Backend Requirements**: `metal` and `accelerate` features are currently enabled in the workspace dependencies for `mlx-rs`.

## Reproduction Details
- **Command**: `cd packages/compute-native && cargo check -p tribunus-compute-core`
- **Log**: `xcrun: error: unable to find utility "metal", not a developer tool or in PATH`
- **Location**: `mlx-sys` build script invoking CMake build for `mlx-c`.

## Classification
- **Bucket**: 8. Metal/macOS-only backend accidentally required (on macOS without toolchain or on Linux).
- **Secondary Bucket**: 5. build.rs invokes CMake unconditionally/incorrectly.

## Feature Gate Inventory
- **Enabled**: `metal`, `accelerate`, `safetensors` (in `packages/compute-native/Cargo.toml`).
- **Missing**: A clear `stub-backend` or `no-mlx` mode that prevents the `mlx-sys` build script from attempting to compile the C++ core.

## Implementation Plan
1. **Local Fork Migration**: Convert Git dependencies to **path dependencies** targeting submodules in `packages/mlx-rs-fork`.
2. **Submodule Setup**: Add `mlx-rs-fork` as a submodule. Verify it has `mlx-c` and its own submodule/FetchContent setup.
3. **Build Mode A (Stub)**:
   - Introduce a `mlx-backend` feature in Tribunus compute crates.
   - Update `mlx-rs` and `mlx-sys` (in the fork) to support a no-op build if the backend feature is disabled.
   - Ensure `build.rs` in `mlx-sys` skips CMake if requested.
4. **Build Mode B (Full)**: Ensure macOS developers with the right toolchain can still enable `mlx-backend`.
5. **Verification**: Run the matrix on the new path-based setup.
