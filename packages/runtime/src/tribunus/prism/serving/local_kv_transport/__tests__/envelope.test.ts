/**
 * Prism Local-Host KV Transport — Envelope & Trailer Tests
 */

import { expect, test, describe } from "bun:test"
import type { PrismKvTransferEnvelope, PrismKvTransferTrailer } from "../local-transport-types"
import {
  createTransferEnvelope,
  validateEnvelope,
  computeEnvelopeDigest,
} from "../kv-transfer-envelope"
import {
  createTransferTrailer,
  validateTrailer,
  buildTrailerFromEnvelope,
} from "../kv-transfer-trailer"

// ── Fixtures ────────────────────────────────────────────────────────────────

const HANDOFF_ID = "handoff_test_001"
const NS_ID = "ns_kv_main"
const MODEL_DIGEST = "sha256:abc123def456"
const TOKENIZER_DIGEST = "sha256:token123"
const COMPAT_DIGEST = "sha256:compat789"
const REP = "flat_buffer"
const SEQ_LEN = 4096
const LAYERS = 32
const PAGES = 8
const BYTES = 4096 * 32 * 8 * 4 // ~4MB
const ALIGN = 64
const CHECKSUM = "a1b2c3d4e5f6"

function makeEnvelope(overrides: Partial<PrismKvTransferEnvelope> = {}): PrismKvTransferEnvelope {
  return createTransferEnvelope(
    overrides.handoffId ?? HANDOFF_ID,
    overrides.sourceKvNamespaceId ?? NS_ID,
    overrides.modelArtifactDigest ?? MODEL_DIGEST,
    overrides.tokenizerDigest ?? TOKENIZER_DIGEST,
    overrides.compatibilityDescriptorDigest ?? COMPAT_DIGEST,
    overrides.transferRepresentation ?? REP,
    overrides.sequenceLength ?? SEQ_LEN,
    overrides.layerCount ?? LAYERS,
    overrides.pageCount ?? PAGES,
    overrides.payloadByteLength ?? BYTES,
    overrides.payloadAlignment ?? ALIGN,
    overrides.payloadChecksum ?? CHECKSUM,
  )
}

function makeTrailer(overrides: Partial<PrismKvTransferTrailer> = {}): PrismKvTransferTrailer {
  return createTransferTrailer(
    overrides.envelopeDigest ?? "env_digest_001",
    overrides.payloadChecksum ?? CHECKSUM,
    overrides.payloadByteLength ?? BYTES,
  )
}

// ── Envelope Creation ───────────────────────────────────────────────────────

describe("createTransferEnvelope", () => {
  test("creates envelope with all expected fields", () => {
    const env = makeEnvelope()
    expect(env.envelopeVersion).toBe(1)
    expect(env.handoffId).toBe(HANDOFF_ID)
    expect(env.sourceKvNamespaceId).toBe(NS_ID)
    expect(env.modelArtifactDigest).toBe(MODEL_DIGEST)
    expect(env.tokenizerDigest).toBe(TOKENIZER_DIGEST)
    expect(env.compatibilityDescriptorDigest).toBe(COMPAT_DIGEST)
    expect(env.transferRepresentation).toBe(REP)
    expect(env.sequenceLength).toBe(SEQ_LEN)
    expect(env.layerCount).toBe(LAYERS)
    expect(env.pageCount).toBe(PAGES)
    expect(env.payloadByteLength).toBe(BYTES)
    expect(env.payloadAlignment).toBe(ALIGN)
    expect(env.payloadChecksum).toBe(CHECKSUM)
    expect(env.createdAt).toBeTruthy()
    expect(new Date(env.createdAt).getTime()).not.toBeNaN()
  })

  test("different handoffId produces different envelope", () => {
    const a = makeEnvelope({ handoffId: "handoff_a" })
    const b = makeEnvelope({ handoffId: "handoff_b" })
    expect(a.handoffId).not.toBe(b.handoffId)
  })
})

// ── Envelope Validation ─────────────────────────────────────────────────────

describe("validateEnvelope", () => {
  test("valid envelope passes validation", () => {
    const env = makeEnvelope()
    const result = validateEnvelope(env, HANDOFF_ID)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("rejects null/undefined envelope", () => {
    // @ts-expect-error — testing invalid input
    expect(validateEnvelope(null, HANDOFF_ID).valid).toBe(false)
    // @ts-expect-error — testing invalid input
    expect(validateEnvelope(undefined, HANDOFF_ID).valid).toBe(false)
  })

  test("rejects mismatched handoffId", () => {
    const env = makeEnvelope()
    const result = validateEnvelope(env, "wrong_handoff")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("handoffId mismatch")
  })

  test("rejects empty handoffId", () => {
    const env = makeEnvelope({ handoffId: "" })
    const result = validateEnvelope(env, HANDOFF_ID)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("handoffId")
  })

  test("rejects empty sourceKvNamespaceId", () => {
    const env = makeEnvelope({ sourceKvNamespaceId: "" })
    const result = validateEnvelope(env, HANDOFF_ID)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("sourceKvNamespaceId")
  })

  test("rejects zero/negative sequenceLength", () => {
    const r1 = validateEnvelope(makeEnvelope({ sequenceLength: 0 }), HANDOFF_ID)
    expect(r1.valid).toBe(false)
    const r2 = validateEnvelope(makeEnvelope({ sequenceLength: -1 }), HANDOFF_ID)
    expect(r2.valid).toBe(false)
  })

  test("rejects zero/negative layerCount", () => {
    const r1 = validateEnvelope(makeEnvelope({ layerCount: 0 }), HANDOFF_ID)
    expect(r1.valid).toBe(false)
    const r2 = validateEnvelope(makeEnvelope({ layerCount: -5 }), HANDOFF_ID)
    expect(r2.valid).toBe(false)
  })

  test("rejects zero/negative pageCount", () => {
    const r1 = validateEnvelope(makeEnvelope({ pageCount: 0 }), HANDOFF_ID)
    expect(r1.valid).toBe(false)
  })

  test("rejects zero/negative payloadByteLength", () => {
    const r1 = validateEnvelope(makeEnvelope({ payloadByteLength: 0 }), HANDOFF_ID)
    expect(r1.valid).toBe(false)
  })

  test("rejects zero/negative payloadAlignment", () => {
    const r1 = validateEnvelope(makeEnvelope({ payloadAlignment: 0 }), HANDOFF_ID)
    expect(r1.valid).toBe(false)
  })

  test("rejects empty payloadChecksum", () => {
    const env = makeEnvelope({ payloadChecksum: "" })
    const result = validateEnvelope(env, HANDOFF_ID)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("payloadChecksum")
  })

  test("rejects empty createdAt", () => {
    // Must construct directly since createTransferEnvelope always sets createdAt
    const env = { ...makeEnvelope(), createdAt: "" }
    const result = validateEnvelope(env, HANDOFF_ID)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("createdAt")
  })
})

// ── Envelope Digest ─────────────────────────────────────────────────────────

describe("computeEnvelopeDigest", () => {
  test("returns a non-empty hex string", () => {
    const env = makeEnvelope()
    const digest = computeEnvelopeDigest(env)
    expect(digest).toBeTruthy()
    expect(digest.length).toBe(64) // SHA-256 hex
    expect(/^[0-9a-f]+$/.test(digest)).toBe(true)
  })

  test("same envelope produces same digest (determinism)", () => {
    const a = computeEnvelopeDigest(makeEnvelope())
    const b = computeEnvelopeDigest(makeEnvelope())
    expect(a).toBe(b)
  })

  test("different handoffId produces different digest", () => {
    const a = computeEnvelopeDigest(makeEnvelope({ handoffId: "handoff_x" }))
    const b = computeEnvelopeDigest(makeEnvelope({ handoffId: "handoff_y" }))
    expect(a).not.toBe(b)
  })

  test("different payloadChecksum produces different digest", () => {
    const a = computeEnvelopeDigest(makeEnvelope({ payloadChecksum: "aaa" }))
    const b = computeEnvelopeDigest(makeEnvelope({ payloadChecksum: "bbb" }))
    expect(a).not.toBe(b)
  })
})

// ── Trailer Creation ────────────────────────────────────────────────────────

describe("createTransferTrailer", () => {
  test("creates trailer with expected fields", () => {
    const digest = "env_digest_001"
    const trailer = createTransferTrailer(digest, CHECKSUM, BYTES)
    expect(trailer.envelopeDigest).toBe(digest)
    expect(trailer.payloadChecksum).toBe(CHECKSUM)
    expect(trailer.payloadByteLength).toBe(BYTES)
    expect(trailer.serializationGeneration).toBe(1)
    expect(trailer.completedAt).toBeTruthy()
    expect(new Date(trailer.completedAt).getTime()).not.toBeNaN()
  })
})

// ── buildTrailerFromEnvelope ────────────────────────────────────────────────

describe("buildTrailerFromEnvelope", () => {
  test("builds a valid trailer from an envelope", () => {
    const env = makeEnvelope()
    const trailer = buildTrailerFromEnvelope(env)
    expect(trailer.envelopeDigest).toBe(computeEnvelopeDigest(env))
    expect(trailer.payloadChecksum).toBe(CHECKSUM)
    expect(trailer.payloadByteLength).toBe(BYTES)
  })
})

// ── Trailer Validation ──────────────────────────────────────────────────────

describe("validateTrailer", () => {
  test("valid trailer passes validation", () => {
    const digest = "env_digest_001"
    const trailer = makeTrailer({ envelopeDigest: digest })
    const result = validateTrailer(trailer, digest, CHECKSUM, BYTES)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("rejects null/undefined trailer", () => {
    // @ts-expect-error — testing invalid input
    expect(validateTrailer(null, "dig", "sum", 100).valid).toBe(false)
    // @ts-expect-error — testing invalid input
    expect(validateTrailer(undefined, "dig", "sum", 100).valid).toBe(false)
  })

  test("rejects mismatched envelopeDigest", () => {
    const trailer = makeTrailer({ envelopeDigest: "digest_a" })
    const result = validateTrailer(trailer, "digest_b", CHECKSUM, BYTES)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("envelopeDigest mismatch")
  })

  test("rejects empty envelopeDigest", () => {
    const trailer = makeTrailer({ envelopeDigest: "" })
    const result = validateTrailer(trailer, "dig", CHECKSUM, BYTES)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("envelopeDigest")
  })

  test("rejects mismatched payloadChecksum", () => {
    const trailer = makeTrailer({ payloadChecksum: "wrong_sum" })
    const result = validateTrailer(trailer, "env_digest_001", CHECKSUM, BYTES)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("payloadChecksum mismatch")
  })

  test("rejects empty payloadChecksum", () => {
    const trailer = makeTrailer({ payloadChecksum: "" })
    const result = validateTrailer(trailer, "env_digest_001", CHECKSUM, BYTES)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("payloadChecksum")
  })

  test("rejects mismatched payloadByteLength", () => {
    const trailer = makeTrailer({ payloadByteLength: 999 })
    const result = validateTrailer(trailer, "env_digest_001", CHECKSUM, BYTES)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("payloadByteLength mismatch")
  })
})
