/**
 * Prism Local-Host KV Transport — Transfer Envelope
 *
 * Creation, validation, and digest computation for transfer envelopes that
 * describe the payload being transferred between KV workers.
 */

import type { PrismKvTransferEnvelope } from "./local-transport-types"

// ── Digest Computation ──────────────────────────────────────────────────────

/**
 * Compute a digest over the canonical fields of a transfer envelope.
 * Fields are concatenated with `|` separator before hashing.
 */
export function computeEnvelopeDigest(envelope: PrismKvTransferEnvelope): string {
  const canonical = [
    String(envelope.envelopeVersion),
    envelope.handoffId,
    envelope.sourceKvNamespaceId,
    envelope.modelArtifactDigest,
    envelope.tokenizerDigest,
    envelope.compatibilityDescriptorDigest,
    envelope.transferRepresentation,
    String(envelope.sequenceLength),
    String(envelope.layerCount),
    String(envelope.pageCount),
    String(envelope.payloadByteLength),
    String(envelope.payloadAlignment),
    envelope.payloadChecksum,
    envelope.createdAt,
  ].join("|")

  // Use Bun's native CryptoHasher for synchronous hashing
  const encoder = new TextEncoder()
  const data = encoder.encode(canonical)
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(data)
  return hasher.digest("hex")
}

// ── Creation ────────────────────────────────────────────────────────────────

/**
 * Create a transfer envelope from component parts.
 * Sets `createdAt` to the current ISO timestamp and `envelopeVersion` to 1.
 */
export function createTransferEnvelope(
  handoffId: string,
  nsId: string,
  modelDigest: string,
  tokenizerDigest: string,
  compatDigest: string,
  rep: string,
  seqLen: number,
  layers: number,
  pages: number,
  bytes: number,
  align: number,
  checksum: string,
): PrismKvTransferEnvelope {
  const envelope: PrismKvTransferEnvelope = {
    envelopeVersion: 1,
    handoffId,
    sourceKvNamespaceId: nsId,
    modelArtifactDigest: modelDigest,
    tokenizerDigest,
    compatibilityDescriptorDigest: compatDigest,
    transferRepresentation: rep,
    sequenceLength: seqLen,
    layerCount: layers,
    pageCount: pages,
    payloadByteLength: bytes,
    payloadAlignment: align,
    payloadChecksum: checksum,
    createdAt: new Date().toISOString(),
  }
  return envelope
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate an envelope against an expected handoff id.
 * Returns `{ valid: true, reason: null }` on success or
 * `{ valid: false, reason }` with a descriptive reason string.
 */
export function validateEnvelope(
  envelope: PrismKvTransferEnvelope,
  expectedHandoffId: string,
): { valid: boolean; reason: string | null } {
  if (!envelope) {
    return { valid: false, reason: "envelope is null or undefined" }
  }

  if (envelope.envelopeVersion < 1) {
    return { valid: false, reason: `invalid envelope version: ${envelope.envelopeVersion}` }
  }

  if (!envelope.handoffId || envelope.handoffId.length === 0) {
    return { valid: false, reason: "envelope handoffId is empty" }
  }

  if (envelope.handoffId !== expectedHandoffId) {
    return {
      valid: false,
      reason: `handoffId mismatch: expected "${expectedHandoffId}", got "${envelope.handoffId}"`,
    }
  }

  if (!envelope.sourceKvNamespaceId || envelope.sourceKvNamespaceId.length === 0) {
    return { valid: false, reason: "envelope sourceKvNamespaceId is empty" }
  }

  if (envelope.sequenceLength <= 0) {
    return { valid: false, reason: `invalid sequenceLength: ${envelope.sequenceLength}` }
  }

  if (envelope.layerCount <= 0) {
    return { valid: false, reason: `invalid layerCount: ${envelope.layerCount}` }
  }

  if (envelope.pageCount <= 0) {
    return { valid: false, reason: `invalid pageCount: ${envelope.pageCount}` }
  }

  if (envelope.payloadByteLength <= 0) {
    return { valid: false, reason: `invalid payloadByteLength: ${envelope.payloadByteLength}` }
  }

  if (envelope.payloadAlignment <= 0) {
    return { valid: false, reason: `invalid payloadAlignment: ${envelope.payloadAlignment}` }
  }

  if (!envelope.payloadChecksum || envelope.payloadChecksum.length === 0) {
    return { valid: false, reason: "envelope payloadChecksum is empty" }
  }

  if (!envelope.createdAt || envelope.createdAt.length === 0) {
    return { valid: false, reason: "envelope createdAt is empty" }
  }

  return { valid: true, reason: null }
}
