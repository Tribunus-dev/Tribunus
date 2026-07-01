/**
 * Prism Local-Host KV Transport — FD Passing & Segment Management Tests
 */

import { expect, test, describe } from "bun:test"
import type { PrismKvSharedMemorySegment } from "../local-transport-types"
import {
  getMaxSegmentBytes,
  getDefaultAlignment,
  isSegmentSizeValid,
} from "../linux-shared-memory-segment"
import {
  canPassFileDescriptors,
  createFdPassingPayload,
  validateFdPayload,
} from "../fd-passing"
import {
  isLinuxTransportAvailable,
  createLinuxTransportCapability,
  getLinuxTransportStatus,
} from "../linux-unix-socket-transport"

// ── Linux Shared Memory Segment ─────────────────────────────────────────────

describe("getMaxSegmentBytes", () => {
  test("returns positive default max bytes", () => {
    const max = getMaxSegmentBytes()
    expect(max).toBeGreaterThan(0)
    expect(max).toBe(256 * 1024 * 1024)
  })
})

describe("getDefaultAlignment", () => {
  test("returns expected page alignment", () => {
    const align = getDefaultAlignment()
    expect(align).toBe(4096)
  })
})

describe("isSegmentSizeValid", () => {
  const maxBytes = 256 * 1024 * 1024

  test("valid page-aligned size under max passes", () => {
    expect(isSegmentSizeValid(4096, maxBytes)).toBe(true)
    expect(isSegmentSizeValid(65536, maxBytes)).toBe(true)
    expect(isSegmentSizeValid(1048576, maxBytes)).toBe(true)
  })

  test("zero bytes is invalid", () => {
    expect(isSegmentSizeValid(0, maxBytes)).toBe(false)
  })

  test("negative bytes is invalid", () => {
    expect(isSegmentSizeValid(-1, maxBytes)).toBe(false)
  })

  test("size exceeding maxBytes is invalid", () => {
    expect(isSegmentSizeValid(maxBytes + 1, maxBytes)).toBe(false)
  })

  test("non-page-aligned size is invalid", () => {
    expect(isSegmentSizeValid(100, maxBytes)).toBe(false)
    expect(isSegmentSizeValid(4097, maxBytes)).toBe(false)
    expect(isSegmentSizeValid(8191, maxBytes)).toBe(false)
  })

  test("exact max page-aligned is valid", () => {
    expect(isSegmentSizeValid(maxBytes, maxBytes)).toBe(true)
  })
})

// ── FD Passing ──────────────────────────────────────────────────────────────

describe("canPassFileDescriptors", () => {
  test("returns boolean", () => {
    const result = canPassFileDescriptors()
    expect(typeof result).toBe("boolean")
  })
})

describe("createFdPassingPayload", () => {
  const seg: PrismKvSharedMemorySegment = {
    segmentId: "seg_001",
    handoffId: "handoff_test_001",
    ownerWorkerInstanceId: "worker_a_1",
    destinationWorkerInstanceId: "worker_b_1",
    hostInstanceId: "host_001",
    byteLength: 65536,
    mappedByteLength: 65536,
    alignment: 4096,
    createdAt: "2026-06-30T12:00:00.000Z",
    expiresAt: "2026-06-30T13:00:00.000Z",
    state: "allocated",
    payloadChecksum: "a1b2c3d4",
    descriptorDigest: "sha256:desc_digest",
  }

  test("produces valid JSON payload", () => {
    const result = createFdPassingPayload(seg)
    expect(result.fdPayload).toBeTruthy()
    expect(result.byteLength).toBeGreaterThan(0)

    const parsed = JSON.parse(result.fdPayload)
    expect(parsed.segmentId).toBe("seg_001")
    expect(parsed.handoffId).toBe("handoff_test_001")
    expect(parsed.byteLength).toBe(65536)
    expect(parsed.alignment).toBe(4096)
    expect(parsed.payloadChecksum).toBe("a1b2c3d4")
    expect(parsed.descriptorDigest).toBe("sha256:desc_digest")
    expect(parsed.descriptorNonce).toBeTruthy()
  })

  test("byteLength matches encoded payload size", () => {
    const result = createFdPassingPayload(seg)
    const encoder = new TextEncoder()
    expect(encoder.encode(result.fdPayload).byteLength).toBe(result.byteLength)
  })
})

describe("validateFdPayload", () => {
  const seg: PrismKvSharedMemorySegment = {
    segmentId: "seg_001",
    handoffId: "handoff_test_001",
    ownerWorkerInstanceId: "worker_a_1",
    destinationWorkerInstanceId: "worker_b_1",
    hostInstanceId: "host_001",
    byteLength: 65536,
    mappedByteLength: 65536,
    alignment: 4096,
    createdAt: "2026-06-30T12:00:00.000Z",
    expiresAt: "2026-06-30T13:00:00.000Z",
    state: "allocated",
    payloadChecksum: "a1b2c3d4",
    descriptorDigest: "sha256:desc_digest",
  }

  test("valid payload passes with correct expected length", () => {
    const { fdPayload, byteLength } = createFdPassingPayload(seg)
    expect(validateFdPayload(fdPayload, byteLength)).toBe(true)
  })

  test("valid payload passes with zero expected length (skip length check)", () => {
    const { fdPayload } = createFdPassingPayload(seg)
    expect(validateFdPayload(fdPayload, 0)).toBe(true)
  })

  test("valid payload fails with wrong expected length", () => {
    const { fdPayload } = createFdPassingPayload(seg)
    expect(validateFdPayload(fdPayload, 9999)).toBe(false)
  })

  test("empty payload returns false", () => {
    expect(validateFdPayload("", 0)).toBe(false)
  })

  test("invalid JSON returns false", () => {
    expect(validateFdPayload("not json", 0)).toBe(false)
  })

  test("non-object JSON returns false", () => {
    expect(validateFdPayload('"string"', 0)).toBe(false)
    expect(validateFdPayload("42", 0)).toBe(false)
  })

  test("missing required fields returns false", () => {
    expect(validateFdPayload('{"foo":"bar"}', 0)).toBe(false)
  })
})

// ── Linux Transport ─────────────────────────────────────────────────────────

describe("isLinuxTransportAvailable", () => {
  test("returns boolean based on platform", () => {
    const result = isLinuxTransportAvailable()
    expect(typeof result).toBe("boolean")
  })
})

describe("createLinuxTransportCapability", () => {
  test("creates capability with expected defaults", () => {
    const cap = createLinuxTransportCapability()
    expect(cap.backendKind).toBe("linux_unix_socket_shared_memory")
    expect(cap.supported).toBe(true)
    expect(cap.protocolVersion).toBe(1)
    expect(cap.maximumSegmentBytes).toBe(256 * 1024 * 1024)
    expect(cap.maximumConcurrentSegments).toBe(4)
    expect(cap.supportedTransferRepresentations).toContain("flat_buffer")
    expect(cap.supportedTransferRepresentations).toContain("tensor_page_array")
    expect(cap.supportsReadOnlyDestinationMapping).toBe(true)
    expect(cap.supportsFdPassing).toBe(true)
    expect(cap.supportsIntegrityTrailer).toBe(true)
    expect(cap.supportsCancellation).toBe(true)
    expect(cap.supportsOrphanRecovery).toBe(true)
    expect(cap.platformCapabilityDigest).toBeTruthy()
  })
})

describe("getLinuxTransportStatus", () => {
  test("returns object with available and reason", () => {
    const status = getLinuxTransportStatus()
    expect(typeof status.available).toBe("boolean")
    // reason is null if available, string if not
    if (status.available) {
      expect(status.reason).toBeNull()
    } else {
      expect(typeof status.reason).toBe("string")
    }
  })
})
