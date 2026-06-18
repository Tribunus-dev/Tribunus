# TRIBUNUS-RUNTIME-TODO-PR39-DECOMPOSITION-0018 Inventory

## PR #39 File Inventory

| File | Subsystem | Risk | Classification |
| :--- | :--- | :--- | :--- |
| `*.patch`, `*.cjs`, `*.orig`, `*.rej` | Build/Gen | High | Generated Junk/Patch |
| `packages/runtime/src/agent/agent.ts` | Agent | High | Refactor/Split |
| `packages/runtime/src/control-plane/migrate.ts` | Migration | Medium | Migration tool wiring |
| `packages/runtime/src/coordination/recovery.ts` | Coordination | High | Conflict with PR #37 |
| `packages/runtime/src/coordination/valkey-fabric.ts` | Coordination | High | Valkey injection |
| `packages/runtime/src/coordination/work-queue.ts` | Coordination | High | Valkey injection |
| `packages/runtime/src/provider/provider.ts` | Provider | High | OAuth decoupling |
| `packages/runtime/src/tool/registry.ts` | Tooling | Medium | Tool registry |

## Summary of Findings
PR #39 contains a mix of actual product code, patch artifacts, build artifacts (`.orig`, `.rej`), and helper scripts (`.cjs`). The coordination logic (`recovery.ts`, `valkey-fabric.ts`, `work-queue.ts`) is heavily modified, which conflicts conceptually and structurally with the recently landed PR #37 (Coordination Recovery). This PR is unfit for merge in its current state.
