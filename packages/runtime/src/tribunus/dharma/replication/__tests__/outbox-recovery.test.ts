/**
 * Outbox Crash Recovery Tests
 *
 * Tests for recoverOutbox and getOutboxState functions.
 */

import { describe, test, expect } from "bun:test"
import { OutboxManager } from "../outbox"
import { recoverOutbox, getOutboxState } from "../outbox-recovery"
import type { DharmaEventEnvelope } from "../../types"

// ── Helpers ------------------------------------------------------------------

function makeTestEvent(overrides?: Partial<DharmaEventEnvelope>): DharmaEventEnvelope {
  const defaults: DharmaEventEnvelope = {
    eventId: crypto.randomUUID(),
    federationId: "test-recovery-fed",
    eventType: "federation.genesis",
    schemaVersion: 1,
    actorPublicKey: "test-key",
    actorDeviceId: null,
    createdAt: new Date().toISOString(),
    logicalClock: 0,
    causalParents: [],
    payloadHash: "",
    payload: { test: true },
    signature: "test-sig",
  }
  return { ...defaults, ...overrides }
}

function createReadyEntry(manager: OutboxManager): string {
  const entry = manager.createEntry(makeTestEvent())
  manager.markReady(entry.outboxId)
  return entry.outboxId
}

function createRetryWaitEntry(manager: OutboxManager): string {
  const entry = manager.createEntry(makeTestEvent())
  manager.markReady(entry.outboxId)
  manager.markAppending(entry.outboxId)
  manager.scheduleRetry(entry.outboxId, "connection lost", 0)
  return entry.outboxId
}

function createCompletedEntry(manager: OutboxManager): string {
  const entry = manager.createEntry(makeTestEvent())
  manager.markReady(entry.outboxId)
  manager.markAppending(entry.outboxId)
  manager.markAppended(entry.outboxId, 1, "writer-key")
  manager.markObserved(entry.outboxId)
  manager.markComplete(entry.outboxId)
  return entry.outboxId
}

function createFailedEntry(manager: OutboxManager): string {
  const entry = manager.createEntry(makeTestEvent())
  manager.markReady(entry.outboxId)
  manager.markAppending(entry.outboxId)
  manager.scheduleRetry(entry.outboxId, "error", 0)
  manager.markFailed(entry.outboxId, "max retries exceeded")
  return entry.outboxId
}

// ── Tests: recoverOutbox -----------------------------------------------------

describe("recoverOutbox", () => {
  const federationId = "test-recovery-fed"

  test("returns recovered=false when no pending entries", () => {
    const manager = new OutboxManager(federationId)
    const result = recoverOutbox(manager)

    expect(result.recovered).toBe(false)
    expect(result.pendingEntries).toBe(0)
    expect(result.retriedEntries).toBe(0)
    expect(result.failedEntries).toBe(0)
    expect(result.recoveredAt).toBeDefined()
  })

  test("processes ready entries without retrying them", () => {
    const manager = new OutboxManager(federationId)
    createReadyEntry(manager)
    createReadyEntry(manager)

    const result = recoverOutbox(manager)

    // Ready entries are already pending — no retry needed
    expect(result.recovered).toBe(true)
    expect(result.pendingEntries).toBe(2)
    expect(result.retriedEntries).toBe(0)
    expect(result.failedEntries).toBe(0)
  })

  test("resets retry_wait entries back to ready", () => {
    const manager = new OutboxManager(federationId)
    createRetryWaitEntry(manager)
    createRetryWaitEntry(manager)

    const result = recoverOutbox(manager)

    expect(result.recovered).toBe(true)
    expect(result.pendingEntries).toBe(2)
    expect(result.retriedEntries).toBe(2)
    expect(result.failedEntries).toBe(0)

    // Verify entries are now back in ready state
    const all = manager.getAllEntries()
    for (const entry of all) {
      expect(entry.state).toBe("ready")
    }
  })

  test("processes mixed ready and retry_wait entries", () => {
    const manager = new OutboxManager(federationId)
    createReadyEntry(manager)
    createRetryWaitEntry(manager)
    createReadyEntry(manager)

    const result = recoverOutbox(manager)

    expect(result.recovered).toBe(true)
    expect(result.pendingEntries).toBe(3)
    expect(result.retriedEntries).toBe(1)
    expect(result.failedEntries).toBe(0)
  })

  test("does not process completed or failed entries", () => {
    const manager = new OutboxManager(federationId)
    createCompletedEntry(manager)
    createFailedEntry(manager)
    createReadyEntry(manager)

    const result = recoverOutbox(manager)

    // Only the ready entry counts as pending
    expect(result.recovered).toBe(true)
    expect(result.pendingEntries).toBe(1)
    expect(result.retriedEntries).toBe(0)
    expect(result.failedEntries).toBe(0)
  })

  test("retry clears error metadata and resets attempt count", () => {
    const manager = new OutboxManager(federationId)
    const id = createRetryWaitEntry(manager)

    // Before retry
    const before = manager.getEntry(id)
    expect(before?.state).toBe("retry_wait")
    expect(before?.attemptCount).toBeGreaterThan(0)
    expect(before?.lastError).toBeTruthy()
    expect(before?.nextAttemptAt).toBeTruthy()

    recoverOutbox(manager)

    // After retry — metadata cleared
    const after = manager.getEntry(id)
    expect(after?.state).toBe("ready")
    expect(after?.attemptCount).toBe(0)
    expect(after?.lastError).toBeNull()
    expect(after?.nextAttemptAt).toBeNull()
  })
})

// ── Tests: getOutboxState ----------------------------------------------------

describe("getOutboxState", () => {
  const federationId = "test-recovery-fed"

  test("returns all zero counts for empty outbox", () => {
    const manager = new OutboxManager(federationId)
    const state = getOutboxState(manager)

    expect(state.pending).toBe(0)
    expect(state.retrying).toBe(0)
    expect(state.confirmed).toBe(0)
    expect(state.failed).toBe(0)
  })

  test("counts entries in each state category", () => {
    const manager = new OutboxManager(federationId)
    createReadyEntry(manager)       // pending
    createRetryWaitEntry(manager)   // retrying
    createReadyEntry(manager)       // pending
    createCompletedEntry(manager)   // confirmed
    createFailedEntry(manager)      // failed
    createRetryWaitEntry(manager)   // retrying

    const state = getOutboxState(manager)

    expect(state.pending).toBe(2)
    expect(state.retrying).toBe(2)
    expect(state.confirmed).toBe(1)
    expect(state.failed).toBe(1)
  })

  test("confirmed counts terminal terminal states", () => {
    const manager = new OutboxManager(federationId)

    // Create entries in each confirmed terminal state
    const { outboxId: id1 } = manager.createEntry(makeTestEvent())
    const e1 = manager.getEntry(id1)!

    // Manually set different confirmed states
    const states: Array<"appended" | "observed_in_view" | "imported" | "complete"> = [
      "appended", "observed_in_view", "imported", "complete",
    ]
    for (const state of states) {
      const e = manager.createEntry(makeTestEvent())
      Object.assign(e, { state, updatedAt: new Date().toISOString() })
    }

    const result = getOutboxState(manager)
    expect(result.confirmed).toBe(4)
  })

  test("total entries equals sum of category counts plus transitional states", () => {
    const manager = new OutboxManager(federationId)
    createReadyEntry(manager)       // pending → 1
    createRetryWaitEntry(manager)   // retrying → 1
    createCompletedEntry(manager)   // confirmed → 1
    createFailedEntry(manager)      // failed → 1

    // Also a "created" and "appending" (transitional, not counted)
    const e1 = manager.createEntry(makeTestEvent())
    // e1 stays "created"
    const e2 = manager.createEntry(makeTestEvent())
    manager.markReady(e2.outboxId)
    manager.markAppending(e2.outboxId)
    // e2 stays "appending"

    // Total: 6 entries (4 counted + 2 transitional)
    const state = getOutboxState(manager)
    const countedSum = state.pending + state.retrying + state.confirmed + state.failed
    expect(countedSum).toBe(4)
    expect(manager.getAllEntries().length).toBe(6)
  })
})
