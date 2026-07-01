/**
 * Federation Event Importer Tests
 *
 * Tests for event import, decoding, validation, dependencies, and cursor management.
 */

import { describe, test, expect, mock } from "bun:test"
import { createHash } from "node:crypto"
import { FederationEventImporter } from "../importer"
import { ImporterError } from "../errors"
import type { DharmaEventEnvelope } from "../../types"
import { canonicalJson, deriveEventId, sha256Hex, DHARMA_EVENT_SCHEMA_VERSION } from "../../types"
import type { ImporterCursorType } from "../protocol"

// ── Helpers ------------------------------------------------------------------

function makeTestEnvelope(overrides?: Partial<DharmaEventEnvelope>): DharmaEventEnvelope {
  const eventType = "work.offer_created"
  const actorKey = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
  const causalParents: string[] = []
  const createdAt = "2025-01-01T00:00:00.000Z"
  const payloadHash = sha256Hex(canonicalJson({ test: true }))

  const eventId = deriveEventId(
    "test-fed",
    eventType,
    actorKey,
    1,
    causalParents,
    createdAt,
    payloadHash,
  )

  return {
    eventId,
    federationId: "test-fed",
    eventType: eventType as any,
    schemaVersion: DHARMA_EVENT_SCHEMA_VERSION,
    actorPublicKey: actorKey,
    actorDeviceId: null,
    createdAt,
    logicalClock: 1,
    causalParents: [...causalParents],
    payloadHash,
    payload: { test: true },
    signature: "deadbeef",
    ...overrides,
  }
}

function serializeEnvelope(envelope: DharmaEventEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope))
}

// ── Tests: isAlreadyImported -------------------------------------------------

describe("isAlreadyImported", () => {
  test("returns false for new event", () => {
    const importer = new FederationEventImporter("test-fed")
    expect(importer.isAlreadyImported("unknown-event")).toBe(false)
  })

  test("returns true after import (partial flow — directly mark imported)", () => {
    const importer = new FederationEventImporter("test-fed")
    const envelope = makeTestEnvelope()
    // Simulate import by directly marking the ID
    importer["importedIds"].add(envelope.eventId)
    expect(importer.isAlreadyImported(envelope.eventId)).toBe(true)
  })
})

// ── Tests: decodeAndVerify ---------------------------------------------------

describe("decodeAndVerify", () => {
  test("parses valid envelope", () => {
    const importer = new FederationEventImporter("test-fed")
    const envelope = makeTestEnvelope()
    const bytes = serializeEnvelope(envelope)

    const decoded = importer.decodeAndVerify(envelope.eventId, bytes)
    expect(decoded.eventId).toBe(envelope.eventId)
    expect(decoded.federationId).toBe("test-fed")
    expect(decoded.eventType).toBe("work.offer_created")
  })

  test("throws on eventId mismatch", () => {
    const importer = new FederationEventImporter("test-fed")
    const envelope = makeTestEnvelope()
    const bytes = serializeEnvelope(envelope)

    expect(() => importer.decodeAndVerify("wrong-event-id", bytes)).toThrow(ImporterError)
  })

  test("throws on payload hash mismatch", () => {
    const importer = new FederationEventImporter("test-fed")
    const envelope = makeTestEnvelope({ payloadHash: "0000deadbeef0000" })
    const bytes = serializeEnvelope(envelope)

    expect(() => importer.decodeAndVerify(envelope.eventId, bytes)).toThrow(ImporterError)
  })

  test("throws on invalid bytes", () => {
    const importer = new FederationEventImporter("test-fed")
    const badBytes = new TextEncoder().encode("not-json-at-all")

    expect(() => importer.decodeAndVerify("any-id", badBytes)).toThrow(ImporterError)
  })
})

// ── Tests: advanceCursor and getCursor ---------------------------------------

describe("cursor management", () => {
  test("advanceCursor advances cursor position", () => {
    const importer = new FederationEventImporter("test-fed")
    expect(importer.getCursor("provisional").autobaseLength).toBe(0)
    expect(importer.getCursor("provisional").importedCount).toBe(0)

    importer.advanceCursor("event-1", "provisional")
    expect(importer.getCursor("provisional").autobaseLength).toBe(1)
    expect(importer.getCursor("provisional").importedCount).toBe(1)
    expect(importer.getCursor("provisional").lastEventId).toBe("event-1")

    importer.advanceCursor("event-2", "provisional")
    expect(importer.getCursor("provisional").autobaseLength).toBe(2)
    expect(importer.getCursor("provisional").importedCount).toBe(2)
  })

  test("getCursor returns current position", () => {
    const importer = new FederationEventImporter("test-fed")
    const cursor = importer.getCursor("provisional")

    expect(cursor.federationId).toBe("test-fed")
    expect(cursor.cursorType).toBe("provisional")
    expect(cursor.autobaseLength).toBe(0)
    expect(cursor.lastEventId).toBeNull()
    expect(cursor.importedCount).toBe(0)
  })
})

// ── Tests: handleDependencies ------------------------------------------------

describe("handleDependencies", () => {
  test("event with no parents returns true", async () => {
    const importer = new FederationEventImporter("test-fed")
    const envelope = makeTestEnvelope({ causalParents: [] })

    const result = await importer.handleDependencies(envelope)
    expect(result).toBe(true)
  })

  test("event with known parent returns true", async () => {
    const importer = new FederationEventImporter("test-fed")
    // Pre-import the parent
    importer["importedIds"].add("parent-event-id")

    const envelope = makeTestEnvelope({
      eventId: "child-event-id",
      causalParents: ["parent-event-id"],
    })

    const result = await importer.handleDependencies(envelope)
    expect(result).toBe(true)
  })

  test("event with unknown parent creates pending", async () => {
    const importer = new FederationEventImporter("test-fed")
    const envelope = makeTestEnvelope({
      eventId: "child-event-id",
      causalParents: ["missing-parent-id"],
    })

    const result = await importer.handleDependencies(envelope)
    expect(result).toBe(false)
    expect(importer.getPendingDependencyCount()).toBe(1)
  })

  test("multiple unknown parents create one pending entry", async () => {
    const importer = new FederationEventImporter("test-fed")
    const envelope = makeTestEnvelope({
      eventId: "child-event-id",
      causalParents: ["missing-1", "missing-2", "missing-3"],
    })

    const result = await importer.handleDependencies(envelope)
    expect(result).toBe(false)
    expect(importer.getPendingDependencyCount()).toBe(1)
  })

  test("handleDependencies does not affect already-imported events", async () => {
    const importer = new FederationEventImporter("test-fed")
    importer["importedIds"].add("parent-1")
    importer["importedIds"].add("parent-2")

    const envelope = makeTestEnvelope({
      eventId: "child-event-id",
      causalParents: ["parent-1", "parent-2"],
    })

    const result = await importer.handleDependencies(envelope)
    expect(result).toBe(true)
    expect(importer.getPendingDependencyCount()).toBe(0)
  })
})

// ── Tests: retryDependencies -------------------------------------------------

describe("retryDependencies", () => {
  test("resolves when missing parent becomes available", async () => {
    const importer = new FederationEventImporter("test-fed")

    // Set up a pending dependency
    const envelope = makeTestEnvelope({
      eventId: "child-with-deps",
      causalParents: ["now-available-parent"],
    })
    await importer.handleDependencies(envelope)
    expect(importer.getPendingDependencyCount()).toBe(1)

    // Make the parent available
    importer["importedIds"].add("now-available-parent")

    const resolved = await importer.retryDependencies()
    expect(resolved.length).toBe(1)
    expect(resolved[0]).toBe("child-with-deps")
    expect(importer.getPendingDependencyCount()).toBe(0)
  })

  test("does not resolve when parent still missing", async () => {
    const importer = new FederationEventImporter("test-fed")

    const envelope = makeTestEnvelope({
      eventId: "child-with-deps",
      causalParents: ["still-missing"],
    })
    await importer.handleDependencies(envelope)

    const resolved = await importer.retryDependencies()
    expect(resolved.length).toBe(0)
    expect(importer.getPendingDependencyCount()).toBe(1)
  })
})

// ── Tests: restoreCursor / restoreImportedIds --------------------------------

describe("state restoration", () => {
  test("restoreCursor sets cursor state", () => {
    const importer = new FederationEventImporter("test-fed")

    importer.restoreCursor({
      federationId: "test-fed",
      cursorType: "finalized",
      autobaseLength: 100,
      lastEventId: "event-99",
      lastEventTimestamp: "2025-06-01T00:00:00.000Z",
      importedCount: 99,
      updatedAt: "2025-06-01T00:00:00.000Z",
    })

    const cursor = importer.getCursor("finalized")
    expect(cursor.autobaseLength).toBe(100)
    expect(cursor.lastEventId).toBe("event-99")
    expect(cursor.importedCount).toBe(99)
  })

  test("restoreImportedIds sets idempotency set", () => {
    const importer = new FederationEventImporter("test-fed")

    importer.restoreImportedIds(["id-1", "id-2", "id-3"])

    expect(importer.isAlreadyImported("id-1")).toBe(true)
    expect(importer.isAlreadyImported("id-2")).toBe(true)
    expect(importer.isAlreadyImported("id-4")).toBe(false)
  })
})
