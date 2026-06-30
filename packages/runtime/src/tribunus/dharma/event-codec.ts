/**
 * Dharma Federation Runtime — Event Codec
 *
 * Canonical event serialization, signing, and verification.
 * Uses Ed25519 via node:crypto for signatures.
 */

import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto"
import type { DharmaEventEnvelope, EventType } from "./types"
import { canonicalJson, deriveEventId, sha256Hex, DHARMA_EVENT_SCHEMA_VERSION } from "./types"

// ── Types --------------------------------------------------------------------

export interface UnsignedEvent {
  federationId: string
  eventType: EventType
  schemaVersion: number
  actorPublicKey: string
  actorDeviceId: string | null
  createdAt: string
  logicalClock: number
  causalParents: string[]
  payload: Record<string, unknown>
}

// ── Payload Hashing ----------------------------------------------------------

/** Compute payload hash from canonical JSON of payload */
export function computePayloadHash(payload: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(payload))
}

// ── Signing Payload ----------------------------------------------------------

/** Build the signing payload (canonical representation used for signature) */
export function buildSigningPayload(unsigned: UnsignedEvent, payloadHash: string): Uint8Array {
  const normalized = {
    federationId: unsigned.federationId,
    eventType: unsigned.eventType,
    schemaVersion: unsigned.schemaVersion,
    actorPublicKey: unsigned.actorPublicKey,
    actorDeviceId: unsigned.actorDeviceId,
    createdAt: unsigned.createdAt,
    logicalClock: unsigned.logicalClock,
    causalParents: [...unsigned.causalParents].sort(),
    payloadHash,
  }
  return new TextEncoder().encode(canonicalJson(normalized))
}

// ── Event Creation -----------------------------------------------------------

/** Create a complete signed event envelope */
export function createSignedEvent(
  unsigned: UnsignedEvent,
  privateKey: Uint8Array,
): DharmaEventEnvelope {
  const payloadHash = computePayloadHash(unsigned.payload)

  const signingPayload = buildSigningPayload(unsigned, payloadHash)

  const privateKeyObj = createPrivateKey({ key: Buffer.from(privateKey), type: "pkcs8", format: "der" })
  const signatureBuffer = sign(null, signingPayload, privateKeyObj)
  const signature = signatureBuffer.toString("hex")

  const eventId = deriveEventId(
    unsigned.federationId,
    unsigned.eventType,
    unsigned.actorPublicKey,
    unsigned.logicalClock,
    unsigned.causalParents,
    unsigned.createdAt,
    payloadHash,
  )

  return {
    eventId,
    federationId: unsigned.federationId,
    eventType: unsigned.eventType,
    schemaVersion: unsigned.schemaVersion,
    actorPublicKey: unsigned.actorPublicKey,
    actorDeviceId: unsigned.actorDeviceId,
    createdAt: unsigned.createdAt,
    logicalClock: unsigned.logicalClock,
    causalParents: [...unsigned.causalParents].sort(),
    payloadHash,
    payload: unsigned.payload,
    signature,
  }
}

// ── Signature Verification ---------------------------------------------------

/** Verify the signature on an event envelope. Returns true if valid. */
export function verifyEventSignature(event: DharmaEventEnvelope): boolean {
  const unsigned: UnsignedEvent = {
    federationId: event.federationId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    actorPublicKey: event.actorPublicKey,
    actorDeviceId: event.actorDeviceId,
    createdAt: event.createdAt,
    logicalClock: event.logicalClock,
    causalParents: event.causalParents,
    payload: event.payload,
  }

  const signingPayload = buildSigningPayload(unsigned, event.payloadHash)

  try {
    const publicKeyObj = createPublicKey({ key: Buffer.from(event.actorPublicKey, "hex"), type: "spki", format: "der" })
    return verify(null, signingPayload, publicKeyObj, Buffer.from(event.signature, "hex"))
  } catch {
    return false
  }
}

// ── Serialization ------------------------------------------------------------

/** Serialize envelope to canonical JSON bytes */
export function serializeEvent(event: DharmaEventEnvelope): Uint8Array {
  return new TextEncoder().encode(canonicalJson(event))
}

/** Deserialize bytes back to envelope */
export function deserializeEvent(data: Uint8Array): DharmaEventEnvelope {
  return JSON.parse(new TextDecoder().decode(data)) as DharmaEventEnvelope
}
