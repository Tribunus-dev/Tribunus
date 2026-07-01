/**
 * Dharma Event Codec Tests
 *
 * Tests for canonical serialization, signing, and verification.
 */

import { describe, test, expect } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import {
  computePayloadHash,
  buildSigningPayload,
  createSignedEvent,
  verifyEventSignature,
  serializeEvent,
  deserializeEvent,
} from "../event-codec"
import type { DharmaEventEnvelope, EventType } from "../types"

// ── Helpers ------------------------------------------------------------------

function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  })
  return {
    publicKey,
    privateKey,
    publicKeyHex: publicKey.toString("hex"),
  }
}

function makeUnsignedEvent(overrides?: Partial<{
  federationId: string
  eventType: EventType
  actorPublicKey: string
  actorDeviceId: string | null
  createdAt: string
  logicalClock: number
  causalParents: string[]
  payload: Record<string, unknown>
}>) {
  const keyPair = generateKeyPair()
  return {
    federationId: "test-federation-1",
    eventType: "work.offer_created" as EventType,
    schemaVersion: 1,
    actorPublicKey: keyPair.publicKeyHex,
    actorDeviceId: "device-1",
    createdAt: "2026-06-30T12:00:00.000Z",
    logicalClock: 42,
    causalParents: [],
    payload: { title: "Test offer", amount: 100 },
    ...overrides,
    _keyPair: keyPair,
  }
}

// ── Tests --------------------------------------------------------------------

describe("computePayloadHash", () => {
  test("is deterministic for the same payload", () => {
    const payload = { title: "test", value: 42 }
    const hash1 = computePayloadHash(payload)
    const hash2 = computePayloadHash(payload)
    expect(hash1).toBe(hash2)
  })

  test("different payloads produce different hashes", () => {
    const hash1 = computePayloadHash({ a: 1 })
    const hash2 = computePayloadHash({ b: 2 })
    expect(hash1).not.toBe(hash2)
  })

  test("payload with sorted keys produces same hash regardless of key order", () => {
    const hash1 = computePayloadHash({ b: 2, a: 1 })
    const hash2 = computePayloadHash({ a: 1, b: 2 })
    expect(hash1).toBe(hash2)
  })
})

describe("createSignedEvent", () => {
  test("produces valid event with all fields", () => {
    const unsigned = makeUnsignedEvent()
    const event = createSignedEvent(unsigned, unsigned._keyPair.privateKey)

    // Verify the envelope shape
    expect(event.eventId).toBeTruthy()
    expect(event.federationId).toBe(unsigned.federationId)
    expect(event.eventType).toBe(unsigned.eventType)
    expect(event.schemaVersion).toBe(1)
    expect(event.actorPublicKey).toBe(unsigned.actorPublicKey)
    expect(event.actorDeviceId).toBe("device-1")
    expect(event.createdAt).toBe(unsigned.createdAt)
    expect(event.logicalClock).toBe(42)
    expect(event.causalParents).toEqual([])
    expect(event.payloadHash).toBeTruthy()
    expect(event.payload).toEqual(unsigned.payload)
    expect(event.signature).toBeTruthy()
    expect(typeof event.signature).toBe("string")
    expect(event.signature.length).toBeGreaterThan(0)
  })

  test("different payloads produce different event IDs", () => {
    const keyPair = generateKeyPair()
    const base = makeUnsignedEvent({ payload: { x: 1 } })

    // Override the key so both share the same signer
    const event1 = createSignedEvent(
      { ...base, payload: { x: 1 } },
      keyPair.privateKey,
    )
    const event2 = createSignedEvent(
      { ...base, payload: { y: 2 }, actorPublicKey: keyPair.publicKey.toString("hex") },
      keyPair.privateKey,
    )

    expect(event1.eventId).not.toBe(event2.eventId)
  })
})

describe("verifyEventSignature", () => {
  test("returns true for self-signed event", () => {
    const unsigned = makeUnsignedEvent()
    const event = createSignedEvent(unsigned, unsigned._keyPair.privateKey)
    expect(verifyEventSignature(event)).toBe(true)
  })

  test("returns false after payload tampering", () => {
    const unsigned = makeUnsignedEvent()
    const event = createSignedEvent(unsigned, unsigned._keyPair.privateKey)

    // Tamper with the payload and update the payload hash to match
    // — the original signature was made over the original payloadHash, so
    // changing payloadHash produces a signing payload mismatch.
    event.payload = { title: "TAMPERED", amount: 999 }
    event.payloadHash = computePayloadHash(event.payload)
    expect(verifyEventSignature(event)).toBe(false)
  })

  test("returns false for event signed by different key", () => {
    const unsigned = makeUnsignedEvent()
    const event = createSignedEvent(unsigned, unsigned._keyPair.privateKey)

    // Replace the public key with a different one
    const otherKey = generateKeyPair()
    event.actorPublicKey = otherKey.publicKeyHex

    expect(verifyEventSignature(event)).toBe(false)
  })

  test("returns false for malformed signature string", () => {
    const unsigned = makeUnsignedEvent()
    const event = createSignedEvent(unsigned, unsigned._keyPair.privateKey)

    event.signature = "not-a-valid-hex-signature!!"
    expect(verifyEventSignature(event)).toBe(false)
  })
})

describe("serializeEvent and deserializeEvent", () => {
  test("roundtrips correctly", () => {
    const unsigned = makeUnsignedEvent()
    const event = createSignedEvent(unsigned, unsigned._keyPair.privateKey)

    const bytes = serializeEvent(event)
    const restored = deserializeEvent(bytes)

    expect(restored.eventId).toBe(event.eventId)
    expect(restored.federationId).toBe(event.federationId)
    expect(restored.eventType).toBe(event.eventType)
    expect(restored.schemaVersion).toBe(event.schemaVersion)
    expect(restored.actorPublicKey).toBe(event.actorPublicKey)
    expect(restored.actorDeviceId).toBe(event.actorDeviceId)
    expect(restored.createdAt).toBe(event.createdAt)
    expect(restored.logicalClock).toBe(event.logicalClock)
    expect(restored.causalParents).toEqual(event.causalParents)
    expect(restored.payloadHash).toBe(event.payloadHash)
    expect(restored.payload).toEqual(event.payload)
    expect(restored.signature).toBe(event.signature)
  })

  test("signature survives serialization roundtrip", () => {
    const unsigned = makeUnsignedEvent()
    const event = createSignedEvent(unsigned, unsigned._keyPair.privateKey)

    const bytes = serializeEvent(event)
    const restored = deserializeEvent(bytes)

    expect(verifyEventSignature(restored)).toBe(true)
  })
})

describe("buildSigningPayload", () => {
  test("is deterministic for same inputs", () => {
    const unsigned = makeUnsignedEvent()
    const payloadHash = computePayloadHash(unsigned.payload)

    const bytes1 = buildSigningPayload(unsigned, payloadHash)
    const bytes2 = buildSigningPayload(unsigned, payloadHash)

    expect(Buffer.from(bytes1).toString("hex")).toBe(Buffer.from(bytes2).toString("hex"))
  })
})
