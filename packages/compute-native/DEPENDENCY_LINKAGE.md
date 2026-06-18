<<<<<<< HEAD
# Compute Dependency Linkage

This document establishes the authoritative dependency chain for the Tribunus Compute Kernel and the forked MLX stack.

## Dependency Chain
1. **Tribunus Compute Native** (`packages/compute-native`)
   - High-level Rust/napi-rs bridge.
   - Depends on `mlx-rs` (path dependency to `packages/mlx-rs-fork/mlx-rs`).
   - Depends on `tribunus-compute-core` (path dependency to `compute-core`).

2. **Tribunus Compute Core** (`packages/compute-native/compute-core`)
   - Core compute logic and inference engine.
   - Depends on `mlx-rs` (path dependency to `packages/mlx-rs-fork/mlx-rs`).
   - Depends on `mlx-sys` (path dependency to `packages/mlx-rs-fork/mlx-sys`).

3. **mlx-rs-fork** (`packages/mlx-rs-fork/mlx-rs`)
   - Idiomatic Rust bindings for MLX.
   - Depends on `mlx-sys` (path dependency to `../mlx-sys`).

4. **mlx-sys-fork** (`packages/mlx-rs-fork/mlx-sys`)
   - Low-level C bindings generated via `bindgen`.
   - Contains `mlx-c` source code in `src/mlx-c`.
   - Build script (`build.rs`) invokes CMake to compile `mlx-c`.

5. **mlx-c-fork** (`packages/mlx-rs-fork/mlx-sys/src/mlx-c`)
   - C ABI layer for the MLX framework.
   - Uses CMake FetchContent to download upstream MLX core.

## Supported Build Modes

### Mode A: Stub / No-Backend (Default)
Compiles Tribunus compute code without requiring MLX C++ libraries, Metal, or Accelerate. Ideal for Linux CI, metadata validation, and non-macOS development.

**Verification:**
```bash
cd packages/compute-native
cargo check -p tribunus-compute-core
```

### Mode B: Full Local macOS MLX
Enables the real MLX/Metal backend on Apple Silicon. Requires macOS SDK and Metal toolchain.

**Verification:**
```bash
cd packages/compute-native
cargo check -p tribunus-compute-core --no-default-features --features mlx-backend
```

### Mode C: C ABI Validation
Builds and tests the `mlx-c` layer independently.

**Verification:**
```bash
mkdir -p /tmp/mlx-c-build
cmake -S packages/mlx-rs-fork/mlx-sys/src/mlx-c -B /tmp/mlx-c-build -DMLX_BUILD_METAL=OFF -DMLX_C_BUILD_EXAMPLES=OFF
cmake --build /tmp/mlx-c-build
```

## Maintenance Doctrine
- **Path Dependencies Only**: All fork components MUST be linked via path dependencies within the monorepo to ensure reproducibility.
- **Feature Gating**: All computational backends MUST be behind feature gates. Default mode MUST be stub-compatible.
- **Authoritative Receipts**: Build scripts should emit version constants (`MLX_C_VERSION`, etc.) for auditability.
||||||| 0c7a5203b
=======
# Compute Dependency Linkage

This document describes how `packages/compute-native` links to MLX and its dependencies.

Note: Compute linkage is now guarded by the compute contract verifier and CI workflow.
>>>>>>> origin/jules/compute-ci-contract-ladder-0001-4696115538609188041
