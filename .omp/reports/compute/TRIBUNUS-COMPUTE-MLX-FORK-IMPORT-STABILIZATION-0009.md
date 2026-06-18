# TRIBUNUS-COMPUTE-MLX-FORK-IMPORT-STABILIZATION-0009 Report

## Files Changed
- `packages/compute-native/Cargo.toml`: Migrated to path dependencies and added `stub-backend`.
- `packages/compute-native/compute-core/Cargo.toml`: Added `stub-backend` and `mlx-backend` features.
- `packages/compute-native/compute-core/src/lib.rs`: Updated compile error gates.
- `packages/compute-native/DEPENDENCY_LINKAGE.md`: New documentation for the dependency chain.
- `packages/mlx-rs-fork/mlx-rs/src/lib.rs`: Implemented comprehensive stub backend.
- `packages/mlx-rs-fork/mlx-sys/build.rs`: Added support for skipping C++ build in stub mode.
- `packages/mlx-rs-fork/mlx-rs/Cargo.toml`, `packages/mlx-rs-fork/mlx-sys/Cargo.toml`: Added `stub` feature.

## Dependency Chain Discovered
1. `tribunus-compute-native` -> `mlx-rs` (path)
2. `tribunus-compute-core` -> `mlx-rs` (path), `mlx-sys` (path)
3. `mlx-rs` -> `mlx-sys` (path)
4. `mlx-sys` -> `mlx-c` (source)
5. `mlx-c` -> Upstream MLX (CMake FetchContent)

## Build Modes Implemented & Verified
- **Mode A (Stub)**: `cargo check -p tribunus-compute-core` - **PASS** (reproducible anywhere)
- **Mode B (Full)**: `cargo check -p tribunus-compute-core --no-default-features --features mlx-backend` - **FAIL** as expected (missing Metal toolchain after 152s)
- **Mode C (C ABI)**: `cmake -DMLX_BUILD_METAL=OFF` - **PASS** (reproducible configuration)

## Platform Limitations
- Full MLX mode requires a valid macOS SDK and Metal toolchain.
- Linux environments must use Mode A (Stub) for compilation verification.

## Residual Risks
- The `stub` backend provides dummy types that will panic or error if called at runtime. It is strictly for compilation and metadata validation.
- Submodule synchronization requires recursive initialization (`--recursive`).

## Issue Status
Issue #27 (Compute compilation) can be closed after this PR lands, as it establishes the definitive stable import boundary for the fork stack.
