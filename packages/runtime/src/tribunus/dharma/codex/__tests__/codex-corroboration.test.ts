/**
 * Codex — Corroboration + Growth Policy Tests
 */

import { expect, test, describe } from "bun:test"
import { corroborateEntry, type CorroborationChange } from "../codex-corroboration"
import { createDefaultGrowthPolicy, createRestrictiveGrowthPolicy, checkCreationCap, canCreateEntry, countEntriesInWindow } from "../codex-growth-policy"
import type { CodexEntry, CodexClaim, EvidenceRef, KnowledgeClass } from "../codex-types"

function makeEntry(overrides?: Partial<CodexEntry>): CodexEntry {
  return {
    codexEntryId: "entry-1",
    schemaVersion: 1,
    status: "published",
    visibilityClass: "contributor",
    knowledgeClass: "performance_evidence",
    title: "Test entry",
    abstract: "test",
    claims: [{ claimId: "c1", statement: "test", claimType: "fact", supportRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, confidence: 0.7 }],
    canonicalContentDigest: "abc",
    sourceContributionIds: ["contrib-1"],
    sourceArtifactRefs: [],
    evidenceRefs: [{ receiptDigest: "r1", contributionId: "c1", artifactDigest: "a1", description: "test" }],
    provenance: { createdFromReceiptIds: ["r1"], derivationPolicyVersion: "1", ingestionMode: "automatic", authoredBy: ["u1"], approvedBy: [], createdAtLogicalTime: "1000" },
    quality: { evidenceQuality: "medium", corroborationCount: 1, reproducibilityStatus: "unverified", confidence: 0.7 },
    semanticIndex: { embeddingModelDigest: "", embeddingVectorRef: "", lexicalTerms: [], entityRefs: [] },
    lineage: { supersedes: null, supersededBy: null, relatedEntryIds: [] },
    policy: { queryEligibility: "authenticated", derivativeUsePolicy: "permitted", benefitPolicyId: "" },
    signatures: [],
    ...overrides,
  }
}

describe("corroborateEntry", () => {
  test("increments corroboration count", () => {
    const entry = makeEntry()
    const result = corroborateEntry(entry, [], [])
    expect(result.entry.quality.corroborationCount).toBe(2)
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: "corroboration_count", from: 1, to: 2 }))
  })

  test("adds new evidence refs", () => {
    const entry = makeEntry()
    const newRefs: EvidenceRef[] = [{ receiptDigest: "r2", contributionId: "c2", artifactDigest: "a2", description: "new evidence" }]
    const result = corroborateEntry(entry, newRefs, [])
    expect(result.entry.evidenceRefs).toHaveLength(2)
    expect(result.entry.evidenceRefs[1].receiptDigest).toBe("r2")
  })

  test("deduplicates evidence refs", () => {
    const entry = makeEntry()
    const dupRefs: EvidenceRef[] = [{ receiptDigest: "r1", contributionId: "c1", artifactDigest: "a1", description: "duplicate" }]
    const result = corroborateEntry(entry, dupRefs, [])
    expect(result.entry.evidenceRefs).toHaveLength(1) // unchanged
  })

  test("promotes reproducibility to reproduced at count 2", () => {
    const entry = makeEntry({ quality: { ...makeEntry().quality, corroborationCount: 1, reproducibilityStatus: "unverified" } })
    const result = corroborateEntry(entry, [], [])
    expect(result.entry.quality.reproducibilityStatus).toBe("reproduced")
  })

  test("promotes reproducibility to independently_reproduced at count 5", () => {
    const entry = makeEntry({ quality: { ...makeEntry().quality, corroborationCount: 4, reproducibilityStatus: "reproduced" } })
    const result = corroborateEntry(entry, [], [])
    expect(result.entry.quality.reproducibilityStatus).toBe("independently_reproduced")
  })

  test("never promotes from contradicted", () => {
    const entry = makeEntry({ quality: { ...makeEntry().quality, corroborationCount: 1, reproducibilityStatus: "contradicted" } })
    const result = corroborateEntry(entry, [], [])
    expect(result.entry.quality.reproducibilityStatus).toBe("contradicted")
  })

  test("promotes evidence quality from low to medium at count 2", () => {
    const entry = makeEntry({ quality: { ...makeEntry().quality, corroborationCount: 1, evidenceQuality: "low" } })
    const result = corroborateEntry(entry, [], [])
    expect(result.entry.quality.evidenceQuality).toBe("medium")
  })

  test("promotes evidence quality to high at count 3", () => {
    const entry = makeEntry({ quality: { ...makeEntry().quality, corroborationCount: 2, evidenceQuality: "medium" } })
    const result = corroborateEntry(entry, [], [])
    expect(result.entry.quality.evidenceQuality).toBe("high")
  })

  test("returns updated=true when changes are made", () => {
    const entry = makeEntry()
    const result = corroborateEntry(entry, [], [])
    expect(result.updated).toBe(true)
  })

  test("recalculates confidence", () => {
    const entry = makeEntry({ quality: { ...makeEntry().quality, confidence: 0.5, corroborationCount: 1 } })
    const newClaims: CodexClaim[] = [{ claimId: "c2", statement: "corroboration", claimType: "fact", supportRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, confidence: 1.0 }]
    const result = corroborateEntry(entry, [], newClaims)
    // (0.5 * 1 + 1.0 * 1) / 2 = 0.75
    expect(result.entry.quality.confidence).toBeCloseTo(0.75, 2)
  })
})

describe("checkCreationCap", () => {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  test("allows creation when under cap", () => {
    const policy = createDefaultGrowthPolicy()
    const entries = [{ knowledgeClass: "performance_evidence" as KnowledgeClass, createdAt: new Date(now - day).toISOString() }]
    const result = checkCreationCap(policy, "performance_evidence", entries, now)
    expect(result.allowed).toBe(true)
  })

  test("blocks creation when cap reached", () => {
    const policy = createRestrictiveGrowthPolicy() // max 20 per 7 days
    const entries = Array.from({ length: 20 }, (_, i) => ({
      knowledgeClass: "debugging_finding" as KnowledgeClass,
      createdAt: new Date(now - i * 1000).toISOString(),  // all within the same second, so all in window
    }))
    const result = checkCreationCap(policy, "debugging_finding", entries, now)
    expect(result.allowed).toBe(false)
  })

  test("does not count entries outside window", () => {
    const policy = createRestrictiveGrowthPolicy() // 7 day window
    const entries = [
      { knowledgeClass: "debugging_finding" as KnowledgeClass, createdAt: new Date(now - 14 * day).toISOString() },
    ]
    const result = checkCreationCap(policy, "debugging_finding", entries, now)
    expect(result.allowed).toBe(true)
  })

  test("canCreateEntry returns correct boolean", () => {
    const policy = createDefaultGrowthPolicy()
    expect(canCreateEntry(policy, "performance_evidence", [], now)).toBe(true)
  })
})

describe("countEntriesInWindow", () => {
  test("counts only matching knowledge class", () => {
    const entries = [
      { knowledgeClass: "performance_evidence" as KnowledgeClass, createdAt: new Date().toISOString() },
      { knowledgeClass: "debugging_finding" as KnowledgeClass, createdAt: new Date().toISOString() },
    ]
    expect(countEntriesInWindow(entries, "performance_evidence", 3600000, Date.now())).toBe(1)
  })
})
