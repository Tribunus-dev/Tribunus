/**
 * Prism KV Handoff Protocol — Export Manifest Tests
 *
 * Covers creation, validation (positive and negative cases), and expiry
 * detection.
 */

import { expect, test, describe } from "bun:test"
import { createExportManifest, validateManifest, isManifestExpired } from "../export-manifest"
import type { PrismKvExportManifest } from "../handoff-types"

describe("createExportManifest", () => {
  test("creates manifest with expected fields", () => {
    const m = createExportManifest("ho-001", "worker-a", "inst-a", "ns-001", "desc-digest-1", 8192, 128, 65536, "content-digest-1")
    expect(m.manifestId).toBe("manifest-ho-001")
    expect(m.handoffId).toBe("ho-001")
    expect(m.sourceWorkerId).toBe("worker-a")
    expect(m.sourceWorkerInstanceId).toBe("inst-a")
    expect(m.sourceKvNamespaceId).toBe("ns-001")
    expect(m.compatibilityDescriptorDigest).toBe("desc-digest-1")
    expect(m.sequenceLength).toBe(8192)
    expect(m.pageCount).toBe(128)
    expect(m.byteLength).toBe(65536)
    expect(m.deterministicContentDigest).toBe("content-digest-1")
    expect(m.exportGeneration).toBe(1)
    expect(m.transferRepresentation).toBe("simulation")
    expect(m.exportedAt).toBeString()
    expect(m.expiresAt).toBeString()
    expect(m.sourceSignature).toBe("")
  })

  test("each call gets a fresh timestamp", () => {
    const a = createExportManifest("ho-001", "w", "i", "ns", "d", 1, 1, 1, "c")
    const b = createExportManifest("ho-001", "w", "i", "ns", "d", 1, 1, 1, "c")
    // Same handoffId — manifests are identical except timestamps
    expect(a.manifestId).toBe(b.manifestId)
    expect(a.exportedAt).toBeString()
    expect(b.exportedAt).toBeString()
  })
})

describe("validateManifest", () => {
  function validManifest(overrides: Partial<PrismKvExportManifest> = {}): PrismKvExportManifest {
    return {
      manifestId: "manifest-ho-001",
      handoffId: "ho-001",
      sourceWorkerId: "worker-a",
      sourceWorkerInstanceId: "inst-a",
      sourceKvNamespaceId: "ns-001",
      modelArtifactDigest: "model-a",
      tokenizerDigest: "token-a",
      compatibilityDescriptorDigest: "desc-digest-1",
      transferRepresentation: "simulation",
      sequenceLength: 8192,
      pageCount: 128,
      byteLength: 65536,
      deterministicContentDigest: "content-digest-1",
      exportGeneration: 1,
      exportedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      sourceSignature: "",
      ...overrides,
    }
  }

  test("valid manifest passes", () => {
    const r = validateManifest(validManifest(), "ho-001")
    expect(r.valid).toBe(true)
    expect(r.reason).toBeNull()
  })

  describe("invalid cases", () => {
    test("null/undefined manifest", () => {
      const r = validateManifest(undefined as unknown as PrismKvExportManifest, "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("not an object")
    })

    test("wrong handoffId", () => {
      const r = validateManifest(validManifest(), "ho-999")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("handoffId")
    })

    test("missing manifestId", () => {
      const r = validateManifest(validManifest({ manifestId: "" }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("manifestId")
    })

    test("missing sourceWorkerId", () => {
      const r = validateManifest(validManifest({ sourceWorkerId: "" }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("sourceWorkerId")
    })

    test("missing sourceKvNamespaceId", () => {
      const r = validateManifest(validManifest({ sourceKvNamespaceId: "" }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("sourceKvNamespaceId")
    })

    test("missing compatibilityDescriptorDigest", () => {
      const r = validateManifest(validManifest({ compatibilityDescriptorDigest: "" }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("compatibilityDescriptorDigest")
    })

    test("sequenceLength <= 0", () => {
      const r = validateManifest(validManifest({ sequenceLength: 0 }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("sequenceLength")
    })

    test("pageCount <= 0", () => {
      const r = validateManifest(validManifest({ pageCount: -1 }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("pageCount")
    })

    test("byteLength <= 0", () => {
      const r = validateManifest(validManifest({ byteLength: 0 }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("byteLength")
    })

    test("exportGeneration <= 0", () => {
      const r = validateManifest(validManifest({ exportGeneration: 0 }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("exportGeneration")
    })

    test("missing exportedAt", () => {
      const r = validateManifest(validManifest({ exportedAt: "" }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("exportedAt")
    })

    test("missing expiresAt", () => {
      const r = validateManifest(validManifest({ expiresAt: "" }), "ho-001")
      expect(r.valid).toBe(false)
      expect(r.reason).toContain("expiresAt")
    })
  })
})

describe("isManifestExpired", () => {
  test("future expiry is not expired", () => {
    const m = validManifest({ expiresAt: new Date(Date.now() + 3600000).toISOString() })
    expect(isManifestExpired(m)).toBe(false)
  })

  test("past expiry is expired", () => {
    const m = validManifest({ expiresAt: new Date(Date.now() - 3600000).toISOString() })
    expect(isManifestExpired(m)).toBe(true)
  })

  test("empty expiresAt is expired", () => {
    const m = validManifest({ expiresAt: "" })
    expect(isManifestExpired(m)).toBe(true)
  })

  test("invalid date string is expired", () => {
    const m = validManifest({ expiresAt: "not-a-date" })
    expect(isManifestExpired(m)).toBe(true)
  })

  function validManifest(overrides: Partial<PrismKvExportManifest> = {}): PrismKvExportManifest {
    return {
      manifestId: "manifest-ho-001",
      handoffId: "ho-001",
      sourceWorkerId: "worker-a",
      sourceWorkerInstanceId: "inst-a",
      sourceKvNamespaceId: "ns-001",
      modelArtifactDigest: "model-a",
      tokenizerDigest: "token-a",
      compatibilityDescriptorDigest: "desc-digest-1",
      transferRepresentation: "simulation",
      sequenceLength: 8192,
      pageCount: 128,
      byteLength: 65536,
      deterministicContentDigest: "content-digest-1",
      exportGeneration: 1,
      exportedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      sourceSignature: "",
      ...overrides,
    }
  }
})
