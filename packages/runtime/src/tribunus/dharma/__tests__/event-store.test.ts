/**
 * Dharma Event Store — unit tests
 *
 * Tests cover the pure encode/decode helpers and WHERE builder logic.
 * DB-dependent operations are excluded — they require an in-memory
 * PGlite adapter layer.
 */

import { describe, it, expect } from "bun:test"
import {
  encodeForDb,
  decodeFromDb,
  encodeValidationForDb,
  decodeValidationFromDb,
  buildWhere,
} from "../event-store"
import type { DharmaEventEnvelope, EventValidation } from "../types"

// ── Fixtures ───────────────────────────────────────────────

const sampleEvent: DharmaEventEnvelope = {
  eventId: "evt_01j3xyzabc",
  federationId: "fed_01j3abc123",
  eventType: "receipt.issued",
  schemaVersion: 1,
  actorPublicKey: "ed25519_pk1abc123def456",
  actorDeviceId: "device_alpha",
  createdAt: "2026-06-30T12:00:00.000Z",
  logicalClock: 42,
  causalParents: ["evt_01j3prev1", "evt_01j3prev2"],
  payloadHash: "sha256_abc123",
  payload: { amount: 100, recipient: "did:dht:abc" },
  signature: "sig_ed25519_def456",
}

const sampleEventNoDevice: DharmaEventEnvelope = {
  ...sampleEvent,
  actorDeviceId: null,
}

const sampleValidation: EventValidation = {
  eventId: "evt_01j3xyzabc",
  validationState: "accepted",
  validationReason: null,
  validatedAt: "2026-06-30T12:00:01.000Z",
  policyDigest: null,
  validatorVersion: 1,
}

const sampleValidationWithReason: EventValidation = {
  ...sampleValidation,
  validationState: "rejected",
  validationReason: "signature_mismatch",
  policyDigest: "sha256_policy_v1",
}

// ── encodeForDb / decodeFromDb ────────────────────────────

describe("encodeForDb / decodeFromDb", () => {
  it("round-trips a full event", () => {
    const encoded = encodeForDb(sampleEvent)
    const decoded = decodeFromDb(encoded as Record<string, unknown>)
    expect(decoded).toEqual(sampleEvent)
  })

  it("encodes actorDeviceId as null when absent", () => {
    const encoded = encodeForDb(sampleEventNoDevice)
    expect(encoded.actor_device_id).toBeNull()
  })

  it("decodes null actor_device_id back to null", () => {
    const encoded = encodeForDb(sampleEventNoDevice)
    const decoded = decodeFromDb(encoded as Record<string, unknown>)
    expect(decoded.actorDeviceId).toBeNull()
  })

  it("preserves causal_parents array", () => {
    const encoded = encodeForDb(sampleEvent)
    const parents = encoded.causal_parents as string[]
    expect(parents).toHaveLength(2)
    expect(parents).toContain("evt_01j3prev1")
  })

  it("preserves payload object", () => {
    const encoded = encodeForDb(sampleEvent)
    const payload = encoded.payload as Record<string, unknown>
    expect(payload.amount).toBe(100)
    expect(payload.recipient).toBe("did:dht:abc")
  })

  it("maps all known fields correctly", () => {
    const encoded = encodeForDb(sampleEvent)
    expect(encoded.event_id).toBe(sampleEvent.eventId)
    expect(encoded.federation_id).toBe(sampleEvent.federationId)
    expect(encoded.event_type).toBe(sampleEvent.eventType)
    expect(encoded.schema_version).toBe(sampleEvent.schemaVersion)
    expect(encoded.actor_public_key).toBe(sampleEvent.actorPublicKey)
    expect(encoded.created_at).toBe(sampleEvent.createdAt)
    expect(encoded.logical_clock).toBe(sampleEvent.logicalClock)
    expect(encoded.payload_hash).toBe(sampleEvent.payloadHash)
    expect(encoded.signature).toBe(sampleEvent.signature)
  })
})

// ── encodeValidationForDb / decodeValidationFromDb ─────────

describe("encodeValidationForDb / decodeValidationFromDb", () => {
  it("round-trips a basic validation", () => {
    const encoded = encodeValidationForDb(sampleValidation)
    const decoded = decodeValidationFromDb(
      encoded as Record<string, unknown>,
    )
    expect(decoded).toEqual(sampleValidation)
  })

  it("round-trips validation with reason and policy digest", () => {
    const encoded = encodeValidationForDb(sampleValidationWithReason)
    const decoded = decodeValidationFromDb(
      encoded as Record<string, unknown>,
    )
    expect(decoded).toEqual(sampleValidationWithReason)
  })

  it("uses eventId as both validation_id and event_id", () => {
    const encoded = encodeValidationForDb(sampleValidation)
    expect(encoded.validation_id).toBe(sampleValidation.eventId)
    expect(encoded.event_id).toBe(sampleValidation.eventId)
  })

  it("encodes null fields correctly", () => {
    const encoded = encodeValidationForDb(sampleValidation)
    expect(encoded.validation_reason).toBeNull()
    expect(encoded.policy_digest).toBeNull()
  })

  it("decodes null fields back to null", () => {
    const encoded = encodeValidationForDb(sampleValidation)
    const decoded = decodeValidationFromDb(
      encoded as Record<string, unknown>,
    )
    expect(decoded.validationReason).toBeNull()
    expect(decoded.policyDigest).toBeNull()
  })
})

// ── buildWhere ─────────────────────────────────────────────

describe("buildWhere", () => {
  it("returns undefined for empty filters", () => {
    expect(buildWhere({})).toBeUndefined()
  })

  it("adds federationId condition", () => {
    const where = buildWhere({ federationId: "fed_abc" })
    expect(where).toBeDefined()
  })

  it("adds eventType condition", () => {
    const where = buildWhere({ eventType: "receipt.issued" })
    expect(where).toBeDefined()
  })

  it("adds actor condition", () => {
    const where = buildWhere({ actor: "ed25519_pk_abc" })
    expect(where).toBeDefined()
  })

  it("adds fromTs condition", () => {
    const where = buildWhere({ fromTs: "2026-01-01T00:00:00Z" })
    expect(where).toBeDefined()
  })

  it("adds toTs condition", () => {
    const where = buildWhere({ toTs: "2026-12-31T23:59:59Z" })
    expect(where).toBeDefined()
  })

  it("combines multiple conditions", () => {
    const where = buildWhere({
      federationId: "fed_abc",
      eventType: "receipt.issued",
      fromTs: "2026-01-01T00:00:00Z",
    })
    expect(where).toBeDefined()
  })

  it("returns undefined when all filter values are empty strings", () => {
    const where = buildWhere({
      federationId: "",
      eventType: "",
    })
    expect(where).toBeUndefined()
  })
})
