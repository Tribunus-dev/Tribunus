/**
 * Prism Local-Host KV Transport — Segment Creation & Eligibility
 *
 * Pure functions for creating shared-memory segments and checking their
 * lifecycle eligibility (expiry, write, map, active).
 */

import type { PrismKvSharedMemorySegment, SegmentState } from "./local-transport-types"

// ── Constants ───────────────────────────────────────────────────────────────

/** Default segment lifetime in milliseconds. */
export const DEFAULT_SEGMENT_TTL_MS = 60_000

// ── Segment Factory ─────────────────────────────────────────────────────────

/**
 * Creates a new `PrismKvSharedMemorySegment` in the `"allocated"` state.
 *
 * Generates a UUID `segmentId`, sets `createdAt`/`expiresAt` from `Date.now()`,
 * and initialises all remaining fields to sensible defaults.
 */
export function createSegment(
  handoffId: string,
  ownerInstanceId: string,
  destInstanceId: string,
  hostId: string,
  byteLength: number,
  alignment: number,
): PrismKvSharedMemorySegment {
  const now = Date.now()
  const segmentId = crypto.randomUUID()

  return {
    segmentId,
    handoffId,
    ownerWorkerInstanceId: ownerInstanceId,
    destinationWorkerInstanceId: destInstanceId,
    hostInstanceId: hostId,
    byteLength,
    mappedByteLength: 0,
    alignment,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEFAULT_SEGMENT_TTL_MS).toISOString(),
    state: "allocated",
    payloadChecksum: "",
    descriptorDigest: "",
  }
}

// ── Expiry ──────────────────────────────────────────────────────────────────

/**
 * Returns `true` when the segment's `expiresAt` has passed.
 */
export function isSegmentExpired(seg: PrismKvSharedMemorySegment): boolean {
  return Date.parse(seg.expiresAt) <= Date.now()
}

// ── Liveness ────────────────────────────────────────────────────────────────

const ACTIVE_STATES: readonly SegmentState[] = [
  "allocated",
  "writing",
  "sealed",
  "offered",
  "mapped_by_destination",
  "import_verified",
  "acknowledged",
]

const WRITE_ELIGIBLE_STATES: readonly SegmentState[] = ["allocated", "writing"]

const MAP_ELIGIBLE_STATES: readonly SegmentState[] = ["offered", "mapped_by_destination"]

/**
 * Returns `true` when the segment is in a non-terminal, non-failed, non-expired
 * state – i.e. it is still participating in the protocol.
 */
export function isSegmentActive(seg: PrismKvSharedMemorySegment): boolean {
  return ACTIVE_STATES.includes(seg.state) && !isSegmentExpired(seg)
}

/**
 * Returns `true` when the caller can still write payload data into the segment
 * (states "allocated" or "writing").
 */
export function canWriteToSegment(seg: PrismKvSharedMemorySegment): boolean {
  return WRITE_ELIGIBLE_STATES.includes(seg.state) && !isSegmentExpired(seg)
}

/**
 * Returns `true` when the destination worker can memory-map the segment
 * (states "offered" or "mapped_by_destination").
 */
export function canMapSegment(seg: PrismKvSharedMemorySegment): boolean {
  return MAP_ELIGIBLE_STATES.includes(seg.state) && !isSegmentExpired(seg)
}
