# TRIBUNUS-RUNTIME-TYPECHECK-RECOVERY-0003 Classification Report

## Initial reproduced failing command:
`bun turbo typecheck --filter=@tribunus/runtime`

## Error Classification

| Error Location | Bucket | Summary |
| :--- | :--- | :--- |
| `src/control-plane/workspace.ts:513` | 1. Effect API migration | `FiberMap.run` returns `Effect<Fiber<void, SyncLoopError>, never, R>`, which is being yielded in a `gen` context without being an iterator or correctly piped. |
| `src/control-plane/workspace.ts:516` | 1. Effect API migration | Overload mismatch in `FiberMap.run` call due to `SyncLoopError` type incompatibility (likely `SyncLoopError` vs `unknown`). |
| `src/coordination/recovery.ts:630` | 2. Recovery state/type narrowing | Mismatch between `RecoveryReceipt` local interface and `DurableStore.recordRecoveryReceipt` input schema. |

## Detailed Analysis

### src/control-plane/workspace.ts
- **Problem**: `FiberMap.run` (Effect v4) returns an `Effect` that isn't compatible with the generator `yield*` if the error channel isn't aligned or if the method signature changed in a way that requires specific iterator handling.
- **Decision**: Align `SyncLoopError` types and ensure `FiberMap.run` is used correctly with the latest Effect v4 `FiberMap` API.

### src/coordination/recovery.ts
- **Problem**: The `persistRecoveryReceipt` method attempts to pass `RecoveryReceipt` fields to `store.recordRecoveryReceipt`, but the property names (`recoveredBy` vs `recoveredByConsumer`) and the `action` type mismatch.
- **Decision**: Standardize `RecoveryReceipt` property names to match `DurableStore` input types and import `RecoveryAction` from the SQL definitions to avoid `any` casts and type mismatches.

## Next Actions
1. Fix type-only import/export drift in `src/control-plane/workspace.ts`.
2. Fix `RecoveryReceipt` interface and `persistRecoveryReceipt` in `src/coordination/recovery.ts`.
3. Fix `FiberMap.run` usage in `src/control-plane/workspace.ts`.
