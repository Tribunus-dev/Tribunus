# TRIBUNUS-MERGE-READINESS-AUDIT-0004 Report

## Executive Merge Order

1.  **PR #35**: `fix(runtime): restore clean typecheck verification`
    *   **Status**: PASS
    *   **Action**: MERGE IMMEDIATELY. This restores verification discipline for all subsequent merges.
2.  **PR #22**: `fix: resolve tribunus-compute-core compilation errors and warnings`
    *   **Status**: BLOCKED (Environment)
    *   **Action**: MERGE after #35 if CI passes. Local verification is blocked by missing Metal toolchain in the current `xcrun` context, but the changes correctly apply `#[cfg]` gates.
3.  **PR #23**: `feat(web): v2 design system foundation`
    *   **Status**: FAIL
    *   **Action**: REVISE. Build fails due to missing assets referenced in `packages/web/src/content/docs/nb/web.mdx`.
4.  **PR #24 & #25**: Astro/Cloudflare dependency bumps
    *   **Status**: DEFERRED
    *   **Action**: DEFER until #23 is merged and verified. Merging these now would cause lockfile conflicts and potentially introduce regressions in the v2 redesign.

---

## PR Audits

### PR #35: fix(runtime): restore clean typecheck verification
*   **Base**: `main` | **Head**: `chore/cross-repo-issue-control-0001`
*   **Mergeable**: Yes
*   **Issues**: Relates to #26, #31, #34
*   **Verification Commands**:
    ```bash
    bun turbo typecheck --filter=@tribunus/runtime
    bun typecheck
    ```
*   **Result**: PASS. All typechecks complete successfully. Pre-commit discipline is restored.
*   **Risk**: Low. Fixes existing type drift without behavioral changes.
*   **Recommendation**: Merge immediately.

### PR #22: fix: resolve tribunus-compute-core compilation errors and warnings
*   **Base**: `main` | **Head**: `fix-tribunus-compute-core-compilation-10062880358680675010`
*   **Mergeable**: Yes
*   **Issues**: Maps to #27
*   **Verification Commands**:
    ```bash
    cd packages/compute-native/compute-core
    cargo check
    cargo test
    ```
*   **Result**: BLOCKED by environment. Error: `xcrun: error: unable to find utility "metal"`. This appears to be a local toolchain configuration issue (macOS SDK/Command Line Tools mismatch).
*   **Risk**: Medium. Hard to verify locally without a working MLX build environment.
*   **Recommendation**: Merge if CI `unit (linux)` passes. The `#[cfg]` addition is architecturally correct for the requested feature gating.

### PR #23: feat(web): v2 design system foundation
*   **Base**: `main` | **Head**: `vibe/website-redesign-integration-ad8baf`
*   **Mergeable**: Yes (Git), No (Build)
*   **Issues**: Maps to #28
*   **Verification Commands**:
    ```bash
    cd packages/web
    bun install
    bun run build
    ```
*   **Result**: FAIL. Error: `Could not resolve "../../../assets/web/web-homepage-active-session.png" from "src/content/docs/nb/web.mdx"`.
*   **Risk**: High. Broken documentation assets block the build and deployment.
*   **Recommendation**: Revise. Recommend follow-up mission: `fix(web): resolve missing assets in Norwegian documentation` linked to #28.

### PR #24 & #25: @astrojs/cloudflare and astro dependency bumps
*   **Base**: `main` | **Head**: `dependabot/npm_and_yarn/packages/web/*`
*   **Mergeable**: Yes
*   **Issues**: Maps to #33
*   **Result**: DEFERRED. Conflicts with PR #23 changes in `packages/web/package.json` and `bun.lock`.
*   **Risk**: Medium. Version upgrades should be validated against the stable v2 foundation.
*   **Recommendation**: Defer and rebase onto `main` after #23 lands.

---

## Audit Metadata
*   **Timestamp**: 2026-06-16T05:25:00Z
*   **Commit SHA**: f519ed8b199e17cafdcd97f0962458a5256ee9a9
*   **Report Path**: `.omp/reports/merge-readiness/TRIBUNUS-MERGE-READINESS-AUDIT-0004.md`
