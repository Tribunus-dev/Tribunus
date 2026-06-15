# Tribunus Compute Dependency Linkage

---

## 1. Current Linkage

The canonical compute stack (`packages/compute-native`) currently resolves `mlx-rs` and `mlx-sys` through **Cargo git dependencies** from:

```
https://github.com/Tribunus-dev/mlx-rs-fork.git
```

**Workspace Dependencies (from `packages/compute-native/Cargo.toml`):**
```toml
[workspace.dependencies]
mlx-rs = { git = "https://github.com/Tribunus-dev/mlx-rs-fork.git", branch = "main", features = ["metal", "accelerate", "safetensors"] }
mlx-sys = { git = "https://github.com/Tribunus-dev/mlx-rs-fork.git", branch = "main" }
```

**Inheritance:**
- `packages/compute-native/compute-core` inherits `mlx-rs` and `mlx-sys` from the workspace and does not declare its own dependencies.

**Lockfile Commit (from `packages/compute-native/Cargo.lock`):**
- `mlx-rs`: `78f4fb16d0f36bc09dfc4196449b433884504d6d`
- `mlx-sys`: `78f4fb16d0f36bc09dfc4196449b433884504d6d`

---

## 2. Desired Future Linkage

The preferred future model is a **local path dependency** backed by a **git submodule** at:

```
packages/mlx-rs-fork
```

**Workspace Dependency Paths (from `packages/compute-native/Cargo.toml`):**
```toml
mlx-rs = { path = "../mlx-rs-fork/mlx-rs" }
mlx-sys = { path = "../mlx-rs-fork/mlx-sys" }
```

**Inheritance:**
- `compute-core` should **continue inheriting** `mlx-rs` and `mlx-sys` from workspace dependencies, **without duplicating** path dependencies in its own `Cargo.toml`.

---

## 3. Nested MLX-C Requirement

`mlx-rs-fork` requires its nested C binding source at:

```
mlx-sys/src/mlx-c
```

This is supplied by the **nested `mlx-c-fork` submodule** declared in `mlx-rs-fork/.gitmodules`:

```toml
[submodule "mlx-sys/src/mlx-c"]
    path = mlx-sys/src/mlx-c
    url = https://github.com/Tribunus-dev/mlx-c-fork.git
```

**Build Requirement:**
- Future `cargo build` or `cargo check` missions **must initialize submodules recursively** to ensure `mlx-c-fork` is present at `mlx-sys/src/mlx-c`.
- Both `cmake` (for building `mlx-c`) and `bindgen` (for generating Rust bindings) depend on this path.

---

## 4. Do Not Half-Add Submodules

**Explicit Warning:**
- Do **not** manually create `.gitmodules` without a corresponding Git submodule index entry.
- A `.gitmodules`-only patch is **misleading** and will not work for builds.
- Future submodule migration **must** use `git submodule add` (or equivalent Git operation) so that **both** `.gitmodules` and the submodule gitlink are created together.

---

## 5. Migration Result

The future migration gate `TRIBUNUS-COMPUTE-SUBMODULE-MIGRATION-0001` has now been implemented by this mission.

- `packages/mlx-rs-fork` is now a **real git submodule** (added via `git submodule add`).
- The submodule is pinned to commit `78f4fb16d0f36bc09dfc4196449b433884504d6d`.
- Nested `mlx-c-fork` is initialized recursively under `packages/mlx-rs-fork/mlx-sys/src/mlx-c`.
- Workspace dependencies in `packages/compute-native/Cargo.toml` now use **path dependencies** (`../mlx-rs-fork/mlx-rs` and `../mlx-rs-fork/mlx-sys`).
- `compute-core` continues inheriting `mlx-rs` and `mlx-sys` from workspace dependencies (no duplication in its `Cargo.toml`).
- `Cargo.lock` will be updated by Cargo if/when `cargo check` or `cargo build` is run (dependency linkage change requires lockfile regeneration).
- CI has been hardened to use `submodules: recursive` in `compute-authority-validation.yml`.

---

## 6. Rollback Plan

If this migration causes issues, rollback as follows:

1. Revert `.gitmodules`:
   ```bash
   git rm .gitmodules
   ```
2. Remove the submodule gitlink:
   ```bash
   git rm --cached packages/mlx-rs-fork
   rm -rf packages/mlx-rs-fork
   ```
3. Restore `Cargo.toml` git dependencies:
   ```bash
   git checkout packages/compute-native/Cargo.toml
   ```
4. Restore `Cargo.lock`:
   ```bash
   git checkout packages/compute-native/Cargo.lock
   ```
5. Verify rollback:
   ```bash
   cd packages/compute-native && cargo check
   ```

---

## 6. Rollback Plan

If the future migration (`TRIBUNUS-COMPUTE-SUBMODULE-MIGRATION-0001`) fails or causes issues, rollback as follows:

1. Revert `.gitmodules`:
   ```bash
   git rm .gitmodules
   ```
2. Remove the submodule gitlink:
   ```bash
   git rm --cached packages/mlx-rs-fork
   rm -rf packages/mlx-rs-fork
   ```
3. Restore `Cargo.toml` git dependencies:
   ```bash
   git checkout packages/compute-native/Cargo.toml
   ```
4. Restore `Cargo.lock`:
   ```bash
   git checkout packages/compute-native/Cargo.lock
   ```
5. Verify rollback:
   ```bash
   cd packages/compute-native && cargo check
   ```
