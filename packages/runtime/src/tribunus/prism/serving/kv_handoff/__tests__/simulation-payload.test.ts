/**
 * Prism KV Handoff Protocol — Simulation Payload Tests
 *
 * Covers creation, digest computation, integrity verification, and version
 * support.
 */

import { expect, test, describe } from "bun:test"
import {
  createSimulationPayload,
  computePayloadDigest,
  verifyPayloadIntegrity,
  isPayloadVersionSupported,
} from "../simulation-payload"

describe("createSimulationPayload", () => {
  test("creates payload with expected deterministic fields", () => {
    const p = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    expect(p.payloadId).toBe("payload-ho-001")
    expect(p.handoffId).toBe("ho-001")
    expect(p.sourceKvNamespaceId).toBe("ns-001")
    expect(p.fixtureSeed).toBe("seed-abc")
    expect(p.sequenceLength).toBe(8192)
    expect(p.layerCount).toBe(32)
    expect(p.pageCount).toBe(128)
    expect(p.payloadVersion).toBe(1)
    // byteLength = seqLen * (layers * 2 * 2) * pages = 8192 * 128 * 128 = 134217728
    expect(p.byteLength).toBe(8192 * 128 * 128)
  })

  test("different handoffId produces different contentDigest", () => {
    const a = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    const b = createSimulationPayload("ho-002", "ns-001", "seed-abc", 8192, 32, 128)
    expect(a.deterministicContentDigest).not.toBe(b.deterministicContentDigest)
  })

  test("different seed produces different contentDigest", () => {
    const a = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    const b = createSimulationPayload("ho-001", "ns-001", "seed-xyz", 8192, 32, 128)
    expect(a.deterministicContentDigest).not.toBe(b.deterministicContentDigest)
  })

  test("same inputs produce identical payload (determinism)", () => {
    const a = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    const b = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    expect(a.deterministicContentDigest).toBe(b.deterministicContentDigest)
    expect(a.byteLength).toBe(b.byteLength)
  })
})

describe("computePayloadDigest", () => {
  test("returns a non-empty hex string", () => {
    const p = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    const digest = computePayloadDigest(p)
    expect(digest).toBeString()
    expect(digest.length).toBe(64) // SHA-256 hex
  })

  test("different seeds produce different digests", () => {
    const a = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    const b = createSimulationPayload("ho-001", "ns-001", "seed-xyz", 8192, 32, 128)
    expect(computePayloadDigest(a)).not.toBe(computePayloadDigest(b))
  })

  test("same inputs produce same digest (determinism)", () => {
    const a = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    const b = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    expect(computePayloadDigest(a)).toBe(computePayloadDigest(b))
  })
})

describe("verifyPayloadIntegrity", () => {
  test("correct digest passes verification", () => {
    const p = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    const digest = computePayloadDigest(p)
    expect(verifyPayloadIntegrity(p, digest)).toBe(true)
  })

  test("wrong digest fails verification", () => {
    const p = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    expect(verifyPayloadIntegrity(p, "deadbeef" + "0".repeat(56))).toBe(false)
  })

  test("tampered seed fails integrity check", () => {
    const p = createSimulationPayload("ho-001", "ns-001", "seed-abc", 8192, 32, 128)
    const digest = computePayloadDigest(p)
    const tampered = { ...p, fixtureSeed: "tampered-seed" }
    expect(verifyPayloadIntegrity(tampered, digest)).toBe(false)
  })
})

describe("isPayloadVersionSupported", () => {
  test("version 1 is supported", () => {
    expect(isPayloadVersionSupported(1)).toBe(true)
  })

  test("version 0 is not supported", () => {
    expect(isPayloadVersionSupported(0)).toBe(false)
  })

  test("negative version is not supported", () => {
    expect(isPayloadVersionSupported(-1)).toBe(false)
  })

  test("version 2 is not supported yet", () => {
    expect(isPayloadVersionSupported(2)).toBe(false)
  })
})
