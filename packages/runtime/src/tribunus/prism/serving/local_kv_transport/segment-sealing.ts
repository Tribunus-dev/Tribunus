/**
 * Prism Local-Host KV Transport — Segment Sealing Protocol
 *
 * Pure functions that evolve a `PrismKvSharedMemorySegment` through the
 * happy-path state transitions:
 *
 *   allocated → writing → sealed → offered → mapped_by_destination
 *   → import_verified → acknowledged → released
 *
 * Each function returns a **new** segment object with the updated state.
 */

import type { PrismKvSharedMemorySegment } from "./local-transport-types"
import { applySegmentAction } from "./local-segment-lifecycle"

// ── Seal Protocol Steps ─────────────────────────────────────────────────────

/**
 * Advances the segment from `"writing"` to `"sealed"`.
 *
 * Also records the final `descriptorDigest` (derived from handoffId + segmentId
 * as a stable synthetic fingerprint for test assertions).
 *
 * Returns the same segment unchanged when the transition is invalid.
 */
export function sealSegment(seg: PrismKvSharedMemorySegment): PrismKvSharedMemorySegment {
  const next = applySegmentAction(seg.state, "sealed")
  if (next === seg.state) return { ...seg }
  return {
    ...seg,
    state: next,
    descriptorDigest: `dd:${seg.handoffId}:${seg.segmentId}`,
  }
}

/**
 * Advances the segment from `"offered"` to `"mapped_by_destination"`.
 *
 * Also records the `mappedByteLength` (the full segment `byteLength`).
 *
 * Returns the same segment unchanged when the transition is invalid.
 */
export function markMapped(seg: PrismKvSharedMemorySegment): PrismKvSharedMemorySegment {
  const next = applySegmentAction(seg.state, "mapped_by_destination")
  if (next === seg.state) return { ...seg }
  return {
    ...seg,
    state: next,
    mappedByteLength: seg.byteLength,
  }
}

/**
 * Advances the segment from `"mapped_by_destination"` to `"import_verified"`.
 *
 * Returns the same segment unchanged when the transition is invalid.
 */
export function markVerified(seg: PrismKvSharedMemorySegment): PrismKvSharedMemorySegment {
  const next = applySegmentAction(seg.state, "import_verified")
  if (next === seg.state) return { ...seg }
  return { ...seg, state: next }
}

/**
 * Advances the segment from `"import_verified"` to `"acknowledged"`.
 *
 * Returns the same segment unchanged when the transition is invalid.
 */
export function markAcknowledged(seg: PrismKvSharedMemorySegment): PrismKvSharedMemorySegment {
  const next = applySegmentAction(seg.state, "acknowledged")
  if (next === seg.state) return { ...seg }
  return { ...seg, state: next }
}

/**
 * Advances the segment from `"acknowledged"` to `"released"`.
 *
 * Returns the same segment unchanged when the transition is invalid.
 */
export function releaseSegment(seg: PrismKvSharedMemorySegment): PrismKvSharedMemorySegment {
  const next = applySegmentAction(seg.state, "released")
  if (next === seg.state) return { ...seg }
  return { ...seg, state: next }
}

// ── Eligibility ─────────────────────────────────────────────────────────────

/**
 * Returns `true` when the segment is in `"writing"` (i.e. ready to be sealed).
 */
export function isSegmentSealable(seg: PrismKvSharedMemorySegment): boolean {
  return seg.state === "writing"
}
