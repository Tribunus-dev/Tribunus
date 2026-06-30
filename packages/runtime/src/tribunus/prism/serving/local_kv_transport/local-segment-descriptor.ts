/**
 * Prism Local-Host KV Transport — Segment Descriptor Binding
 *
 * Pure functions for creating segment descriptors, validating their binding
 * to a (handoffId, segmentId) pair, and checking descriptor expiry.
 */

import type { PrismKvSegmentDescriptor } from "./local-transport-types"

// ── Constants ───────────────────────────────────────────────────────────────

/** Default descriptor lifetime in milliseconds. */
export const DEFAULT_DESCRIPTOR_TTL_MS = 60_000

// ── Descriptor Factory ──────────────────────────────────────────────────────

/**
 * Creates a new `PrismKvSegmentDescriptor`.
 *
 * Generates a UUID `descriptorNonce`, sets `expiresAt` from `Date.now()`, and
 * initialises `alignment` to `1` when no specific alignment is carried in the
 * descriptor contract (the segment carries its own; the descriptor provides a
 * sensible default).
 *
 * @param envelopeDigest - digest of the transfer envelope the segment belongs to
 * @param checksum - payload checksum from the sealed segment
 * @param sessionId - transport session id that governs this descriptor
 */
export function createSegmentDescriptor(
  handoffId: string,
  segmentId: string,
  byteLength: number,
  envelopeDigest: string,
  checksum: string,
  sessionId: string,
): PrismKvSegmentDescriptor {
  const now = Date.now()
  const nonce = crypto.randomUUID()
  const descriptorPayload = `${handoffId}:${segmentId}:${byteLength}:${envelopeDigest}:${checksum}:${sessionId}:${nonce}`
  const descriptorSignature = `sig-${descriptorPayload}`

  return {
    handoffId,
    segmentId,
    byteLength,
    alignment: 1,
    envelopeDigest,
    payloadChecksum: checksum,
    expiresAt: new Date(now + DEFAULT_DESCRIPTOR_TTL_MS).toISOString(),
    transportSessionId: sessionId,
    descriptorNonce: nonce,
    descriptorSignature,
  }
}

// ── Binding Validation ──────────────────────────────────────────────────────

/**
 * Validates that a descriptor is bound to the expected handoff and segment.
 *
 * Returns `{ valid: true, reason: null }` when both identifiers match;
 * otherwise `{ valid: false, reason }` describing the first mismatch found.
 */
export function validateDescriptorBinding(
  desc: PrismKvSegmentDescriptor,
  expectedHandoffId: string,
  expectedSegmentId: string,
): { valid: boolean; reason: string | null } {
  if (desc.handoffId !== expectedHandoffId) {
    return {
      valid: false,
      reason: `handoffId mismatch: expected "${expectedHandoffId}", got "${desc.handoffId}"`,
    }
  }
  if (desc.segmentId !== expectedSegmentId) {
    return {
      valid: false,
      reason: `segmentId mismatch: expected "${expectedSegmentId}", got "${desc.segmentId}"`,
    }
  }
  return { valid: true, reason: null }
}

/**
 * Returns `true` when the descriptor's `expiresAt` has passed.
 */
export function isDescriptorExpired(desc: PrismKvSegmentDescriptor): boolean {
  return Date.parse(desc.expiresAt) <= Date.now()
}
