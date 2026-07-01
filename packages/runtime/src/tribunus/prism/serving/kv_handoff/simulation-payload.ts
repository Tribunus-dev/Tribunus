/**
 * Prism KV Handoff Protocol — Simulation Payload
 *
 * Deterministic payload creation, digest computation, and integrity
 * verification for the KV handoff simulation protocol. No real cross-worker
 * KV transport is involved.
 */

import { createHash } from "node:crypto"
import type { PrismKvSimulationPayload } from "./handoff-types"

const SUPPORTED_PAYLOAD_VERSIONS = [1]

/**
 * Create a deterministic PrismKvSimulationPayload from the essential fields.
 * Derived fields (payloadId, byteLength, modelArtifactDigest,
 * tokenizerDigest, compatibilityDescriptorDigest, deterministicContentDigest)
 * are computed deterministically from the inputs.
 */
export function createSimulationPayload(
  handoffId: string,
  nsId: string,
  seed: string,
  seqLen: number,
  layers: number,
  pages: number,
): PrismKvSimulationPayload {
  // Deterministic byte estimate: 2 bytes per KV entry, 2 entries per layer per position
  const bytesPerPosition = layers * 2 * 2
  const byteLength = seqLen * bytesPerPosition * pages
  const fixtureCombined = `${handoffId}|${nsId}|${seed}`
  const contentDigest = createHash("sha256").update(fixtureCombined).digest("hex")

  return {
    payloadId: `payload-${handoffId}`,
    handoffId,
    sourceKvNamespaceId: nsId,
    modelArtifactDigest: "",
    tokenizerDigest: "",
    compatibilityDescriptorDigest: "",
    sequenceLength: seqLen,
    layerCount: layers,
    pageCount: pages,
    byteLength,
    deterministicContentDigest: contentDigest,
    fixtureSeed: seed,
    payloadVersion: 1,
  }
}

/**
 * Compute a deterministic SHA-256 digest for a simulation payload.
 * Covers all essential fields (handoffId, nsId, seed, seqLen, layers, pages,
 * byteLength, payloadVersion) in canonical order.
 */
export function computePayloadDigest(payload: PrismKvSimulationPayload): string {
  const canonical = [
    payload.handoffId,
    payload.sourceKvNamespaceId,
    payload.fixtureSeed,
    String(payload.sequenceLength),
    String(payload.layerCount),
    String(payload.pageCount),
    String(payload.byteLength),
    String(payload.payloadVersion),
  ].join("|")

  return createHash("sha256").update(canonical).digest("hex")
}

/**
 * Verify the integrity of a simulation payload against an expected digest.
 * Returns true if the recomputed digest matches.
 */
export function verifyPayloadIntegrity(
  payload: PrismKvSimulationPayload,
  expectedDigest: string,
): boolean {
  const actual = computePayloadDigest(payload)
  return actual === expectedDigest
}

/**
 * Check whether a payload version is supported by this implementation.
 */
export function isPayloadVersionSupported(version: number): boolean {
  return SUPPORTED_PAYLOAD_VERSIONS.includes(version)
}
