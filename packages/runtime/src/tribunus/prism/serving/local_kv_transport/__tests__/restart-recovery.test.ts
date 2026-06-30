/**
 * Tests — Restart Recovery
 *
 * Validates that orphan records and segments are handled correctly
 * after a process restart (simulating persisted state).
 */

import { describe, it, expect } from "bun:test"
import type { PrismKvSharedMemorySegment, OrphanSegmentRecord } from "../local-transport-types"
import { scanExpiredSegments, isOrphanReclaimable } from "../orphan-recovery"

describe("restart recovery — scan expired segments", () => {
  it("expired segments from before restart are detected", () => {
    const seg: PrismKvSharedMemorySegment = {
      segmentId: "seg-restart-1",
      handoffId: "ho-restart-1",
      ownerWorkerInstanceId: "worker-a",
      destinationWorkerInstanceId: "worker-b",
      hostInstanceId: "host-1",
      byteLength: 8192,
      mappedByteLength: 8192,
      alignment: 64,
      createdAt: "2025-01-01T00:00:00.000Z",
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      state: "cancelled",
      payloadChecksum: "abc",
      descriptorDigest: "def",
    }
    const expired = scanExpiredSegments([seg])
    expect(expired).toHaveLength(1)
    expect(expired[0].segmentId).toBe("seg-restart-1")
  })

  it("segments in active states survive restart (not eligible for cleanup)", () => {
    const seg: PrismKvSharedMemorySegment = {
      segmentId: "seg-active",
      handoffId: "ho-active",
      ownerWorkerInstanceId: "worker-a",
      destinationWorkerInstanceId: "worker-b",
      hostInstanceId: "host-1",
      byteLength: 4096,
      mappedByteLength: 0,
      alignment: 64,
      createdAt: "2025-01-01T00:00:00.000Z",
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      state: "allocated",
      payloadChecksum: "",
      descriptorDigest: "",
    }
    // Even though expired, "allocated" is an active state → excluded
    expect(scanExpiredSegments([seg])).toHaveLength(0)
  })

  it("acknowledged segments are expired-state candidates after restart", () => {
    const seg: PrismKvSharedMemorySegment = {
      segmentId: "seg-acked",
      handoffId: "ho-acked",
      ownerWorkerInstanceId: "worker-a",
      destinationWorkerInstanceId: "worker-b",
      hostInstanceId: "host-1",
      byteLength: 4096,
      mappedByteLength: 4096,
      alignment: 64,
      createdAt: "2025-01-01T00:00:00.000Z",
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      state: "acknowledged",
      payloadChecksum: "",
      descriptorDigest: "",
    }
    // "acknowledged" is NOT in active states → included
    expect(scanExpiredSegments([seg])).toHaveLength(1)
  })
})

describe("restart recovery — orphan records", () => {
  it("persisted reclaimed records are not reclaimable after restart", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "seg-restart",
      handoffId: "ho-r",
      ownerInstanceId: "w1",
      byteLength: 4096,
      state: "released",
      expiredAt: "2025-01-01T00:00:00.000Z",
      reclaimedAt: "2025-01-02T00:00:00.000Z", // was reclaimed before restart
      quarantined: false,
    }
    expect(isOrphanReclaimable(record)).toBe(false)
  })

  it("persisted unreclaimed records are reclaimable after restart", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "seg-reclaimable",
      handoffId: "ho-r",
      ownerInstanceId: "w1",
      byteLength: 4096,
      state: "expired",
      expiredAt: new Date(Date.now() - 60_000).toISOString(),
      reclaimedAt: null,
      quarantined: false,
    }
    expect(isOrphanReclaimable(record)).toBe(true)
  })

  it("quarantined records survive restart and stay non-reclaimable", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "seg-quarantined",
      handoffId: "ho-q",
      ownerInstanceId: "w1",
      byteLength: 4096,
      state: "failed",
      expiredAt: "2025-01-01T00:00:00.000Z",
      reclaimedAt: null,
      quarantined: true,
    }
    expect(isOrphanReclaimable(record)).toBe(false)
  })
})
