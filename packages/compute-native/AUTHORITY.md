# Tribunus Compute Authority

---

## 1. Canonical Tree

The **canonical compute implementation** for Tribunus currently lives in:

```
packages/compute-native
```

This directory contains:
- The `tribunus-compute-native` crate (NAPI-based MLX backend).
- The `tribunus-compute-core` crate (`packages/compute-native/compute-core`), which includes:
  - Canonical compute-core runtime.
  - Runtime contracts and backend conformance tests.
  - Compatibility gates (e.g., `tribunus-mlx-compatibility-gate`).
  - Evidence-producing binaries (e.g., `tribunus-compute-image`, `tribunus-compute-gap-report`).

---

## 2. Reference Tree

The standalone repository:

```
Tribunus-Compute
```

is currently treated as a **reference/staging tree**, not the canonical implementation.

Useful pieces from `Tribunus-Compute` (e.g., submodule-based dependency linkage, CI workflows, or specific modules) may be ported into the canonical tree **after review** and with accompanying tests/receipts.

---

## 3. Why This Tree Is Canonical

The authority decision is based on the following concrete evidence from the `TRIBUNUS-COMPUTE-AUTHORITY-DIFF-0001` analysis:

1. **Broader Module Inventory**:
   - Contains explicit backend contracts (`backend/mod.rs`, `runtime_contract.rs`).
   - Includes decode attribution (`decode_attribution/`), storage adapters (`storage_adapters/`), and compiler modules (`compiler/`).
   - Has 10+ binaries for debugging, profiling, and compatibility (e.g., `tribunus-mlx-compatibility-gate`, `tribunus-compute-image`).

2. **More Runtime/Test Gates**:
   - 11 test targets covering backend conformance, pipeline parity, MLX accelerate smoke, Core ML lifecycle, and three-backend conformance.
   - Optimization records (`OPT-0000-NEON-ORACLE.json`, `OPT-0006A-AUTHORIZATION.json`) and compute-core-suite-hygiene evidence.

3. **Compatibility Binaries**:
   - Includes `tribunus-mlx-compatibility-gate` and other compatibility validation tools.

4. **ADR-0019 Alignment**:
   - ADR-0019 (`docs/adr/0019-compute-kernel.v1.json`) explicitly frames the Tribunus compute stack as the bootstrap gate for MLX backend, with next steps (correctness, lifetime, copy-honesty) targeting this repo.

5. **Compute-Core Evidence**:
   - Contains `evidence/compute-core-suite-hygiene/` and `packages/compute-native/optimization-records/`.

---

## 4. Current Known Gap

The canonical tree (`packages/compute-native`) **previously had** weaker dependency pinning/linkage to `mlx-rs-fork` than `Tribunus-Compute`:
- It used **git dependencies** (`git = "https://github.com/Tribunus-dev/mlx-rs-fork.git", branch = "main"`) for `mlx-rs` and `mlx-sys`.
- `Tribunus-Compute` uses **path dependencies** (`path = "../mlx-rs-fork/mlx-rs"`) with `mlx-rs-fork` vendored as a submodule.

This gap has now been resolved by `TRIBUNUS-COMPUTE-SUBMODULE-MIGRATION-AND-CI-0001` (see [DEPENDENCY_LINKAGE.md](./DEPENDENCY_LINKAGE.md) for details).

Do not attempt to revert this migration without following the rollback plan in `DEPENDENCY_LINKAGE.md`.

---

## 5. Rules for Future Agents

1. **Canonicality**:
   - Do not treat `Tribunus-Compute` as canonical unless a later authority document **explicitly supersedes** this one.

2. **Code Porting**:
   - Do not port code from `Tribunus-Compute` into the canonical tree **without preserving or adding tests/receipts** in `packages/compute-native`.

3. **Dependency Linkage**:
   - Do not change MLX dependency linkage (e.g., `Cargo.toml` git/path dependencies), submodules (`.gitmodules`), or lockfiles (`Cargo.lock`) as part of authority-marker work.

4. **Gate Discipline**:
   - Prefer **small gates with mechanical verification** (e.g., `cargo check`, `cargo test`) over broad compute rewrites.
