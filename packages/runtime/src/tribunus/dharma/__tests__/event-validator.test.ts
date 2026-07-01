/**
 * Dharma Event Validator Tests
 *
 * Tests for the validation pipeline and individual checks.
 */

import { describe, test, expect } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { createSignedEvent } from "../event-codec"
import {
  validateEvent,
  validateEventType,
  validateSchemaVersion,
  validateSignature,
  validateCausalParents,
  createValidationRecord,
} from "../event-validator"
import type { DharmaEventEnvelope, EventType } from "../types"
import { EVENT_TYPES, GOVERNANCE_EVENT_TYPES, DHARMA_EVENT_SCHEMA_VERSION } from "../types"

// ── Helpers ------------------------------------------------------------------

function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  })
  return { publicKey, privateKey, publicKeyHex: publicKey.toString("hex") }
}

function makeValidEvent(overrides?: Partial<DharmaEventEnvelope>): DharmaEventEnvelope {
  const keyPair = generateKeyPair()
  const event = createSignedEvent(
    {
      federationId: "test-federation-1",
      eventType: overrides?.eventType ?? ("work.offer_created" as EventType),
      schemaVersion: overrides?.schemaVersion ?? DHARMA_EVENT_SCHEMA_VERSION,
      actorPublicKey: keyPair.publicKeyHex,
      actorDeviceId: null,
      createdAt: "2026-06-30T12:00:00.000Z",
      logicalClock: 42,
      causalParents: overrides?.causalParents ?? [],
      payload: { title: "Test offer", amount: 100 },
    },
    keyPair.privateKey,
  )
  return event
}

function makeGovernanceEvent(overrides?: { causalParents?: string[]; tampered?: boolean }): DharmaEventEnvelope {
  const keyPair = generateKeyPair()
  const event = createSignedEvent(
    {
      federationId: "test-federation-2",
      eventType: "federation.member_joined" as EventType,
      schemaVersion: DHARMA_EVENT_SCHEMA_VERSION,
      actorPublicKey: keyPair.publicKeyHex,
      actorDeviceId: null,
      createdAt: "2026-06-30T12:00:00.000Z",
      logicalClock: 1,
      causalParents: overrides?.causalParents ?? ["parent-event-1"],
      payload: { identity: "member-42" },
    },
    keyPair.privateKey,
  )
  return event
}

// ── Tests: validateEventType -------------------------------------------------

describe("validateEventType", () => {
  test.each(EVENT_TYPES as unknown as string[])("accepts known type: %s", (eventType) => {
    const result = validateEventType(eventType)
    expect(result.state).toBe("accepted")
    expect(result.reason).toBeNull()
  })

  test("rejects unknown type", () => {
    const result = validateEventType("completely.bogus.type")
    expect(result.state).toBe("rejected")
    expect(result.reason).toContain("Unknown event type")
  })

  test("rejects empty string", () => {
    const result = validateEventType("")
    expect(result.state).toBe("rejected")
  })
})

// ── Tests: validateSchemaVersion ---------------------------------------------

describe("validateSchemaVersion", () => {
  test("accepts v1", () => {
    const result = validateSchemaVersion(DHARMA_EVENT_SCHEMA_VERSION)
    expect(result.state).toBe("accepted")
    expect(result.reason).toBeNull()
  })

  test("rejects v99", () => {
    const result = validateSchemaVersion(99)
    expect(result.state).toBe("rejected")
    expect(result.reason).toContain("Unsupported schema version")
  })

  test("rejects v0", () => {
    const result = validateSchemaVersion(0)
    expect(result.state).toBe("rejected")
  })

  test("rejects negative version", () => {
    const result = validateSchemaVersion(-1)
    expect(result.state).toBe("rejected")
  })
})

// ── Tests: validateSignature -------------------------------------------------

describe("validateSignature", () => {
  test("accepts valid signature", () => {
    const event = makeValidEvent()
    const result = validateSignature(event)
    expect(result.state).toBe("accepted")
    expect(result.reason).toBeNull()
  })

  test("rejects invalid signature", () => {
    const event = makeValidEvent()
    event.signature = "deadbeefdeadbeefdeadbeefdeadbeef"
    const result = validateSignature(event)
    expect(result.state).toBe("rejected")
    expect(result.reason).toContain("failed")
  })
})

// ── Tests: validateCausalParents ---------------------------------------------

describe("validateCausalParents", () => {
  test("governance events without parents are rejected", () => {
    const event = makeGovernanceEvent({ causalParents: [] })
    const result = validateCausalParents(event)
    expect(result.state).toBe("quarantined")
    expect(result.reason).toContain("requires at least one causal parent")
  })

  test("governance events with parents are accepted", () => {
    const event = makeGovernanceEvent({ causalParents: ["parent-1"] })
    const result = validateCausalParents(event)
    expect(result.state).toBe("accepted")
    expect(result.reason).toBeNull()
  })

  test("non-governance events without parents are accepted", () => {
    const event = makeValidEvent({ causalParents: [] })
    const result = validateCausalParents(event)
    expect(result.state).toBe("accepted")
    expect(result.reason).toBeNull()
  })
})

// ── Tests: validateEvent (full pipeline) -------------------------------------

describe("validateEvent (full pipeline)", () => {
  test("valid event → accepted", () => {
    const event = makeValidEvent()
    const result = validateEvent(event)
    expect(result.state).toBe("accepted")
    expect(result.reason).toBeNull()
  })

  test("bad schema version → rejected", () => {
    const event = makeValidEvent({ schemaVersion: 99 })
    const result = validateEvent(event)
    expect(result.state).toBe("rejected")
    expect(result.reason).toContain("schema version")
  })

  test("unknown event type → rejected", () => {
    const event = makeValidEvent({ eventType: "bogus.type" as EventType })
    const result = validateEvent(event)
    expect(result.state).toBe("rejected")
    expect(result.reason).toContain("Unknown event type")
  })

  test("tampered event → rejected", () => {
    const event = makeValidEvent()
    event.signature = "bad-signature-00000000000000000000"
    const result = validateEvent(event)
    expect(result.state).toBe("rejected")
    expect(result.reason).toContain("signature verification failed")
  })

  test("governance event without causal parents → quarantined", () => {
    const event = makeGovernanceEvent({ causalParents: [] })
    const result = validateEvent(event)
    expect(result.state).toBe("quarantined")
    expect(result.reason).toContain("causal parent")
  })
})

// ── Tests: createValidationRecord --------------------------------------------

describe("createValidationRecord", () => {
  test("creates record with accepted state", () => {
    const record = createValidationRecord("event-1", { state: "accepted", reason: null })
    expect(record.eventId).toBe("event-1")
    expect(record.validationState).toBe("accepted")
    expect(record.validationReason).toBeNull()
    expect(record.policyDigest).toBeNull()
    expect(record.validatorVersion).toBe(DHARMA_EVENT_SCHEMA_VERSION)
    expect(record.validatedAt).toBeTruthy()
  })

  test("creates record with rejected state", () => {
    const record = createValidationRecord("event-2", { state: "rejected", reason: "Bad signature" })
    expect(record.eventId).toBe("event-2")
    expect(record.validationState).toBe("rejected")
    expect(record.validationReason).toBe("Bad signature")
    expect(record.policyDigest).toBeNull()
  })

  test("includes policy digest when provided", () => {
    const record = createValidationRecord("event-3", { state: "accepted", reason: null }, "policy-digest-abc")
    expect(record.policyDigest).toBe("policy-digest-abc")
  })
})
