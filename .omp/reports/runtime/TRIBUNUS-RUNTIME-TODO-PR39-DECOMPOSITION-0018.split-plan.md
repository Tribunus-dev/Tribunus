# TRIBUNUS-RUNTIME-TODO-PR39-DECOMPOSITION-0018 Split Plan

## PR #39 Decomposition Slices

| ID | Title | Scope | Status |
| :--- | :--- | :--- | :--- |
| **S1** | `refactor(runtime): message normalization` | `runtime/src/agent/agent.ts`, `registry.ts` | Valid |
| **S2** | `refactor(runtime): decouple provider OAuth` | `runtime/src/provider/provider.ts` | Valid |
| **S3** | `refactor(runtime): inject ValkeyRedis service` | `runtime/src/coordination/valkey-fabric.ts` | Valid |
| **S4** | `chore(runtime): wire migration tool` | `runtime/src/control-plane/migrate.ts` | Valid |
| **S5** | `hardening(runtime): align recovery persistence` | `runtime/src/coordination/recovery.ts` | CONFLICTS WITH #37 |
| **S6** | `fix(runtime): provider credential assignment` | `runtime/src/provider/provider.ts` | Valid |

## Conflict Analysis (vs PR #37)
- **Slice S5 (Recovery Persistence)**: Directly conflicts with the hardened coordination recovery logic landed in #37. The persistence strategy in #37 is authority-based (DurableStore/PGlite receipts), whereas #39 attempts ad-hoc persistence that would bypass or conflict with the established recovery state machine. **Action: Reject S5.**
- **Other Slices**: S1, S2, S3, S4, S6 remain conceptually valid, assuming they are rebased against `main` and don't introduce regression.
