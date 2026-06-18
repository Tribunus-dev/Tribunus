# TRIBUNUS-CODEQL-C-CPP-SCOPE-CONTROL-0013 Report

## Current Workflow Behavior
- Prior to repair, the CodeQL workflow used a strategy matrix that relied on implicit autodetection for languages including `c-cpp`.
- The `c-cpp` scan frequently failed due to missing build systems (`autobuild` failure) or "no source code seen" errors in the monorepo context.

## Failing CodeQL Signature
```
[error] The build failed.
[error] autobuild failed for c-cpp
[error] No source code was seen during build.
```

## Chosen Policy
- **Explicit Scoping**: The CodeQL workflow now uses an explicit language matrix excluding `c-cpp`.
- **Manual C/C++ Lane**: C/C++ analysis is formally deferred until a dedicated manual C ABI stub build lane is available in the MLX fork stack.
- **Language Coverage**: `actions`, `javascript-typescript`, `python`, and `rust` remain actively monitored.

## Files Changed
- `.github/workflows/codeql.yml`: Updated strategy matrix and added deferral note.

## Final Report
- **Commands Run**: Verified YAML syntax, updated workflow, verified PR status.
- **CI Result**: Pending rerun, but the configuration change ensures the problematic `c-cpp` job is not required.
- **Residual Risks**: C/C++ security analysis is currently disabled; tracking via future hardening mission is required once MLX fork ABI is stabilized.

## Issue Status
- **Issue #29**: Closed. Policy defined and implemented.
- **Command Center #26**: Updated.
