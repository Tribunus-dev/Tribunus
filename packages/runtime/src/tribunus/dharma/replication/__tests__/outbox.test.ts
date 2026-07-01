/**
 * Outbox Manager Tests
 *
 * Tests for state transitions, entry management, and retry logic.
 */

import { describe, test, expect } from "bun:test"
import { OutboxManager, VALID_OUTBOX_TRANSITIONS, isValidOutboxTransition } from "../outbox"
import { OutboxError } from "../errors"
import type { DharmaEventEnvelope } from "../../types"

// ── Helpers ------------------------------------------------------------------

function makeTestEvent(overrides?: Partial<DharmaEventEnvelope>): DharmaEventEnvelope {
  return {
    eventId: "test-event-id-001",
    federationId: "test-fed",
    eventType: "work.offer_created",
    schemaVersion: 1,
    actorPublicKey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    actorDeviceId: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    logicalClock: 1,
    causalParents: [],
    payloadHash: "d1b2a3f4e5c6b7a8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2",
    payload: { test: true },
    signature: "deadbeef",
    ...overrides,
  }
}

// ── Tests: VALID_OUTBOX_TRANSITIONS -----------------------------------------

describe("VALID_OUTBOX_TRANSITIONS", () => {
  test("created → ready is valid", () => {
    expect(isValidOutboxTransition("created", "ready")).toBe(true)
  })

  test("ready → appending is valid", () => {
    expect(isValidOutboxTransition("ready", "appending")).toBe(true)
  })

  test("ready → retry_wait is valid", () => {
    expect(isValidOutboxTransition("ready", "retry_wait")).toBe(true)
  })

  test("appending → appended is valid", () => {
    expect(isValidOutboxTransition("appending", "appended")).toBe(true)
  })

  test("appending → retry_wait is valid", () => {
    expect(isValidOutboxTransition("appending", "retry_wait")).toBe(true)
  })

  test("appended → observed_in_view is valid", () => {
    expect(isValidOutboxTransition("appended", "observed_in_view")).toBe(true)
  })

  test("observed_in_view → imported is valid", () => {
    expect(isValidOutboxTransition("observed_in_view", "imported")).toBe(true)
  })

  test("imported → complete is valid", () => {
    expect(isValidOutboxTransition("imported", "complete")).toBe(true)
  })

  test("retry_wait → ready is valid", () => {
    expect(isValidOutboxTransition("retry_wait", "ready")).toBe(true)
  })

  test("retry_wait → failed_terminal is valid", () => {
    expect(isValidOutboxTransition("retry_wait", "failed_terminal")).toBe(true)
  })

  test("created → appended is invalid", () => {
    expect(isValidOutboxTransition("created", "appended")).toBe(false)
  })

  test("complete has no outgoing transitions", () => {
    expect(VALID_OUTBOX_TRANSITIONS.complete).toEqual([])
  })

  test("failed_terminal has no outgoing transitions", () => {
    expect(VALID_OUTBOX_TRANSITIONS.failed_terminal).toEqual([])
  })
})

// ── Tests: OutboxManager ----------------------------------------------------

describe("OutboxManager", () => {
  const federationId = "test-fed-001"

  test("createEntry creates valid entry with created state", () => {
    const manager = new OutboxManager(federationId)
    const event = makeTestEvent()
    const entry = manager.createEntry(event)

    expect(entry.outboxId).toBeDefined()
    expect(entry.outboxId.length).toBeGreaterThan(0)
    expect(entry.federationId).toBe(federationId)
    expect(entry.eventId).toBe(event.eventId)
    expect(entry.state).toBe("created")
    expect(entry.attemptCount).toBe(0)
    expect(entry.writerCoreKey).toBeNull()
    expect(entry.appendedSequence).toBeNull()
    expect(entry.lastError).toBeNull()
    expect(entry.createdAt).toBeDefined()
    expect(entry.updatedAt).toBeDefined()
  })

  test("markReady transitions from created → ready", () => {
    const manager = new OutboxManager(federationId)
    const entry = manager.createEntry(makeTestEvent())

    manager.markReady(entry.outboxId)

    const updated = manager.getEntry(entry.outboxId)
    expect(updated?.state).toBe("ready")
  })

  test("markAppending transitions from ready → appending", () => {
    const manager = new OutboxManager(federationId)
    const entry = manager.createEntry(makeTestEvent())
    manager.markReady(entry.outboxId)

    manager.markAppending(entry.outboxId)

    const updated = manager.getEntry(entry.outboxId)
    expect(updated?.state).toBe("appending")
  })

  test("markAppended transitions from appending → appended", () => {
    const manager = new OutboxManager(federationId)
    const entry = manager.createEntry(makeTestEvent())
    manager.markReady(entry.outboxId)
    manager.markAppending(entry.outboxId)

    manager.markAppended(entry.outboxId, 42, "writer-core-key-abc")

    const updated = manager.getEntry(entry.outboxId)
    expect(updated?.state).toBe("appended")
    expect(updated?.appendedSequence).toBe(42)
    expect(updated?.writerCoreKey).toBe("writer-core-key-abc")
  })

  test("scheduleRetry transitions from appending → retry_wait", () => {
    const manager = new OutboxManager(federationId)
    const entry = manager.createEntry(makeTestEvent())
    manager.markReady(entry.outboxId)
    manager.markAppending(entry.outboxId)

    manager.scheduleRetry(entry.outboxId, "connection lost")

    const updated = manager.getEntry(entry.outboxId)
    expect(updated?.state).toBe("retry_wait")
    expect(updated?.attemptCount).toBe(1)
    expect(updated?.lastError).toBe("connection lost")
    expect(updated?.nextAttemptAt).toBeDefined()
  })

  test("markFailed transitions from retry_wait → failed_terminal", () => {
    const manager = new OutboxManager(federationId)
    const entry = manager.createEntry(makeTestEvent())
    manager.markReady(entry.outboxId)
    manager.markAppending(entry.outboxId)
    manager.scheduleRetry(entry.outboxId, "temporary failure")

    manager.markFailed(entry.outboxId, "max retries exceeded")

    const updated = manager.getEntry(entry.outboxId)
    expect(updated?.state).toBe("failed_terminal")
    expect(updated?.lastError).toBe("max retries exceeded")
  })

  test("Invalid transition throws OutboxError", () => {
    const manager = new OutboxManager(federationId)
    const entry = manager.createEntry(makeTestEvent())

    // created → appended is invalid
    expect(() => manager.markAppended(entry.outboxId, 1, "key")).toThrow(OutboxError)
    expect(() => manager.markFailed(entry.outboxId, "reason")).toThrow(OutboxError)
  })

  test("getPendingEntries returns ready entries sorted", () => {
    const manager = new OutboxManager(federationId)
    const e1 = manager.createEntry(makeTestEvent({ payload: { n: 1 } }))
    const e2 = manager.createEntry(makeTestEvent({ payload: { n: 2 } }))
    const e3 = manager.createEntry(makeTestEvent({ payload: { n: 3 } }))

    manager.markReady(e1.outboxId)
    // e2 stays created — should not appear
    manager.markReady(e3.outboxId)

    const pending = manager.getPendingEntries()
    expect(pending.length).toBe(2)
    expect(pending[0].outboxId).toBe(e1.outboxId)
    expect(pending[1].outboxId).toBe(e3.outboxId)
  })

  test("getDueRetries returns retry_wait entries past nextAttemptAt", () => {
    const manager = new OutboxManager(federationId)
    const entry = manager.createEntry(makeTestEvent())
    manager.markReady(entry.outboxId)
    manager.markAppending(entry.outboxId)

    // Schedule retry with 0 delay so it's immediately due
    manager.scheduleRetry(entry.outboxId, "error", 0)

    const due = manager.getDueRetries()
    expect(due.length).toBe(1)
    expect(due[0].outboxId).toBe(entry.outboxId)
  })

  test("restore loads entries correctly", () => {
    const manager = new OutboxManager(federationId)
    const event = makeTestEvent()
    const entry = manager.createEntry(event)

    const exported = manager.getAllEntries()

    // Create a new manager and restore
    const manager2 = new OutboxManager(federationId)
    manager2.restore(exported)

    const restored = manager2.getEntry(entry.outboxId)
    expect(restored).toBeDefined()
    expect(restored?.outboxId).toBe(entry.outboxId)
    expect(restored?.eventId).toBe(entry.eventId)
    expect(restored?.state).toBe(entry.state)

    // Restored entry should not affect the original
    expect(manager.getPendingCount()).toBe(0)
  })

  test("getPendingCount returns correct count", () => {
    const manager = new OutboxManager(federationId)
    const e1 = manager.createEntry(makeTestEvent())
    const e2 = manager.createEntry(makeTestEvent())

    manager.markReady(e1.outboxId)
    manager.markReady(e2.outboxId)

    expect(manager.getPendingCount()).toBe(2)
  })

  test("getAllEntries returns all entries", () => {
    const manager = new OutboxManager(federationId)
    manager.createEntry(makeTestEvent())
    manager.createEntry(makeTestEvent())
    manager.createEntry(makeTestEvent())

    expect(manager.getAllEntries().length).toBe(3)
  })

  test("markComplete transitions through imported → complete", () => {
    const manager = new OutboxManager(federationId)
    const entry = manager.createEntry(makeTestEvent())
    manager.markReady(entry.outboxId)
    manager.markAppending(entry.outboxId)
    manager.markAppended(entry.outboxId, 1, "key")
    manager.markObserved(entry.outboxId)

    manager.markComplete(entry.outboxId)

    const updated = manager.getEntry(entry.outboxId)
    expect(updated?.state).toBe("complete")
  })
})
