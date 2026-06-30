/**
 * Prism Local-Host KV Transport — File Descriptor Passing Abstraction
 *
 * Platform detection and payload creation for Unix file descriptor passing
 * via `SCM_RIGHTS` ancillary data over Unix domain sockets.
 */

import type { PrismKvSharedMemorySegment } from "./local-transport-types"

// ── Platform Support ────────────────────────────────────────────────────────

/**
 * Check whether the current platform supports Unix FD passing.
 * Only Linux is supported for FD-passing via SCM_RIGHTS.
 */
export function canPassFileDescriptors(): boolean {
  return typeof process !== "undefined" && process.platform === "linux"
}

// ── FD Passing Payload ──────────────────────────────────────────────────────

/**
 * Create a serializable payload describing a shared-memory segment for FD
 * passing. Returns a JSON string containing the segment metadata and a
 * descriptor nonce derived from the segment id.
 */
export function createFdPassingPayload(
  seg: PrismKvSharedMemorySegment,
): { fdPayload: string; byteLength: number } {
  const payload = JSON.stringify({
    segmentId: seg.segmentId,
    handoffId: seg.handoffId,
    byteLength: seg.byteLength,
    alignment: seg.alignment,
    payloadChecksum: seg.payloadChecksum,
    descriptorDigest: seg.descriptorDigest,
    descriptorNonce: `${seg.segmentId}:${seg.handoffId}:${seg.createdAt}`,
  })
  const encoder = new TextEncoder()
  return {
    fdPayload: payload,
    byteLength: encoder.encode(payload).byteLength,
  }
}

// ── Payload Validation ──────────────────────────────────────────────────────

/**
 * Validate that a received FD passing payload is well-formed and matches an
 * expected byte length.
 */
export function validateFdPayload(payload: string, expectedLength: number): boolean {
  if (!payload || payload.length === 0) {
    return false
  }

  // Must be valid JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return false
  }

  // Must be an object with required fields
  if (typeof parsed !== "object" || parsed === null) {
    return false
  }

  const obj = parsed as Record<string, unknown>

  if (typeof obj.segmentId !== "string" || obj.segmentId.length === 0) {
    return false
  }
  if (typeof obj.handoffId !== "string" || obj.handoffId.length === 0) {
    return false
  }
  if (typeof obj.byteLength !== "number" || obj.byteLength <= 0) {
    return false
  }
  if (typeof obj.alignment !== "number" || obj.alignment <= 0) {
    return false
  }

  // Verify byte length matches expected
  if (expectedLength > 0) {
    const encoder = new TextEncoder()
    const actualLen = encoder.encode(payload).byteLength
    if (actualLen !== expectedLength) {
      return false
    }
  }

  return true
}
