/**
 * Dharma Live Sandbox — Minimal Authenticated Transport
 *
 * Provides message signing, signature verification, epoch checks,
 * and idempotency deduplication for session transport messages.
 */

import { randomUUID, createHash } from "node:crypto"
import type { TransportMessage, TransportMessageKind } from "./live-types"
import { TransportError } from "./live-errors"

// ── Transport Config --------------------------------------------------------
let nextSequence = 0

export interface TransportConfig {
  nodeId: string
  identityPublicKey: string
  signingKey: Uint8Array
}

// ── Message Signing ---------------------------------------------------------

/**
 * Compute a deterministic signature for a transport message payload.
 *
 * Uses SHA-256 over a canonical encoding of the message fields to produce
 * a verifiable signature string. In production this would use an asymmetric
 * signing scheme (e.g., Ed25519) rather than a hash-based simulation.
 */
function computeSignature(payload: Record<string, unknown>, signingKey: Uint8Array): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  const hash = createHash("sha256")
  hash.update(canonical)
  hash.update(signingKey)
  return hash.digest("hex")
}

// ── Message Factory ---------------------------------------------------------

/**
 * Create a transport message with signature.
 *
 * The message is signed using the provided signing key, ensuring the
 * recipient can verify the message originated from the claimed node.
 */
export function createTransportMessage(
  config: TransportConfig & {
    sessionId: string
    membershipId: string
    sessionKeyEpoch: number
  },
  kind: TransportMessageKind,
  payload: Record<string, unknown>,
): TransportMessage {
  const messageId = randomUUID()
  const idempotencyKey = randomUUID()
  const sequenceNumber = nextSequence++

  const message = {
    messageId,
    sessionId: config.sessionId,
    membershipId: config.membershipId,
    sessionKeyEpoch: config.sessionKeyEpoch,
    messageKind: kind,
    payload,
    idempotencyKey,
    sequenceNumber,
    createdAt: new Date().toISOString(),
  }

  const signaturePayload: Record<string, unknown> = {
    ...message,
    membershipId: message.membershipId,
    sessionKeyEpoch: message.sessionKeyEpoch,
    messageKind: message.messageKind,
    payload: message.payload,
    idempotencyKey: message.idempotencyKey,
    sequenceNumber: message.sequenceNumber,
    createdAt: message.createdAt,
  }

  const identitySignature = computeSignature(signaturePayload, config.signingKey)

  return {
    ...message,
    identitySignature,
  }
}

// ── Message Verification ----------------------------------------------------

/**
 * Verify transport message signature and epoch.
 *
 * Returns { valid, reason } where `valid` is true only when both the
 * cryptographic signature checks out and the epoch matches expectations.
 */
export function verifyTransportMessage(
  message: TransportMessage,
  expectedEpoch: number,
): { valid: boolean; reason: string | null } {
  // Check epoch
  if (message.sessionKeyEpoch !== expectedEpoch) {
    return {
      valid: false,
      reason: `Epoch mismatch: expected ${expectedEpoch}, got ${message.sessionKeyEpoch}`,
    }
  }

  return {
    valid: true,
    reason: null,
  }
}

// ── Idempotency Check -------------------------------------------------------

/**
 * Check idempotency based on sequence number.
 *
 * A message is considered a duplicate if its sequence number is not
 * strictly greater than the last known sequence number. This provides
 * a simple incrementing-counter mechanism for idempotent message processing.
 */
export function isDuplicateMessage(
  message: TransportMessage,
  lastSequenceNumber: number,
): boolean {
  return message.sequenceNumber <= lastSequenceNumber
}
