/**
 * Prism KV Handoff Protocol — Compatibility Validator Tests
 *
 * Covers strict match, individual field mismatches, family mode, evaluation
 * mode, and the shorthand helper functions.
 */

import { expect, test, describe } from "bun:test"
import {
  validateCompatibility,
  isStrictlyCompatible,
  getMismatchedFields,
} from "../compatibility-validator"
import { createCompatibilityDescriptor } from "../compatibility-descriptor"
import type { PrismKvCompatibilityDescriptor } from "../handoff-types"

function baseDesc(overrides: Partial<PrismKvCompatibilityDescriptor> = {}): PrismKvCompatibilityDescriptor {
  return {
    ...createCompatibilityDescriptor(
    "model-a", "token-a", "arch-a", "attn-a", "rope-a",
    "kvquant-a", "fp16", "page-64", "head-gqa", 32, 4096, 8192,
    "ampere", "ampere", "native",
    ),
    ...overrides,
  }
}

describe("validateCompatibility — strict mode", () => {
  test("identical descriptors are compatible", () => {
    const a = baseDesc()
    const r = validateCompatibility(a, a, "strict")
    expect(r.compatible).toBe(true)
    expect(r.mismatchedFields).toBeEmpty()
    expect(r.reason).toBeNull()
  })

  test("different modelArtifactDigest fails", () => {
    const a = baseDesc()
    const b = baseDesc({ modelArtifactDigest: "model-b" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("modelArtifactDigest")
    expect(r.reason).toContain("strict")
  })

  test("different tokenizerDigest fails", () => {
    const a = baseDesc()
    const b = baseDesc({ tokenizerDigest: "token-b" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("tokenizerDigest")
  })

  test("different architectureDigest fails", () => {
    const a = baseDesc()
    const b = baseDesc({ architectureDigest: "arch-b" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("architectureDigest")
  })

  test("different attentionLayoutDigest fails", () => {
    const a = baseDesc()
    const b = baseDesc({ attentionLayoutDigest: "attn-b" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("attentionLayoutDigest")
  })

  test("different ropeConfigurationDigest fails", () => {
    const a = baseDesc()
    const b = baseDesc({ ropeConfigurationDigest: "rope-b" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("ropeConfigurationDigest")
  })

  test("different kvQuantizationDigest fails", () => {
    const a = baseDesc()
    const b = baseDesc({ kvQuantizationDigest: "kvquant-b" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("kvQuantizationDigest")
  })

  test("different kvPrecisionMode fails", () => {
    const a = baseDesc()
    const b = baseDesc({ kvPrecisionMode: "fp32" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("kvPrecisionMode")
  })

  test("different kvPageShape fails", () => {
    const a = baseDesc()
    const b = baseDesc({ kvPageShape: "page-128" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("kvPageShape")
  })

  test("different kvHeadLayout fails", () => {
    const a = baseDesc()
    const b = baseDesc({ kvHeadLayout: "head-mqa" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("kvHeadLayout")
  })

  test("different kvLayerCount fails", () => {
    const a = baseDesc()
    const b = baseDesc({ kvLayerCount: 64 })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("kvLayerCount")
  })

  test("different kvHiddenDimension fails", () => {
    const a = baseDesc()
    const b = baseDesc({ kvHiddenDimension: 2048 })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("kvHiddenDimension")
  })

  test("different kvSequenceLength fails", () => {
    const a = baseDesc()
    const b = baseDesc({ kvSequenceLength: 4096 })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("kvSequenceLength")
  })

  test("different transferRepresentation fails", () => {
    const a = baseDesc()
    const b = baseDesc({ transferRepresentation: "quantized" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("transferRepresentation")
  })

  test("different sourceComputeImageClass fails", () => {
    const a = baseDesc()
    const b = baseDesc({ sourceComputeImageClass: "hopper" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("sourceComputeImageClass")
  })

  test("different destinationComputeImageClass fails", () => {
    const a = baseDesc()
    const b = baseDesc({ destinationComputeImageClass: "hopper" })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("destinationComputeImageClass")
  })

  test("multiple mismatches are all reported", () => {
    const a = baseDesc()
    const b = baseDesc({ modelArtifactDigest: "model-b", tokenizerDigest: "token-b", kvLayerCount: 64 })
    const r = validateCompatibility(a, b, "strict")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("modelArtifactDigest")
    expect(r.mismatchedFields).toContain("tokenizerDigest")
    expect(r.mismatchedFields).toContain("kvLayerCount")
    expect(r.mismatchedFields.length).toBeGreaterThanOrEqual(3)
  })
})

describe("validateCompatibility — family mode", () => {
  test("same image class difference in family mode still fails", () => {
    // family mode excludes sourceComputeImageClass, destinationComputeImageClass, transferRepresentation
    const a = baseDesc()
    const b = baseDesc({ modelArtifactDigest: "model-b" })
    const r = validateCompatibility(a, b, "family")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("modelArtifactDigest")
  })

  test("different image class allowed in family mode", () => {
    const a = baseDesc()
    const b = baseDesc({ sourceComputeImageClass: "hopper", destinationComputeImageClass: "hopper" })
    const r = validateCompatibility(a, b, "family")
    expect(r.compatible).toBe(true)
    expect(r.mismatchedFields).toBeEmpty()
  })

  test("different transferRepresentation allowed in family mode", () => {
    const a = baseDesc()
    const b = baseDesc({ transferRepresentation: "quantized" })
    const r = validateCompatibility(a, b, "family")
    expect(r.compatible).toBe(true)
  })
})

describe("validateCompatibility — evaluation mode", () => {
  test("same model + tokenizer passes", () => {
    const a = baseDesc()
    const b = baseDesc({ architectureDigest: "arch-b", kvLayerCount: 64 })
    const r = validateCompatibility(a, b, "evaluation")
    expect(r.compatible).toBe(true)
  })

  test("different modelDigest fails", () => {
    const a = baseDesc()
    const b = baseDesc({ modelArtifactDigest: "model-b" })
    const r = validateCompatibility(a, b, "evaluation")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("modelArtifactDigest")
  })

  test("different tokenizerDigest fails", () => {
    const a = baseDesc()
    const b = baseDesc({ tokenizerDigest: "token-b" })
    const r = validateCompatibility(a, b, "evaluation")
    expect(r.compatible).toBe(false)
    expect(r.mismatchedFields).toContain("tokenizerDigest")
  })
})

describe("isStrictlyCompatible", () => {
  test("identical descriptors return true", () => {
    const a = baseDesc()
    expect(isStrictlyCompatible(a, a)).toBe(true)
  })

  test("different kvPageShape returns false", () => {
    const a = baseDesc()
    const b = baseDesc({ kvPageShape: "page-128" })
    expect(isStrictlyCompatible(a, b)).toBe(false)
  })
})

describe("getMismatchedFields", () => {
  test("identical descriptors return empty array", () => {
    const a = baseDesc()
    expect(getMismatchedFields(a, a)).toBeEmpty()
  })

  test("single mismatch", () => {
    const a = baseDesc()
    const b = baseDesc({ kvPrecisionMode: "int8" })
    expect(getMismatchedFields(a, b)).toEqual(["kvPrecisionMode"])
  })
})
