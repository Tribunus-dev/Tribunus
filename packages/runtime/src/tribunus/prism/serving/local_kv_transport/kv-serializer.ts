/**
 * Prism Local-Host KV Transport — Serializer
 *
 * Transfer representation support, size estimation, checksum computation,
 * and envelope/trailer construction.
 */

import type { PrismKvTransferEnvelope, PrismKvTransferTrailer } from "./local-transport-types"
import { createTransferEnvelope, computeEnvelopeDigest } from "./kv-transfer-envelope"
import { createTransferTrailer } from "./kv-transfer-trailer"

// ── Representation Support ──────────────────────────────────────────────────

/**
 * Check whether a transfer representation string is in the set of supported
 * representations.
 */
export function canSerialize(representation: string, supportedReps: string[]): boolean {
  if (!representation || representation.length === 0) {
    return false
  }
  return supportedReps.includes(representation)
}

// ── Size Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate the total serialized byte count for a transfer payload.
 * Rough approximation: sequence length * layers * pages * bytes per page.
 */
export function estimateSerializedBytes(
  seqLen: number,
  layers: number,
  pages: number,
  bytesPerPage: number,
): number {
  const estimated = seqLen * layers * pages * bytesPerPage
  return estimated <= 0 ? 0 : estimated
}

// ── Checksum ────────────────────────────────────────────────────────────────
/**
 * Compute a SHA-256 hex checksum over arbitrary string data.
 */
export function computeChecksum(data: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(data)
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(bytes)
  return hasher.digest("hex")
}

// ── Builder Functions ───────────────────────────────────────────────────────

/**
 * Build a complete transfer envelope from key parameters.
 * The checksum and createdAt fields are set automatically.
 *
 * @param handoffId - unique handoff identifier
 * @param nsId - source KV namespace id
 * @param modelDigest - model artifact digest string
 * @param compatDigest - compatibility descriptor digest
 * @param seqLen - sequence length
 * @param layers - number of layers
 * @param pages - number of pages
 * @param bytes - total payload byte length
 */
export function buildEnvelope(
  handoffId: string,
  nsId: string,
  modelDigest: string,
  compatDigest: string,
  seqLen: number,
  layers: number,
  pages: number,
  bytes: number,
): PrismKvTransferEnvelope {
  // Build a canonical representation for the checksum
  const canonical = [handoffId, nsId, modelDigest, String(seqLen), String(layers), String(pages), String(bytes)].join(":")
  const checksum = computeChecksum(canonical)

  return createTransferEnvelope(
    handoffId,
    nsId,
    modelDigest,
    "",                // tokenizerDigest — empty default
    compatDigest,
    "flat_buffer",     // default transfer representation
    seqLen,
    layers,
    pages,
    bytes,
    64,                // default alignment
    checksum,
  )
}

/**
 * Build a transfer trailer from an existing envelope.
 */
export function buildTrailer(envelope: PrismKvTransferEnvelope): PrismKvTransferTrailer {
  const envDigest = computeEnvelopeDigest(envelope)
  return createTransferTrailer(envDigest, envelope.payloadChecksum, envelope.payloadByteLength)
}
