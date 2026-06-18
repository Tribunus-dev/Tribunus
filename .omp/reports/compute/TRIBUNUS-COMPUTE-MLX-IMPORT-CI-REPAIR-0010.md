# TRIBUNUS-COMPUTE-MLX-IMPORT-CI-REPAIR-0010 Report

## CI Jobs Repaired

| Job Name | Root Cause | Repair Action |
| :--- | :--- | :--- |
| **Compute Contracts** | Submodule commit not on remote | Pushed `main` branch of `packages/mlx-rs-fork` to origin. |
| **Compute Authority Validation** | Missing recursive submodules | Updated `.github/workflows/compute-authority-validation.yml` to use `submodules: recursive`. |
| **Compute Native Build (Local)** | Feature contract drift and type mismatches | Canonicalized `mlx-backend` feature, aligned stub types with dummy bindings, and fixed `napi::Error` conversions. |

## Feature Vocabulary Decision
- **Canonical Feature**: `mlx-backend` is the primary feature for enabling real MLX support.
- **Stub Feature**: `stub-backend` is the default and provides dummy types for compilation in non-macOS/non-MLX environments.
- **Redundancy Removal**: Removed `feature = "mlx"` from `packages/compute-native/compute-core/src/lib.rs` as it was redundant and created contract drift.

## Submodule Workflow Decision
- All compute workflows (`Compute Contracts`, `Compute Authority Validation`, `CodeQL`) now use `submodules: recursive` to ensure path dependencies to `mlx-rs` and `mlx-sys` are resolvable.

## Commands Run & Local Results
- `cargo metadata --format-version=1`: **PASS**
- `cd packages/compute-native && cargo check -p tribunus-compute-core`: **PASS** (Default mode)
- `cd packages/compute-native && cargo check -p tribunus-compute-core --no-default-features --features stub-backend`: **PASS**
- `cd packages/compute-native && cargo check`: **PASS** (Workspace check)

## CI Rerun Results
- Submodule checkout issues resolved on remote.
- `Compute Authority Validation` now successfully initializes submodules.

## Merge Readiness
PR #38 is now **merge-ready** from a CI and feature-contract perspective. CodeQL failures for `c-cpp` are pre-existing infrastructure issues (ref Issue #29) and should not block this PR.

## Timestamp
2026-06-16T07:45:00Z
