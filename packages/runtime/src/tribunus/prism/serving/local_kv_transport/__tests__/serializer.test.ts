/**
 * Prism Local-Host KV Transport — Serializer Tests
 */

import { expect, test, describe } from "bun:test"
import {
  canSerialize,
  estimateSerializedBytes,
  computeChecksum,
  buildEnvelope,
  buildTrailer,
} from "../kv-serializer"
import { computeEnvelopeDigest } from "../kv-transfer-envelope"

// ── canSerialize ────────────────────────────────────────────────────────────

describe("canSerialize", () => {
  const supported = ["flat_buffer", "tensor_page_array", "compressed_tensor"]

  test("returns true for supported representation", () => {
    expect(canSerialize("flat_buffer", supported)).toBe(true)
    expect(canSerialize("tensor_page_array", supported)).toBe(true)
  })

  test("returns false for unsupported representation", () => {
    expect(canSerialize("binary_blob", supported)).toBe(false)
    expect(canSerialize("", supported)).toBe(false)
  })

  test("returns false for empty representation", () => {
    expect(canSerialize("", ["flat_buffer"])).toBe(false)
  })
})

// ── estimateSerializedBytes ─────────────────────────────────────────────────

describe("estimateSerializedBytes", () => {
  test("computes product of dimensions", () => {
    const result = estimateSerializedBytes(4096, 32, 8, 4)
    expect(result).toBe(4096 * 32 * 8 * 4)
  })

  test("returns 0 for zero or negative dimensions", () => {
    expect(estimateSerializedBytes(0, 1, 1, 1)).toBe(0)
    expect(estimateSerializedBytes(1, -1, 1, 1)).toBe(0)
    expect(estimateSerializedBytes(1, 0, 0, 1)).toBe(0)
  })

  test("returns 0 for all zeros", () => {
    expect(estimateSerializedBytes(0, 0, 0, 0)).toBe(0)
  })
})

// ── computeChecksum ─────────────────────────────────────────────────────────

describe("computeChecksum", () => {
  test("returns deterministic hex string", () => {
    const a = computeChecksum("hello")
    const b = computeChecksum("hello")
    expect(a).toBe(b)
    expect(a.length).toBe(64)
    expect(/^[0-9a-f]+$/.test(a)).toBe(true)
  })

  test("different inputs produce different checksums", () => {
    const a = computeChecksum("hello")
    const b = computeChecksum("world")
    expect(a).not.toBe(b)
  })

  test("empty string produces deterministic checksum", () => {
    const result = computeChecksum("")
    expect(result.length).toBe(64)
  })
})

// ── buildEnvelope ───────────────────────────────────────────────────────────

describe("buildEnvelope", () => {
  test("builds a complete envelope with default values", () => {
    const env = buildEnvelope(
      "handoff_001",
      "ns_main",
      "sha256:model_digest",
      "sha256:compat_digest",
      4096,
      32,
      8,
      4194304,
    )
    expect(env.handoffId).toBe("handoff_001")
    expect(env.sourceKvNamespaceId).toBe("ns_main")
    expect(env.modelArtifactDigest).toBe("sha256:model_digest")
    expect(env.compatibilityDescriptorDigest).toBe("sha256:compat_digest")
    expect(env.sequenceLength).toBe(4096)
    expect(env.layerCount).toBe(32)
    expect(env.pageCount).toBe(8)
    expect(env.payloadByteLength).toBe(4194304)
    expect(env.tokenizerDigest).toBe("")
    expect(env.transferRepresentation).toBe("flat_buffer")
    expect(env.payloadAlignment).toBe(64)
    expect(env.envelopeVersion).toBe(1)
    expect(env.payloadChecksum).toBeTruthy()
    expect(env.createdAt).toBeTruthy()
  })

  test("same inputs produce identical checksum", () => {
    const a = buildEnvelope("hid", "ns", "md", "cd", 1, 1, 1, 100)
    const b = buildEnvelope("hid", "ns", "md", "cd", 1, 1, 1, 100)
    expect(a.payloadChecksum).toBe(b.payloadChecksum)
  })

  test("different inputs produce different checksum", () => {
    const a = buildEnvelope("hid_a", "ns", "md", "cd", 1, 1, 1, 100)
    const b = buildEnvelope("hid_b", "ns", "md", "cd", 1, 1, 1, 100)
    expect(a.payloadChecksum).not.toBe(b.payloadChecksum)
  })
})

// ── buildTrailer ────────────────────────────────────────────────────────────

describe("buildTrailer", () => {
  test("builds a trailer matching the envelope", () => {
    const env = buildEnvelope("hid", "ns", "md", "cd", 1, 1, 1, 100)
    const trailer = buildTrailer(env)
    expect(trailer.envelopeDigest).toBe(computeEnvelopeDigest(env))
    expect(trailer.payloadChecksum).toBe(env.payloadChecksum)
    expect(trailer.payloadByteLength).toBe(env.payloadByteLength)
  })

  test("different envelopes produce different trailers", () => {
    const envA = buildEnvelope("hid_a", "ns", "md", "cd", 1, 1, 1, 100)
    const envB = buildEnvelope("hid_b", "ns", "md", "cd", 1, 1, 1, 100)
    const ta = buildTrailer(envA)
    const tb = buildTrailer(envB)
    expect(ta.envelopeDigest).not.toBe(tb.envelopeDigest)
  })
})
