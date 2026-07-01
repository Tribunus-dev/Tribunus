/**
 * Tests — Orphan Recovery
 */

import { describe, it, expect } from "bun:test"
import type { PrismKvSharedMemorySegment, OrphanSegmentRecord } from "../local-transport-types"
import {
  scanExpiredSegments,
  reclaimSegment,
  quarantineSegment,
  createOrphanRecord,
  isOrphanReclaimable,
} from "../orphan-recovery"

function makeSegment(overrides: Partial<PrismKvSharedMemorySegment> = {}): PrismKvSharedMemorySegment {
  return {
    segmentId: "seg-1",
    handoffId: "ho-1",
    ownerWorkerInstanceId: "worker-a",
    destinationWorkerInstanceId: "worker-b",
    hostInstanceId: "host-1",
    byteLength: 4096,
    mappedByteLength: 4096,
    alignment: 64,
    createdAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2025-01-01T00:00:10.000Z",
    state: "expired",
    payloadChecksum: "abc123",
    descriptorDigest: "def456",
    ...overrides,
  }
}

function pastExpiry(): string {
  return new Date(Date.now() - 60_000).toISOString()
}

function futureExpiry(): string {
  return new Date(Date.now() + 60_000).toISOString()
}

describe("scanExpiredSegments", () => {
  it("returns expired terminal segments", () => {
    const seg = makeSegment({ expiresAt: pastExpiry(), state: "expired" })
    const result = scanExpiredSegments([seg])
    expect(result).toHaveLength(1)
    expect(result[0].segmentId).toBe("seg-1")
  })

  it("excludes active segments that are expired", () => {
    const seg = makeSegment({ expiresAt: pastExpiry(), state: "allocated" })
    expect(scanExpiredSegments([seg])).toHaveLength(0)
  })

  it("excludes non-expired segments", () => {
    const seg = makeSegment({ expiresAt: futureExpiry(), state: "expired" })
    expect(scanExpiredSegments([seg])).toHaveLength(0)
  })

  it("handles empty expiresAt gracefully", () => {
    const seg = makeSegment({ expiresAt: "" })
    expect(scanExpiredSegments([seg])).toHaveLength(0)
  })

  it("handles empty array", () => {
    expect(scanExpiredSegments([])).toHaveLength(0)
  })

  it("returns multiple expired segments", () => {
    const segs = [
      makeSegment({ segmentId: "s1", expiresAt: pastExpiry(), state: "cancelled" }),
      makeSegment({ segmentId: "s2", expiresAt: pastExpiry(), state: "failed" }),
      makeSegment({ segmentId: "s3", expiresAt: pastExpiry(), state: "acknowledged" }),
    ]
    expect(scanExpiredSegments(segs)).toHaveLength(3)
  })
})

describe("reclaimSegment", () => {
  it("reclaims an expired segment", () => {
    const seg = makeSegment({ state: "expired" })
    expect(reclaimSegment(seg)).toEqual({ reclaimed: true, reason: null })
  })

  it("reclaims a released segment", () => {
    const seg = makeSegment({ state: "released" })
    expect(reclaimSegment(seg)).toEqual({ reclaimed: true, reason: null })
  })

  it("reclaims a failed segment", () => {
    const seg = makeSegment({ state: "failed" })
    expect(reclaimSegment(seg)).toEqual({ reclaimed: true, reason: null })
  })

  it("reclaims a cancelled segment", () => {
    const seg = makeSegment({ state: "cancelled" })
    expect(reclaimSegment(seg)).toEqual({ reclaimed: true, reason: null })
  })

  it("rejects an allocated segment", () => {
    const seg = makeSegment({ state: "allocated" })
    const result = reclaimSegment(seg)
    expect(result.reclaimed).toBe(false)
    expect(result.reason).toContain("allocated")
  })

  it("rejects a sealed segment", () => {
    const seg = makeSegment({ state: "sealed" })
    const result = reclaimSegment(seg)
    expect(result.reclaimed).toBe(false)
    expect(result.reason).not.toBeNull()
  })
})

describe("quarantineSegment", () => {
  it("forces state to expired", () => {
    const seg = makeSegment({ state: "allocated" })
    const quarantined = quarantineSegment(seg)
    expect(quarantined.state).toBe("expired")
  })

  it("does not mutate the original segment", () => {
    const seg = makeSegment({ state: "writing" })
    quarantineSegment(seg)
    expect(seg.state).toBe("writing")
  })

  it("preserves other properties", () => {
    const seg = makeSegment({ segmentId: "seg-99", byteLength: 8192 })
    const quarantined = quarantineSegment(seg)
    expect(quarantined.segmentId).toBe("seg-99")
    expect(quarantined.byteLength).toBe(8192)
  })
})

describe("createOrphanRecord", () => {
  it("creates a record from a segment", () => {
    const seg = makeSegment()
    const record = createOrphanRecord(seg)
    expect(record.segmentId).toBe("seg-1")
    expect(record.handoffId).toBe("ho-1")
    expect(record.ownerInstanceId).toBe("worker-a")
    expect(record.byteLength).toBe(4096)
    expect(record.state).toBe("expired")
    expect(record.reclaimedAt).toBeNull()
    expect(record.quarantined).toBe(false)
  })
})

describe("isOrphanReclaimable", () => {
  it("returns true for unreclaimed, not quarantined, terminal state", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "s1",
      handoffId: "ho-1",
      ownerInstanceId: "w1",
      byteLength: 4096,
      state: "expired",
      expiredAt: "2025-01-01T00:00:00.000Z",
      reclaimedAt: null,
      quarantined: false,
    }
    expect(isOrphanReclaimable(record)).toBe(true)
  })

  it("returns false when already reclaimed", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "s1",
      handoffId: "ho-1",
      ownerInstanceId: "w1",
      byteLength: 4096,
      state: "released",
      expiredAt: "2025-01-01T00:00:00.000Z",
      reclaimedAt: "2025-01-02T00:00:00.000Z",
      quarantined: false,
    }
    expect(isOrphanReclaimable(record)).toBe(false)
  })

  it("returns false when quarantined", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "s1",
      handoffId: "ho-1",
      ownerInstanceId: "w1",
      byteLength: 4096,
      state: "expired",
      expiredAt: "2025-01-01T00:00:00.000Z",
      reclaimedAt: null,
      quarantined: true,
    }
    expect(isOrphanReclaimable(record)).toBe(false)
  })

  it("returns false for active state", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "s1",
      handoffId: "ho-1",
      ownerInstanceId: "w1",
      byteLength: 4096,
      state: "writing",
      expiredAt: "2025-01-01T00:00:00.000Z",
      reclaimedAt: null,
      quarantined: false,
    }
    expect(isOrphanReclaimable(record)).toBe(false)
  })

  it("returns true for released state", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "s1",
      handoffId: "ho-1",
      ownerInstanceId: "w1",
      byteLength: 4096,
      state: "released",
      expiredAt: "2025-01-01T00:00:00.000Z",
      reclaimedAt: null,
      quarantined: false,
    }
    expect(isOrphanReclaimable(record)).toBe(true)
  })
})
