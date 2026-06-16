# Title: hardening(runtime): implement coordination recovery stubs with durable receipt semantics
# Lane: runtime
# Kind: hardening
# Severity: high
# Owner Type: runtime

## Context
The coordination layer uses PGlite for durable state and Valkey as the high-speed fabric. In the event of coordination failure, the recovery workflow must be idempotent and verifiable to prevent split-brain scenarios or invalid state mutations during a rebuild.

## Problem Statement
`packages/runtime/src/coordination/recovery.ts` currently contains placeholders that lack formal receipt semantics. We need to implement durable receipt generation that records:
1. Rebuild start/end timestamps.
2. Source state snapshots from PGlite.
3. Target state synchronization in Valkey.

## Non-goals
- Do not replace the existing PGlite/Valkey architecture.
- Do not expose recovery mutations to unauthorized API callers.

## Implementation Notes
1. Target `packages/runtime/src/coordination/recovery.ts`.
2. Introduce a `RecoveryReceipt` type that implements cryptographic signing or sequencing to ensure receipt uniqueness.
3. Stub the actual persistence logic to use a dedicated PGlite table/bucket.
4. Ensure `setRecoveryStatus` in `recovery.ts` remains gated to prevent mutating actions while `coordination_rebuilding` is true.

## Acceptance Criteria
- `CoordinationRecovery` service supports formal receipt generation.
- Rebuild operations check and enforce system state guards to prevent mutations during recovery.
- Stub implementation provides type-safe boundaries for future implementation of actual Valkey/PGlite synchronization.

## Verification Commands
```bash
# Typecheck the runtime coordination package
cd packages/runtime
npm run build # or equivalent build command for the package
```

## Related PRs
- None currently, tracking foundational hardening.

## Rollback Notes
- Revert stubs in `packages/runtime/src/coordination/recovery.ts` to their previous state.
