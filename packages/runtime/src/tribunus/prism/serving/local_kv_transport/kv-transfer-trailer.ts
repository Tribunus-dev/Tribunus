/**
 * Prism Local-Host KV Transport — Transfer Trailer
 *
 * Trailer creation and validation. The trailer follows the envelope and
 * payload to provide end-to-end integrity verification.
 */

import type { PrismKvTransferEnvelope, PrismKvTransferTrailer } from "./local-transport-types"
import { computeEnvelopeDigest } from "./kv-transfer-envelope"

// ── Creation ────────────────────────────────────────────────────────────────

/**
 * Create a transfer trailer from an envelope digest plus payload metadata.
 * Sets `serializationGeneration` to 1 and `completedAt` to the current ISO timestamp.
 */
export function createTransferTrailer(
  envelopeDigest: string,
  checksum: string,
  bytes: number,
): PrismKvTransferTrailer {
  return {
    envelopeDigest,
    payloadChecksum: checksum,
    payloadByteLength: bytes,
    serializationGeneration: 1,
    completedAt: new Date().toISOString(),
  }
}

/**
 * Convenience: build a trailer directly from an envelope, computing the
 * envelope digest automatically.
 */
export function buildTrailerFromEnvelope(
  envelope: PrismKvTransferEnvelope,
): PrismKvTransferTrailer {
  return createTransferTrailer(
    computeEnvelopeDigest(envelope),
    envelope.payloadChecksum,
    envelope.payloadByteLength,
  )
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a trailer against expected values.
 * Checks envelope digest, payload checksum, and byte length.
 */
export function validateTrailer(
  trailer: PrismKvTransferTrailer,
  expectedEnvelopeDigest: string,
  expectedChecksum: string,
  expectedBytes: number,
): { valid: boolean; reason: string | null } {
  if (!trailer) {
    return { valid: false, reason: "trailer is null or undefined" }
  }

  if (!trailer.envelopeDigest || trailer.envelopeDigest.length === 0) {
    return { valid: false, reason: "trailer envelopeDigest is empty" }
  }

  if (trailer.envelopeDigest !== expectedEnvelopeDigest) {
    return {
      valid: false,
      reason: `envelopeDigest mismatch: expected "${expectedEnvelopeDigest}", got "${trailer.envelopeDigest}"`,
    }
  }

  if (!trailer.payloadChecksum || trailer.payloadChecksum.length === 0) {
    return { valid: false, reason: "trailer payloadChecksum is empty" }
  }

  if (trailer.payloadChecksum !== expectedChecksum) {
    return {
      valid: false,
      reason: `payloadChecksum mismatch: expected "${expectedChecksum}", got "${trailer.payloadChecksum}"`,
    }
  }

  if (trailer.payloadByteLength !== expectedBytes) {
    return {
      valid: false,
      reason: `payloadByteLength mismatch: expected ${expectedBytes}, got ${trailer.payloadByteLength}`,
    }
  }

  if (trailer.serializationGeneration < 1) {
    return {
      valid: false,
      reason: `invalid serializationGeneration: ${trailer.serializationGeneration}`,
    }
  }

  if (!trailer.completedAt || trailer.completedAt.length === 0) {
    return { valid: false, reason: "trailer completedAt is empty" }
  }

  return { valid: true, reason: null }
}
