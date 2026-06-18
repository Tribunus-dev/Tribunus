# TRIBUNUS-RUNTIME-COORDINATION-RECOVERY-0008 Discovery Report

## Current Recovery Entry Points
- `CoordinationRecovery.planRecovery()`: Inspects PGlite and Valkey to determine needed actions.
- `CoordinationRecovery.executeRecovery(plan)`: Re-enqueues work and reschedules from a plan.
- `CoordinationRecovery.recover()`: Orchestrates planning and execution.
- `CoordinationRecovery.reconcilePendingEntries()`: Safely acknowledges terminal entries found in PEL.
- `CoordinationRecovery.rebuildFromPGlite()`: Full rebuild of Valkey state from durable truth.
- `CoordinationRecovery.coldStartRebuildIfNeeded()`: Boot-time check for empty stream.

## Current Stubs or TODOs
- `planCoordinationRecovery` and `persistCoordinationRecoveryReceipt` are standalone stubs that throw errors; they need to be replaced by calls to the service or integrated better.
- `executeRecovery` uses `console.error` and lacks robust structured error reporting.
- The `terminalWork` field in `RecoveryPlan` is not yet fully utilized in the planner.

## Durable Receipt Schema
- `RecoveryReceipt` is defined in `recovery.ts` and `durable-store.ts`.
- It includes `id`, `workId`, `streamEntryId`, `action`, `recoveredBy`, `originalConsumer`, `recoveredAt`, `outcome`, and `reason`.
- Mission 0003 already aligned `recoveredBy` with `recoveredByConsumer` in the database layer.

## Valkey/Stream State Assumptions
- Relies on `ValkeyStreams` for XADD/XACK/XPENDING.
- Relies on `ValkeySortedSets` for scheduling.
- Assumes `DEFAULT_STREAM_NAME` and `DEFAULT_CONSUMER_GROUP`.

## Lifecycle States Involved
- `CoordinationRecoveryState`: `ready`, `coordination_unavailable`, `coordination_degraded`, `coordination_rebuilding`, `coordination_refused`.
- These are currently partially implemented in the service state.

## Existing Tests
- `packages/runtime/test/coordination/recovery.test.ts`: Currently skipped and tests stubs.
- `packages/runtime/test/coordination/work-queue.test.ts`: Tests general work queue behavior.

## Missing Tests
- Integration tests for rebuilding Valkey from PGlite records.
- Tests for blocking mutations while in `coordination_rebuilding` or `coordination_unavailable` states.
- Tests for deterministic state transitions under various divergence scenarios.

## Implementation Plan
1. **Types & Schema**: Complete `CoordinationRecoveryPlan` and `CoordinationRecoveryResult` to include detailed audit data (inspected, rebuilt, skipped, failed).
2. **Logic Hardening**:
   - Update `planRecovery` to include generation checks and unsafe work detection.
   - Update `executeRecovery` to return `CoordinationRecoveryResult` and write detailed receipts.
   - Ensure `rebuildFromPGlite` uses proper `CoordinationRecoveryResult`.
3. **Mutation Gates**:
   - Identify existing mutation gates in `packages/runtime/src/session/` or `tool/`.
   - Wire `CoordinationRecovery.getRecoveryState()` into these gates to block mutations when unsafe.
4. **Testing**:
   - Unskip and rewrite `recovery.test.ts` to use `CoordinationRecovery` service.
   - Add integration tests with a live/fake Redis and PGlite.
   - Add unit tests for the deterministic planning logic.
