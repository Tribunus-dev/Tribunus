# Title: fix(compute-core): restore clean compilation and feature-gated adapter boundaries
# Lane: compute
# Kind: bug
# Severity: high
# Owner Type: codex

## Context
The `compute-core` package requires modularity for its storage adapters, which are currently optional dependencies. Recent changes have caused drift in the `Cargo.toml` feature gating, potentially leading to build failures or unexpected dependency inclusion.

## Problem Statement
`packages/compute-native/compute-core/Cargo.toml` defines `storage-adapters` as an optional feature pulling in `tokio-postgres`, `redis`, and `duckdb`. There is a risk of these dependencies being included in default builds or causing compilation issues due to missing feature flags in dependent crates or CI workflows.

## Non-goals
- Do not refactor the storage adapter architecture beyond fixing the feature-gating mechanism.
- Do not migrate existing test logic in `benches/` or `tests/`.

## Implementation Notes
1. Verify `[features]` configuration in `Cargo.toml` ensuring `default = []` strictly omits `storage-adapters`.
2. Audit `src/` to ensure any code accessing `tokio-postgres`, `redis`, or `duckdb` is strictly wrapped in `#[cfg(feature = "storage-adapters")]`.
3. Reference open PR #22 for ongoing adapter improvements.

## Acceptance Criteria
- `cargo check --no-default-features` completes without pulling in `storage-adapters` dependencies.
- `cargo check --features storage-adapters` confirms all storage components are available.
- No `cfg` warnings remain in `compute-core` during standard build.

## Verification Commands
```bash
cd packages/compute-native/compute-core
cargo check --no-default-features
cargo check --features storage-adapters
cargo build --release
```

## Related PRs
- #22: Ongoing storage adapter improvements.

## Rollback Notes
- Revert changes to `Cargo.toml` and explicit `#[cfg]` wrappers in `src/`.
