/**
 * Prism Local-Host KV Transport — Orphan Recovery
 *
 * Pure functions that identify, quarantine, and reclaim expired or
 * abandoned shared-memory segments.
 */

import type { PrismKvSharedMemorySegment, OrphanSegmentRecord } from "./local-transport-types"

/** Segment states considered actively in-use (not reclaimable). */
const ACTIVE_STATES: Record<string, true> = {
  allocated: true,
  writing: true,
  sealed: true,
  offered: true,
  mapped_by_destination: true,
  import_verified: true,
}

/** Segment states considered terminal / abandoned (reclaimable). */
const RECLAIMABLE_STATES: Record<string, true> = {
  released: true,
  failed: true,
  cancelled: true,
  expired: true,
}

/**
 * Scan an array of segments and return those whose expiry time has passed
 * and whose state indicates they are no longer in active use.
 *
 * Active states (excluded): "allocated", "writing", "sealed", "offered",
 * "mapped_by_destination", "import_verified".  Terminal / abandoned states
 * (included): "acknowledged", "released", "failed", "cancelled", "expired".
 */
export function scanExpiredSegments(segments: PrismKvSharedMemorySegment[]): PrismKvSharedMemorySegment[] {
  const now = Date.now()
  return segments.filter((seg) => {
    if (seg.expiresAt === "") return false
    const expiresAt = new Date(seg.expiresAt).getTime()
    if (Number.isNaN(expiresAt)) return false
    if (now < expiresAt) return false

    // Only consider segments in terminal / abandoned states.
    return !ACTIVE_STATES[seg.state]
  })
}

/**
 * Attempt to reclaim a segment.  Returns `{ reclaimed: true, reason: null }`
 * for segments that are safe to reclaim.
 *
 * A segment is reclaimable when its state is one of: "released", "failed",
 * "cancelled", "expired".  Segments still in an active or ambiguous state
 * are not reclaimable.
 */
export function reclaimSegment(
  seg: PrismKvSharedMemorySegment,
): { reclaimed: boolean; reason: string | null } {
  if (RECLAIMABLE_STATES[seg.state]) {
    return { reclaimed: true, reason: null }
  }
  return { reclaimed: false, reason: `segment in state '${seg.state}' is not reclaimable` }
}

/**
 * Mark a segment as quarantined for manual inspection.  Returns a new
 * segment object with the state forced to "expired".
 */
export function quarantineSegment(seg: PrismKvSharedMemorySegment): PrismKvSharedMemorySegment {
  return { ...seg, state: "expired" }
}

/**
 * Build an `OrphanSegmentRecord` from a segment for persistence or alerting.
 */
export function createOrphanRecord(seg: PrismKvSharedMemorySegment): OrphanSegmentRecord {
  return {
    segmentId: seg.segmentId,
    handoffId: seg.handoffId,
    ownerInstanceId: seg.ownerWorkerInstanceId,
    byteLength: seg.byteLength,
    state: seg.state,
    expiredAt: seg.expiresAt,
    reclaimedAt: null,
    quarantined: false,
  }
}

/**
 * Return true when an orphan record is eligible for reclaim.
 *
 * An orphan is reclaimable when it has NOT been reclaimed already
 * (`reclaimedAt` is null), it is NOT quarantined, and its state is
 * a terminal/abandoned state.
 */
export function isOrphanReclaimable(record: OrphanSegmentRecord): boolean {
  if (record.reclaimedAt !== null) return false
  if (record.quarantined) return false
  return !!RECLAIMABLE_STATES[record.state]
}
