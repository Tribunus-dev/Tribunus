/**
 * Phase 5 — Codex Query Surface: Tests
 *
 * Verifies three retrieval modes, filtering, scope matching, lineage
 * warnings, and dispatch routing.
 */

import { describe, test, expect } from "bun:test"
import type {
  CodexEntry,
  CodexClaim,
  EvidenceQuality,
  ReproducibilityStatus,
  IngestionMode,
  CodexVisibilityClass,
} from "../codex-types"
import {
  discoveryQuery,
  evidenceQuery,
  operationalQuery,
  executeQuery,
  scoreRelevance,
  lexicalMatch,
  filterByEvidenceQuality,
  filterByProvenance,
  filterByVisibility,
  meetsOperationalThreshold,
  applyFilters,
  matchScope,
  matchTimeRange,
  sortByRelevance,
  sortByEvidenceQuality,
  formatQueryItem,
  getLineageWarning,
  getEligibilitySummary,
} from "../codex-query"
import type {
  CodexQuery,
  CodexQueryItem,
} from "../codex-query"

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeClaim(
  overrides?: Partial<CodexClaim>,
  scopeOverrides?: { hardwareTargets?: string[]; softwareVersions?: string[]; modelFamilies?: string[] },
): CodexClaim {
  return {
    claimId: "cl_001",
    statement: "Base transformer achieves 95% accuracy on GSM8K",
    claimType: "measurement",
    supportRefs: [],
    scope: {
      hardwareTargets: scopeOverrides?.hardwareTargets ?? ["a100"],
      softwareVersions: scopeOverrides?.softwareVersions ?? ["2.0.0"],
      modelFamilies: scopeOverrides?.modelFamilies ?? ["gpt"],
      contextNotes: [],
    },
    confidence: 0.9,
    ...overrides,
  }
}

function makeEntry(overrides?: Partial<CodexEntry>): CodexEntry {
  return {
    codexEntryId: overrides?.codexEntryId ?? "entry_001",
    schemaVersion: 1,
    status: overrides?.status ?? "published",
    visibilityClass: overrides?.visibilityClass ?? "public",
    knowledgeClass: overrides?.knowledgeClass ?? "performance_evidence",
    title: overrides?.title ?? "Transformer accuracy benchmark",
    abstract: overrides?.abstract ?? "",
    claims: overrides?.claims ?? [makeClaim()],
    canonicalContentDigest: overrides?.canonicalContentDigest ?? "digest_001",
    sourceContributionIds: overrides?.sourceContributionIds ?? ["c_001"],
    sourceArtifactRefs: overrides?.sourceArtifactRefs ?? [],
    evidenceRefs: overrides?.evidenceRefs ?? [
      {
        receiptDigest: "r_001",
        contributionId: "c_001",
        artifactDigest: "abcdef123",
        description: "Evidence from work_product contribution",
      },
    ],
    provenance: overrides?.provenance ?? {
      createdFromReceiptIds: ["r_001"],
      derivationPolicyVersion: "1.0.0",
      ingestionMode: "automatic",
      authoredBy: ["did:dht:alice"],
      approvedBy: [],
      createdAtLogicalTime: "2026-06-30T12:00:00.000Z",
    },
    quality: overrides?.quality ?? {
      evidenceQuality: "high",
      corroborationCount: 3,
      reproducibilityStatus: "reproduced",
      confidence: 0.9,
    },
    semanticIndex: overrides?.semanticIndex ?? {
      embeddingModelDigest: "",
      embeddingVectorRef: "",
      lexicalTerms: [],
      entityRefs: [],
    },
    lineage: overrides?.lineage ?? {
      supersedes: null,
      supersededBy: null,
      relatedEntryIds: [],
    },
    policy: overrides?.policy ?? {
      queryEligibility: "all",
      derivativeUsePolicy: "restricted",
      benefitPolicyId: "",
    },
    signatures: overrides?.signatures ?? [],
  }
}

// ── scoreRelevance ───────────────────────────────────────────────────────────

describe("scoreRelevance", () => {
  test("returns 1.0 when all terms match title", () => {
    const entry = makeEntry({ title: "Transformer accuracy benchmark" })
    const score = scoreRelevance(entry, "transformer accuracy")
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("returns 0 for empty query", () => {
    const entry = makeEntry()
    expect(scoreRelevance(entry, "")).toBe(0)
  })

  test("matches claim statements", () => {
    const entry = makeEntry({
      title: "Untitled",
      abstract: "",
      claims: [makeClaim({ statement: "Latency drops to 5ms under load" })],
    })
    const score = scoreRelevance(entry, "latency 5ms")
    expect(score).toBeGreaterThan(0)
  })

  test("title match scores higher than claim-only match", () => {
    const entry = makeEntry({
      title: "Transformer accuracy benchmark",
      abstract: "",
      claims: [makeClaim({ statement: "Latency drops to 5ms under load" })],
    })
    const titleScore = scoreRelevance(entry, "Transformer accuracy")
    const claimScore = scoreRelevance(entry, "latency 5ms")
    expect(titleScore).toBeGreaterThan(claimScore)
  })
})

// ── lexicalMatch ─────────────────────────────────────────────────────────────

describe("lexicalMatch", () => {
  test("counts matching terms", () => {
    const entry = makeEntry({ title: "GPU kernel optimization for M1" })
    expect(lexicalMatch(entry, ["gpu", "m1", "nonexistent"])).toBe(2)
  })

  test("returns 0 for empty terms", () => {
    const entry = makeEntry()
    expect(lexicalMatch(entry, [])).toBe(0)
  })
})

// ── discoveryQuery ───────────────────────────────────────────────────────────

describe("discoveryQuery", () => {
  test("returns all matching entries sorted by relevance", () => {
    const e1 = makeEntry({
      codexEntryId: "e1",
      title: "GPU kernel optimization",
      claims: [makeClaim({ statement: "Kernel runs at 95% occupancy" }, { hardwareTargets: ["a100"] })],
    })
    const e2 = makeEntry({
      codexEntryId: "e2",
      title: "CPU memory bandwidth",
      claims: [makeClaim({ statement: "Bandwidth reaches 50 GB/s" }, { hardwareTargets: ["amd64"] })],
    })

    const query: CodexQuery = {
      mode: "discovery",
      query: "gpu kernel optimization",
    }

    const result = discoveryQuery([e2, e1], query)
    expect(result.items.length).toBe(2)
    // e1 matches "gpu kernel" better than e2 matches nothing
    expect(result.items[0]!.entry.codexEntryId).toBe("e1")
    expect(result.items[0]!.relevanceScore).toBeGreaterThan(0)
    expect(result.totalCount).toBe(2)
    expect(result.hasMore).toBe(false)
  })

  test("applies filters before scoring", () => {
    const e1 = makeEntry({ codexEntryId: "e1", knowledgeClass: "performance_evidence" })
    const e2 = makeEntry({ codexEntryId: "e2", knowledgeClass: "architecture_decision" })

    const query: CodexQuery = {
      mode: "discovery",
      query: "transformer",
      filters: { knowledgeClasses: ["performance_evidence"] },
    }

    const result = discoveryQuery([e1, e2], query)
    expect(result.items.length).toBe(1)
    expect(result.items[0]!.entry.codexEntryId).toBe("e1")
  })

  test("paginates results", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ codexEntryId: `e${i + 1}`, title: `Entry ${i + 1}` }),
    )
    const query: CodexQuery = { mode: "discovery", query: "entry", limit: 2, offset: 1 }
    const result = discoveryQuery(entries, query)
    expect(result.items.length).toBe(2)
    expect(result.totalCount).toBe(5)
    expect(result.hasMore).toBe(true)
  })
})

// ── evidenceQuery ────────────────────────────────────────────────────────────

describe("evidenceQuery", () => {
  test("only returns entries with evidenceQuality >= specified minimum", () => {
    const high = makeEntry({ codexEntryId: "high", quality: { evidenceQuality: "high", corroborationCount: 5, reproducibilityStatus: "reproduced", confidence: 0.9 } })
    const medium = makeEntry({ codexEntryId: "medium", quality: { evidenceQuality: "medium", corroborationCount: 2, reproducibilityStatus: "unverified", confidence: 0.7 } })
    const low = makeEntry({ codexEntryId: "low", quality: { evidenceQuality: "low", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0.5 } })

    const query: CodexQuery = {
      mode: "evidence",
      query: "",
      filters: { evidenceQuality: "medium" },
    }

    const result = evidenceQuery([low, medium, high], query)
    expect(result.items.length).toBe(2)
    expect(result.items.map((i) => i.entry.codexEntryId).sort()).toEqual(["high", "medium"])
  })

  test("sorts by quality high -> medium -> low", () => {
    const medium = makeEntry({ codexEntryId: "medium", quality: { evidenceQuality: "medium", corroborationCount: 1, reproducibilityStatus: "unverified", confidence: 0.7 } })
    const high = makeEntry({ codexEntryId: "high", quality: { evidenceQuality: "high", corroborationCount: 5, reproducibilityStatus: "reproduced", confidence: 0.9 } })

    const query: CodexQuery = { mode: "evidence", query: "" }
    const result = evidenceQuery([medium, high], query)
    expect(result.items[0]!.entry.codexEntryId).toBe("high")
    expect(result.items[1]!.entry.codexEntryId).toBe("medium")
  })

  test("within same quality, sorts by corroboration count descending", () => {
    const corr5 = makeEntry({ codexEntryId: "c5", quality: { evidenceQuality: "high", corroborationCount: 5, reproducibilityStatus: "reproduced", confidence: 0.9 } })
    const corr2 = makeEntry({ codexEntryId: "c2", quality: { evidenceQuality: "high", corroborationCount: 2, reproducibilityStatus: "reproduced", confidence: 0.9 } })

    const query: CodexQuery = { mode: "evidence", query: "" }
    const result = evidenceQuery([corr2, corr5], query)
    expect(result.items[0]!.entry.codexEntryId).toBe("c5")
    expect(result.items[1]!.entry.codexEntryId).toBe("c2")
  })
})

// ── filterByEvidenceQuality ──────────────────────────────────────────────────

describe("filterByEvidenceQuality", () => {
  test("includes entries at or above the minimum quality", () => {
    const entries = [
      makeEntry({ codexEntryId: "h", quality: { evidenceQuality: "high", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0 } }),
      makeEntry({ codexEntryId: "m", quality: { evidenceQuality: "medium", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0 } }),
      makeEntry({ codexEntryId: "l", quality: { evidenceQuality: "low", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0 } }),
    ]
    const filtered = filterByEvidenceQuality(entries, "medium")
    expect(filtered.map((e) => e.codexEntryId)).toEqual(["h", "m"])
  })
})

// ── filterByProvenance ───────────────────────────────────────────────────────

describe("filterByProvenance", () => {
  test("finds entries authored or approved by given IDs", () => {
    const alice = makeEntry({ codexEntryId: "a", provenance: { createdFromReceiptIds: [], derivationPolicyVersion: "", ingestionMode: "automatic", authoredBy: ["alice"], approvedBy: [], createdAtLogicalTime: "" } })
    const bob = makeEntry({ codexEntryId: "b", provenance: { createdFromReceiptIds: [], derivationPolicyVersion: "", ingestionMode: "automatic", authoredBy: ["bob"], approvedBy: [], createdAtLogicalTime: "" } })
    const both = makeEntry({ codexEntryId: "c", provenance: { createdFromReceiptIds: [], derivationPolicyVersion: "", ingestionMode: "automatic", authoredBy: ["alice"], approvedBy: ["bob"], createdAtLogicalTime: "" } })

    const filtered = filterByProvenance([alice, bob, both], ["alice"])
    expect(filtered.map((e) => e.codexEntryId).sort()).toEqual(["a", "c"])
  })

  test("returns all entries when contributorIds is empty", () => {
    const e = makeEntry()
    expect(filterByProvenance([e], [])).toEqual([e])
  })
})

// ── filterByVisibility ───────────────────────────────────────────────────────

describe("filterByVisibility", () => {
  test("only includes matching visibility classes", () => {
    const pub = makeEntry({ codexEntryId: "p", visibilityClass: "public" })
    const session = makeEntry({ codexEntryId: "s", visibilityClass: "session" })
    const result = filterByVisibility([pub, session], ["public"])
    expect(result.map((e) => e.codexEntryId)).toEqual(["p"])
  })

  test("returns all entries when classes is empty", () => {
    const e = makeEntry()
    expect(filterByVisibility([e], [])).toEqual([e])
  })
})

// ── operationalQuery / meetsOperationalThreshold ─────────────────────────────

describe("operationalQuery", () => {
  test("only returns entries meeting all thresholds", () => {
    const passing = makeEntry({
      codexEntryId: "pass",
      quality: { evidenceQuality: "high", corroborationCount: 3, reproducibilityStatus: "independently_reproduced", confidence: 0.95 },
    })
    const lowConf = makeEntry({
      codexEntryId: "lowconf",
      quality: { evidenceQuality: "high", corroborationCount: 3, reproducibilityStatus: "reproduced", confidence: 0.3 },
    })
    const lowQ = makeEntry({
      codexEntryId: "lowq",
      quality: { evidenceQuality: "low", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0.9 },
    })

    const query: CodexQuery = {
      mode: "operational",
      query: "",
      filters: { evidenceQuality: "medium", minConfidence: 0.5, reproducibilityStatus: "reproduced" },
    }

    const result = operationalQuery([lowConf, lowQ, passing], query)
    expect(result.items.length).toBe(1)
    expect(result.items[0]!.entry.codexEntryId).toBe("pass")
  })
})

describe("meetsOperationalThreshold", () => {
  const entry = makeEntry()

  test("passes when all thresholds are met", () => {
    expect(meetsOperationalThreshold(entry, "low", 0, "unverified")).toBe(true)
  })

  test("fails when quality is below minimum", () => {
    // entry has high quality; requesting high passes, requesting a non-existent rank fails
    expect(meetsOperationalThreshold(entry, "high", 0, "unverified")).toBe(true)
    const lowQuality = makeEntry({
      quality: { evidenceQuality: "low", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0 },
    })
    expect(meetsOperationalThreshold(lowQuality, "high", 0, "unverified")).toBe(false)
  })

  test("fails when confidence is below minimum", () => {
    expect(meetsOperationalThreshold(entry, "low", 0.95, "unverified")).toBe(false)
  })

  test("fails when reproducibility is below minimum", () => {
    expect(meetsOperationalThreshold(entry, "low", 0, "independently_reproduced")).toBe(false)
  })
})

// ── executeQuery ─────────────────────────────────────────────────────────────

describe("executeQuery", () => {
  test("dispatches discovery mode", () => {
    const entries = [makeEntry()]
    const query: CodexQuery = { mode: "discovery", query: "test" }
    const result = executeQuery(entries, query)
    expect(result.mode).toBe("discovery")
    expect(result.items.length).toBe(1)
  })

  test("dispatches evidence mode", () => {
    const entries = [makeEntry()]
    const query: CodexQuery = { mode: "evidence", query: "" }
    const result = executeQuery(entries, query)
    expect(result.mode).toBe("evidence")
  })

  test("dispatches operational mode", () => {
    const entries = [makeEntry()]
    const query: CodexQuery = { mode: "operational", query: "" }
    const result = executeQuery(entries, query)
    expect(result.mode).toBe("operational")
  })

  test("returns empty result for unknown mode", () => {
    const query = { mode: "unknown" as "discovery", query: "" }
    const result = executeQuery([makeEntry()], query)
    expect(result.items).toEqual([])
    expect(result.totalCount).toBe(0)
  })
})

// ── applyFilters ─────────────────────────────────────────────────────────────

describe("applyFilters", () => {
  const e1 = makeEntry({
    codexEntryId: "e1",
    knowledgeClass: "performance_evidence",
    visibilityClass: "public",
    provenance: {
      createdFromReceiptIds: [],
      derivationPolicyVersion: "",
      ingestionMode: "automatic",
      authoredBy: ["alice"],
      approvedBy: [],
      createdAtLogicalTime: "2026-01-01T00:00:00.000Z",
    },
    quality: {
      evidenceQuality: "high",
      corroborationCount: 0,
      reproducibilityStatus: "reproduced",
      confidence: 0.95,
    },
    claims: [makeClaim({}, { hardwareTargets: ["a100"], softwareVersions: ["2.0.0"] })],
  })
  const e2 = makeEntry({
    codexEntryId: "e2",
    knowledgeClass: "architecture_decision",
    visibilityClass: "session",
    provenance: {
      createdFromReceiptIds: [],
      derivationPolicyVersion: "",
      ingestionMode: "automatic",
      authoredBy: ["bob"],
      approvedBy: [],
      createdAtLogicalTime: "2026-06-30T12:00:00.000Z",
    },
    quality: {
      evidenceQuality: "low",
      corroborationCount: 0,
      reproducibilityStatus: "unverified",
      confidence: 0.4,
    },
    claims: [makeClaim({}, { hardwareTargets: ["amd64"], softwareVersions: ["3.x"] })],
  })

  test("returns all entries when no filters", () => {
    const result = applyFilters([e1, e2], undefined)
    expect(result.length).toBe(2)
  })

  test("filters by knowledge class", () => {
    const result = applyFilters([e1, e2], { knowledgeClasses: ["performance_evidence"] })
    expect(result.map((e) => e.codexEntryId)).toEqual(["e1"])
  })

  test("filters by visibility", () => {
    const result = applyFilters([e1, e2], { visibilityClasses: ["public"] })
    expect(result.map((e) => e.codexEntryId)).toEqual(["e1"])
  })

  test("filters by contributor ID", () => {
    const result = applyFilters([e1, e2], { contributorIds: ["alice"] })
    expect(result.map((e) => e.codexEntryId)).toEqual(["e1"])
  })

  test("filters by evidence quality", () => {
    const result = applyFilters([e1, e2], { evidenceQuality: "medium" })
    expect(result.map((e) => e.codexEntryId)).toEqual(["e1"])
  })

  test("filters by minimum confidence", () => {
    const result = applyFilters([e1, e2], { minConfidence: 0.5 })
    expect(result.map((e) => e.codexEntryId)).toEqual(["e1"])
  })

  test("filters by reproducibility status", () => {
    const result = applyFilters([e1, e2], { reproducibilityStatus: "reproduced" })
    expect(result.map((e) => e.codexEntryId)).toEqual(["e1"])
  })

  test("filters by hardware targets (semantic)", () => {
    // e1 has "a100", e2 has "amd64"
    const result = applyFilters([e1, e2], { hardwareTargets: ["a100"] })
    expect(result.map((e) => e.codexEntryId)).toEqual(["e1"])
  })

  test("chaining multiple filters narrows correctly", () => {
    const result = applyFilters([e1, e2], {
      knowledgeClasses: ["architecture_decision"],
      visibilityClasses: ["session"],
    })
    expect(result.map((e) => e.codexEntryId)).toEqual(["e2"])
  })
})

// ── matchScope ───────────────────────────────────────────────────────────────

describe("matchScope", () => {
  const entryScope = {
    hardwareTargets: ["a100", "h100"],
    softwareVersions: ["2.0.0", "3.1.0"],
    modelFamilies: ["gpt", "llama"],
    contextNotes: [],
  }

  test("returns true when queryScope is undefined", () => {
    expect(matchScope(undefined, entryScope)).toBe(true)
  })

  test("matches hardware by prefix", () => {
    expect(matchScope({ hardwareTargets: ["a100"], softwareVersions: [], modelFamilies: [], contextNotes: [] }, entryScope)).toBe(true)
  })

  test("rejects non-matching hardware", () => {
    expect(matchScope({ hardwareTargets: ["v100"], softwareVersions: [], modelFamilies: [], contextNotes: [] }, entryScope)).toBe(false)
  })

  test("matches model families case-insensitively", () => {
    expect(matchScope({ hardwareTargets: [], softwareVersions: [], modelFamilies: ["GPT"], contextNotes: [] }, entryScope)).toBe(true)
  })

  test("matches software versions with wildcard", () => {
    expect(matchScope({ hardwareTargets: [], softwareVersions: ["3.x"], modelFamilies: [], contextNotes: [] }, entryScope)).toBe(true)
  })

  test("matches software versions with range prefix", () => {
    expect(matchScope({ hardwareTargets: [], softwareVersions: [">=3"], modelFamilies: [], contextNotes: [] }, entryScope)).toBe(true)
  })
})

// ── matchTimeRange ───────────────────────────────────────────────────────────

describe("matchTimeRange", () => {
  const entry = makeEntry({
    provenance: {
      createdFromReceiptIds: [],
      derivationPolicyVersion: "",
      ingestionMode: "automatic",
      authoredBy: [],
      approvedBy: [],
      createdAtLogicalTime: "2026-06-30T12:00:00.000Z",
    },
  })

  test("returns true when no range specified", () => {
    expect(matchTimeRange(entry)).toBe(true)
  })

  test("returns true when entry is within range", () => {
    expect(matchTimeRange(entry, "2026-01-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z")).toBe(true)
  })

  test("returns false when entry is before range", () => {
    expect(matchTimeRange(entry, "2026-07-01T00:00:00.000Z")).toBe(false)
  })

  test("returns false when entry is after range", () => {
    expect(matchTimeRange(entry, undefined, "2026-01-01T00:00:00.000Z")).toBe(false)
  })
})

// ── formatQueryItem / getLineageWarning / getEligibilitySummary ───────────────

describe("getLineageWarning", () => {
  test("returns null for published entries", () => {
    expect(getLineageWarning(makeEntry({ status: "published" }))).toBeNull()
  })

  test("returns warning for superseded entries with supersededBy", () => {
    const w = getLineageWarning(makeEntry({ status: "superseded", lineage: { supersedes: null, supersededBy: "entry_002", relatedEntryIds: [] } }))
    expect(w).toBe("Superseded by entry_002")
  })

  test("returns generic warning for superseded entries without supersededBy", () => {
    const w = getLineageWarning(makeEntry({ status: "superseded", lineage: { supersedes: null, supersededBy: null, relatedEntryIds: [] } }))
    expect(w).toBe("Superseded")
  })

  test("returns warning for contested entries", () => {
    expect(getLineageWarning(makeEntry({ status: "contested" }))).toBe("Contested")
  })

  test("returns warning for revoked entries", () => {
    expect(getLineageWarning(makeEntry({ status: "revoked" }))).toBe("Revoked")
  })
})

describe("getEligibilitySummary", () => {
  test("draft entries have limited eligibility", () => {
    const s = getEligibilitySummary(makeEntry({ status: "draft" }))
    expect(s).toContain("Limited eligibility")
  })

  test("revoked entries are not eligible", () => {
    const s = getEligibilitySummary(makeEntry({ status: "revoked" }))
    expect(s).toContain("Not eligible")
  })

  test("published entries with all policy are eligible for all", () => {
    const s = getEligibilitySummary(makeEntry({ status: "published", policy: { queryEligibility: "all", derivativeUsePolicy: "restricted", benefitPolicyId: "" } }))
    expect(s).toBe("Eligible for all queries")
  })

  test("grant_required entries note visibility", () => {
    const s = getEligibilitySummary(makeEntry({ policy: { queryEligibility: "grant_required", derivativeUsePolicy: "restricted", benefitPolicyId: "" }, visibilityClass: "session" }))
    expect(s).toContain("grant")
    expect(s).toContain("session")
  })
})

describe("formatQueryItem", () => {
  test("produces a complete CodexQueryItem", () => {
    const entry = makeEntry({
      status: "superseded",
      lineage: { supersedes: null, supersededBy: "entry_002", relatedEntryIds: [] },
    })
    const item = formatQueryItem(entry, 0.85, "Matched term: transformer")
    expect(item.entry.codexEntryId).toBe("entry_001")
    expect(item.relevanceScore).toBe(0.85)
    expect(item.matchReason).toBe("Matched term: transformer")
    expect(item.lineageWarning).toBe("Superseded by entry_002")
    expect(item.eligibilitySummary).toBe("Eligible for all queries")
    expect(item.provenanceSummary.authoredBy).toEqual(["did:dht:alice"])
    expect(item.provenanceSummary.evidenceCount).toBe(1)
    expect(item.qualitySummary.evidenceQuality).toBe("high")
    expect(item.scopeContext.hardwareTargets).toEqual(["a100"])
  })
})

// ── sortByRelevance ──────────────────────────────────────────────────────────

describe("sortByRelevance", () => {
  test("sorts by score descending", () => {
    const items: CodexQueryItem[] = [
      { entry: makeEntry({ codexEntryId: "a" }), relevanceScore: 0.3, matchReason: "", provenanceSummary: { authoredBy: [], approvedBy: [], ingestionMode: "automatic", evidenceCount: 0 }, qualitySummary: { evidenceQuality: "high", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0.9 }, lineageWarning: null, scopeContext: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, eligibilitySummary: "" },
      { entry: makeEntry({ codexEntryId: "b" }), relevanceScore: 0.9, matchReason: "", provenanceSummary: { authoredBy: [], approvedBy: [], ingestionMode: "automatic", evidenceCount: 0 }, qualitySummary: { evidenceQuality: "high", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0.9 }, lineageWarning: null, scopeContext: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, eligibilitySummary: "" },
    ]
    const sorted = sortByRelevance(items)
    expect(sorted[0]!.relevanceScore).toBe(0.9)
    expect(sorted[1]!.relevanceScore).toBe(0.3)
  })
})

// ── sortByEvidenceQuality ────────────────────────────────────────────────────

describe("sortByEvidenceQuality", () => {
  test("sorts by quality then corroboration count", () => {
    const items: CodexQueryItem[] = [
      { entry: makeEntry({ codexEntryId: "a" }), relevanceScore: 0, matchReason: "", provenanceSummary: { authoredBy: [], approvedBy: [], ingestionMode: "automatic", evidenceCount: 0 }, qualitySummary: { evidenceQuality: "low", corroborationCount: 0, reproducibilityStatus: "unverified", confidence: 0.9 }, lineageWarning: null, scopeContext: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, eligibilitySummary: "" },
      { entry: makeEntry({ codexEntryId: "b" }), relevanceScore: 0, matchReason: "", provenanceSummary: { authoredBy: [], approvedBy: [], ingestionMode: "automatic", evidenceCount: 0 }, qualitySummary: { evidenceQuality: "high", corroborationCount: 2, reproducibilityStatus: "unverified", confidence: 0.9 }, lineageWarning: null, scopeContext: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, eligibilitySummary: "" },
      { entry: makeEntry({ codexEntryId: "c" }), relevanceScore: 0, matchReason: "", provenanceSummary: { authoredBy: [], approvedBy: [], ingestionMode: "automatic", evidenceCount: 0 }, qualitySummary: { evidenceQuality: "high", corroborationCount: 5, reproducibilityStatus: "unverified", confidence: 0.9 }, lineageWarning: null, scopeContext: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, eligibilitySummary: "" },
    ]
    const sorted = sortByEvidenceQuality(items)
    expect(sorted[0]!.entry.codexEntryId).toBe("c")
    expect(sorted[1]!.entry.codexEntryId).toBe("b")
    expect(sorted[2]!.entry.codexEntryId).toBe("a")
  })
})
