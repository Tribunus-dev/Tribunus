/**
 * Tests — Local Transport Corruption / Invalid State Detection
 *
 * Validates that pure functions handle invalid, surprising, or corrupt
 * inputs without throwing and produce sensible results.
 */

import { describe, it, expect } from "bun:test"
import { isTimeoutElapsed, getTimeoutDeadline } from "../transport-timeout"
import { scanExpiredSegments, reclaimSegment, isOrphanReclaimable } from "../orphan-recovery"
import { selectTransportBackend, canProceedWithRealTransport } from "../transport-coordinator-bridge"
import { getCancellationEffect, classifyCancelState } from "../transport-cancellation"
import type { PrismKvSharedMemorySegment, OrphanSegmentRecord } from "../local-transport-types"

describe("corrupt time inputs", () => {
  it("isTimeoutElapsed handles garbage string", () => {
    expect(isTimeoutElapsed("not-a-date-at-all", 1000)).toBe(true)
  })

  it("isTimeoutElapsed handles empty string", () => {
    expect(isTimeoutElapsed("", 1000)).toBe(true)
  })

  it("getTimeoutDeadline handles garbage string", () => {
    expect(getTimeoutDeadline("garbage", 1000)).toBe("garbage")
  })

  it("getTimeoutDeadline handles empty string", () => {
    expect(getTimeoutDeadline("", 1000)).toBe("")
  })

  it("getTimeoutDeadline handles negative timeoutMs", () => {
    const start = new Date().toISOString()
    const deadline = getTimeoutDeadline(start, -1000)
    // Should produce a date in the past
    expect(new Date(deadline).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("isTimeoutElapsed with negative timeoutMs should be true for any past start", () => {
    const past = new Date(Date.now() - 1000).toISOString()
    expect(isTimeoutElapsed(past, -1000)).toBe(true)
  })

  it("isTimeoutElapsed with NaN timeoutMs", () => {
    const past = new Date(Date.now() - 1000).toISOString()
    // NaN comparison in JS: Date.now() - start >= NaN is false
    expect(isTimeoutElapsed(past, NaN)).toBe(false)
  })
})

describe("corrupt segment inputs", () => {
  it("scanExpiredSegments handles null-like expiry", () => {
    const seg = {
      segmentId: "",
      handoffId: "",
      ownerWorkerInstanceId: "",
      destinationWorkerInstanceId: "",
      hostInstanceId: "",
      byteLength: 0,
      mappedByteLength: 0,
      alignment: 0,
      createdAt: "",
      expiresAt: "",
      state: "expired" as const,
      payloadChecksum: "",
      descriptorDigest: "",
    }
    // empty expiresAt → excluded
    expect(scanExpiredSegments([seg])).toHaveLength(0)
  })

  it("scanExpiredSegments handles unknown state gracefully", () => {
    const seg = {
      segmentId: "s1",
      handoffId: "ho-1",
      ownerWorkerInstanceId: "w1",
      destinationWorkerInstanceId: "w2",
      hostInstanceId: "h1",
      byteLength: 100,
      mappedByteLength: 100,
      alignment: 64,
      createdAt: "2025-01-01T00:00:00.000Z",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      state: "unknown_state" as never,
      payloadChecksum: "",
      descriptorDigest: "",
    }
    // unknown state → not in ACTIVE_STATES → treat as expired/terminal → included
    const result = scanExpiredSegments([seg])
    expect(result).toHaveLength(1)
  })

  it("reclaimSegment handles unknown state", () => {
    const seg = {
      segmentId: "s1",
      handoffId: "ho-1",
      ownerWorkerInstanceId: "w1",
      destinationWorkerInstanceId: "w2",
      hostInstanceId: "h1",
      byteLength: 100,
      mappedByteLength: 100,
      alignment: 64,
      createdAt: "",
      expiresAt: "",
      state: "bogus" as never,
      payloadChecksum: "",
      descriptorDigest: "",
    }
    const result = reclaimSegment(seg)
    expect(result.reclaimed).toBe(false)
    expect(result.reason).toContain("bogus")
  })

  it("isOrphanReclaimable handles unknown state in record", () => {
    const record: OrphanSegmentRecord = {
      segmentId: "s1",
      handoffId: "ho-1",
      ownerInstanceId: "w1",
      byteLength: 100,
      state: "bogus",
      expiredAt: "",
      reclaimedAt: null,
      quarantined: false,
    }
    // unknown state NOT in RECLAIMABLE_STATES → not reclaimable
    expect(isOrphanReclaimable(record)).toBe(false)
  })
})

describe("corrupt coordinator bridge inputs", () => {
  it("selectTransportBackend with unsupported capabilities", () => {
    const cap = {
      backendKind: "linux_unix_socket_shared_memory" as const,
      supported: false,
      protocolVersion: 1,
      maximumSegmentBytes: 0,
      maximumConcurrentSegments: 0,
      supportedTransferRepresentations: [],
      supportsReadOnlyDestinationMapping: false,
      supportsFdPassing: false,
      supportsIntegrityTrailer: false,
      supportsCancellation: false,
      supportsOrphanRecovery: false,
      platformCapabilityDigest: "",
    }
    const result = selectTransportBackend(cap, cap, true)
    expect(result.backend).toBeNull()
    expect(result.reason).toContain("does not support")
  })

  it("selectTransportBackend with mismatched backends", () => {
    const capA = {
      backendKind: "linux_unix_socket_shared_memory" as const,
      supported: true,
      protocolVersion: 1,
      maximumSegmentBytes: 0,
      maximumConcurrentSegments: 0,
      supportedTransferRepresentations: [],
      supportsReadOnlyDestinationMapping: false,
      supportsFdPassing: false,
      supportsIntegrityTrailer: false,
      supportsCancellation: false,
      supportsOrphanRecovery: false,
      platformCapabilityDigest: "",
    }
    const capB = { ...capA, backendKind: "test_fixture_transport" as const }
    const result = selectTransportBackend(capA, capB, true)
    expect(result.backend).toBeNull()
    expect(result.reason).toContain("do not match")
  })

  it("selectTransportBackend with lease disallowing", () => {
    const cap = {
      backendKind: "linux_unix_socket_shared_memory" as const,
      supported: true,
      protocolVersion: 1,
      maximumSegmentBytes: 0,
      maximumConcurrentSegments: 0,
      supportedTransferRepresentations: [],
      supportsReadOnlyDestinationMapping: false,
      supportsFdPassing: false,
      supportsIntegrityTrailer: false,
      supportsCancellation: false,
      supportsOrphanRecovery: false,
      platformCapabilityDigest: "",
    }
    const result = selectTransportBackend(cap, cap, false)
    expect(result.backend).toBeNull()
    expect(result.reason).toContain("lease")
  })

  it("canProceedWithRealTransport returns false when any flag is false", () => {
    expect(canProceedWithRealTransport(true, true, true, false)).toBe(false)
    expect(canProceedWithRealTransport(true, true, false, true)).toBe(false)
    expect(canProceedWithRealTransport(true, false, true, true)).toBe(false)
    expect(canProceedWithRealTransport(false, true, true, true)).toBe(false)
  })

  it("canProceedWithRealTransport returns true when all flags true", () => {
    expect(canProceedWithRealTransport(true, true, true, true)).toBe(true)
  })
})
