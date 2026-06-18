# TRIBUNUS-COMPUTE-MLX-IMPORT-CI-REPAIR-0010 CI Failure Analysis

## Summary of Failing Jobs

| Job Name | Failure Classification | Root Cause |
| :--- | :--- | :--- |
| **Compute Contracts** | Submodule checkout failure | Submodule commit `4f0c9ff` not found on remote. Direct fetching of that commit failed. |
| **Compute Authority Validation** | Workflow missing recursive submodules | The workflow uses `actions/checkout@v4` but does not specify `submodules: recursive`. Since the code now depends on `mlx-rs` via path dependency, compilation fails without the submodule. |
| **CodeQL** | Unrelated pre-existing failure | The `Analyze (c-cpp)` job fails likely due to lack of compilation database for C++ components. This is a known repo-level issue (ref Issue #29). |

## Detailed Breakdown

### Compute Contracts
- **Log ID**: `27601004270`
- **Error**: `fatal: remote error: upload-pack: not our ref 4f0c9ff7334e4e5e51167ba96125e808794dfebc`
- **Analysis**: The submodule pointer in the Tribunus repo points to a commit that exists locally but was never successfully pushed to the `mlx-rs-fork` remote.

### Compute Authority Validation
- **Log ID**: `27601004305`
- **Error**: `Build Authority Subset` failed with exit code 101.
- **Analysis**: The job `Compute Authority Subset (Apple Silicon)` uses `macos-15` but skips submodule initialization (`submodules: false`). Because `Cargo.toml` specifies `mlx-rs` and `mlx-sys` as path dependencies (`../mlx-rs-fork/...`), `cargo check` and `cargo test` fail immediately when the paths are empty.

## Repair Plan

1.  **Push Submodule Changes**: Push the `main` branch of `packages/mlx-rs-fork` to its remote `https://github.com/Tribunus-dev/mlx-rs-fork.git`.
2.  **Update Workflows**:
    - Add `submodules: recursive` to `Compute Authority Validation` workflow.
3.  **Canonicalize Features**:
    - Remove `feature = "mlx"` references in favor of `mlx-backend` or `stub-backend`.
    - Ensure `stub-backend` is strictly honored and doesn't trigger C++ toolchain requirements.
4.  **Verify DEPENDENCY_LINKAGE.md**:
    - Ensure Mode C uses the correct CMake flags (`MLX_C_ENABLE_MLX_BACKEND` or similar if discovered).
