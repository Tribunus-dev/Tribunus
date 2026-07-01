/**
 * Codex Phase 2 — Ingestion Pipeline Tests
 *
 * Tests candidate creation, knowledge class mapping, curator gates,
 * duplicate analysis, claim extraction, and evidence ref building.
 */

import { describe, test, expect } from "bun:test"
import type { DharmaContributionRecord } from "../../contribution/contribution-types"
import type {
  CodexCandidate,
  CodexEntry,
  KnowledgeClass,
  EvidenceRef,
  CodexClaim,
} from "../codex-types"
import {
  createCandidateFromContribution,
  contributionClassToKnowledgeClass,
  requiresCuratorApproval,
  analyzeDuplicates,
  promoteCandidate,
  extractClaims,
  buildEvidenceRefs,
  AUTOMATIC_CLASSES,
} from "../codex-ingestion"

// ── Test Fixtures ────────────────────────────────────────────────────────────

function makeContribution(
  overrides?: Partial<DharmaContributionRecord>,
): DharmaContributionRecord {
  return {
    contributionId: overrides?.contributionId ?? "c_001",
    sessionId: overrides?.sessionId ?? "s_abc",
    contributorIdentityDigest: overrides?.contributorIdentityDigest ?? "did:dht:alice",
    contributionClass: overrides?.contributionClass ?? "work_product",
    description: overrides?.description ?? "Implemented the core merge logic",
    receiptDigests: overrides?.receiptDigests ?? ["r_001", "r_002"],
    acceptedBy: overrides?.acceptedBy ?? "curator_01",
    acceptedAt: overrides?.acceptedAt ?? "2026-06-30T12:00:00.000Z",
    evidenceQuality: overrides?.evidenceQuality ?? "high",
    resourceCostSummary: overrides?.resourceCostSummary ?? null,
    outcomeRelation: overrides?.outcomeRelation ?? "benchmark:model-x:v2",
    codexEligibility: overrides?.codexEligibility ?? true,
    visibilityClass: overrides?.visibilityClass ?? "session",
    createdAt: overrides?.createdAt ?? "2026-06-30T12:00:00.000Z",
  }
}

function makeCandidate(overrides?: Partial<CodexCandidate>): CodexCandidate {
  return {
    candidateId: overrides?.candidateId ?? "cand_001",
    sourceContributionIds: overrides?.sourceContributionIds ?? ["c_001"],
    knowledgeClass: overrides?.knowledgeClass ?? "performance_evidence",
    claims: overrides?.claims ?? [
      {
        claimId: "cl_001",
        statement: "Merge latency benchmark",
        claimType: "measurement",
        supportRefs: [],
        scope: { hardwareTargets: ["m1"], softwareVersions: ["v2"], modelFamilies: [], contextNotes: [] },
        confidence: 0.9,
      },
    ],
    evidenceRefs: overrides?.evidenceRefs ?? [
      {
        receiptDigest: "r_001",
        contributionId: "c_001",
        artifactDigest: "abcdef123",
        description: "Evidence from work_product contribution",
      },
    ],
    visibilityClass: overrides?.visibilityClass ?? "session",
    status: overrides?.status ?? "pending_validation",
    duplicateAnalysis: overrides?.duplicateAnalysis ?? null,
    createdAt: overrides?.createdAt ?? "2026-06-30T12:00:00.000Z",
  }
}

function makeEntry(overrides?: Partial<CodexEntry>): CodexEntry {
  return {
    codexEntryId: overrides?.codexEntryId ?? "entry_001",
    schemaVersion: 1,
    status: overrides?.status ?? "published",
    visibilityClass: overrides?.visibilityClass ?? "session",
    knowledgeClass: overrides?.knowledgeClass ?? "performance_evidence",
    title: overrides?.title ?? "Merge latency benchmark",
    abstract: overrides?.abstract ?? "",
    claims: overrides?.claims ?? [
      {
        claimId: "cl_001",
        statement: "Merge latency benchmark",
        claimType: "measurement",
        supportRefs: [],
        scope: { hardwareTargets: ["m1"], softwareVersions: ["v2"], modelFamilies: [], contextNotes: [] },
        confidence: 0.9,
      },
    ],
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
      corroborationCount: 0,
      reproducibilityStatus: "unverified",
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

// ── contributionClassToKnowledgeClass ────────────────────────────────────────

describe("contributionClassToKnowledgeClass", () => {
  const expectedMappings: Record<string, KnowledgeClass> = {
    work_product: "implementation_pattern",
    review_evidence: "debugging_finding",
    reproduction_evidence: "research_result",
    compute_lease: "performance_evidence",
    artifact_contribution: "implementation_pattern",
    documentation_contribution: "workflow_pattern",
    moderation_action: "governance_precedent",
    research_evidence: "research_result",
    session_stewardship: "governance_precedent",
  }

  for (const [cls, expected] of Object.entries(expectedMappings)) {
    test(`${cls} → ${expected}`, () => {
      expect(contributionClassToKnowledgeClass(cls)).toBe(expected)
    })
  }

  test("unknown class defaults to research_result", () => {
    expect(contributionClassToKnowledgeClass("unknown_class")).toBe("research_result")
  })
})

// ── requiresCuratorApproval ──────────────────────────────────────────────────

describe("requiresCuratorApproval", () => {
  const allClasses: KnowledgeClass[] = [
    "implementation_pattern",
    "architecture_decision",
    "debugging_finding",
    "performance_evidence",
    "compatibility_fact",
    "failure_mode",
    "governance_precedent",
    "research_result",
    "workflow_pattern",
  ]

  for (const kc of allClasses) {
    const isAuto = (AUTOMATIC_CLASSES as KnowledgeClass[]).includes(kc)
    test(`${kc} → ${isAuto ? "auto (no curator)" : "curator required"}`, () => {
      expect(requiresCuratorApproval(kc)).toBe(!isAuto)
    })
  }
})

// ── createCandidateFromContribution ──────────────────────────────────────────

describe("createCandidateFromContribution", () => {
  test("creates a pending candidate with proper fields", () => {
    const contrib = makeContribution()
    const candidate = createCandidateFromContribution(contrib)

    expect(candidate.sourceContributionIds).toEqual(["c_001"])
    expect(candidate.knowledgeClass).toBe("implementation_pattern")
    expect(candidate.status).toBe("pending_validation")
    expect(candidate.duplicateAnalysis).toBeNull()
    expect(candidate.evidenceRefs).toHaveLength(2)
    expect(candidate.claims).toHaveLength(1)
  })

  test("sets scope descriptor from outcome relation", () => {
    const contrib = makeContribution({
      outcomeRelation: "benchmark:model-x:v2",
      contributionClass: "compute_lease",
    })
    const candidate = createCandidateFromContribution(contrib)

    const scope = candidate.claims[0].scope
    expect(scope.softwareVersions).toContain("v2")
    expect(scope.hardwareTargets).toHaveLength(0)
    expect(scope.contextNotes.some((n) => n.includes("evidenceQuality"))).toBe(true)
  })

  test("parses hardware hints from outcome relation", () => {
    const contrib = makeContribution({
      outcomeRelation: "gpu:nvidia:4090:model-x",
      contributionClass: "compute_lease",
    })
    const candidate = createCandidateFromContribution(contrib)
    const scope = candidate.claims[0].scope

    expect(scope.hardwareTargets).toContain("gpu")
    expect(scope.hardwareTargets).toContain("nvidia")
    expect(scope.hardwareTargets).toContain("4090")
  })

  test("handles contribution with no receipt digests", () => {
    const contrib = makeContribution({ receiptDigests: [] })
    const candidate = createCandidateFromContribution(contrib)

    expect(candidate.evidenceRefs).toHaveLength(0)
  })

  test("maps reproduction_evidence to research_result and procedure claim", () => {
    const contrib = makeContribution({ contributionClass: "reproduction_evidence" })
    const candidate = createCandidateFromContribution(contrib)

    expect(candidate.knowledgeClass).toBe("research_result")
    expect(candidate.claims[0].claimType).toBe("procedure")
  })

  test("extracts measurement sub-claim from resource cost", () => {
    const contrib = makeContribution({
      contributionClass: "compute_lease",
      resourceCostSummary: { computeMs: 500, tokenCount: 3000, storageBytes: 1024 },
    })
    const candidate = createCandidateFromContribution(contrib)

    expect(candidate.claims).toHaveLength(2)
    expect(candidate.claims[1].claimType).toBe("measurement")
    expect(candidate.claims[1].statement).toContain("computeMs=500")
  })
})

// ── buildEvidenceRefs ────────────────────────────────────────────────────────

describe("buildEvidenceRefs", () => {
  test("builds one ref per receipt digest", () => {
    const contrib = makeContribution({ receiptDigests: ["r_a", "r_b", "r_c"] })
    const refs = buildEvidenceRefs(contrib)

    expect(refs).toHaveLength(3)
    expect(refs[0].receiptDigest).toBe("r_a")
    expect(refs[1].receiptDigest).toBe("r_b")
    expect(refs[2].receiptDigest).toBe("r_c")
  })

  test("each ref references the contribution id", () => {
    const contrib = makeContribution({ contributionId: "c_xyz", receiptDigests: ["r_001"] })
    const refs = buildEvidenceRefs(contrib)

    expect(refs[0].contributionId).toBe("c_xyz")
  })

  test("returns empty array for no digests", () => {
    const contrib = makeContribution({ receiptDigests: [] })
    expect(buildEvidenceRefs(contrib)).toHaveLength(0)
  })

  test("generates a digest for each ref", () => {
    const contrib = makeContribution({ receiptDigests: ["r_001"] })
    const refs = buildEvidenceRefs(contrib)

    expect(refs[0].artifactDigest).toBeTruthy()
    expect(typeof refs[0].artifactDigest).toBe("string")
  })
})

// ── extractClaims ────────────────────────────────────────────────────────────

describe("extractClaims", () => {
  test("extracts a primary claim from description", () => {
    const contrib = makeContribution({
      description: "Proved that model X converges in 42 steps",
    })
    const refs = buildEvidenceRefs(contrib)
    const claims = extractClaims(contrib, refs)

    expect(claims).toHaveLength(1)
    expect(claims[0].statement).toBe("Proved that model X converges in 42 steps")
    expect(claims[0].claimType).toBe("decision") // work_product → decision
    expect(claims[0].supportRefs).toHaveLength(2)
  })

  test("extracts measurement sub-claim when resource cost present", () => {
    const contrib = makeContribution({
      resourceCostSummary: { computeMs: 500, tokenCount: 3000, storageBytes: 1024 },
    })
    const refs = buildEvidenceRefs(contrib)
    const claims = extractClaims(contrib, refs)

    expect(claims).toHaveLength(2)
    expect(claims[1].claimType).toBe("measurement")
    expect(claims[1].statement).toContain("computeMs=500")
    expect(claims[1].statement).toContain("tokens=3000")
    expect(claims[1].statement).toContain("storage=1024")
  })

  test("sets claim type based on contribution class", () => {
    const tests: Array<{ cls: string; expected: CodexClaim["claimType"] }> = [
      { cls: "reproduction_evidence", expected: "procedure" },
      { cls: "review_evidence", expected: "recommendation" },
      { cls: "research_evidence", expected: "fact" },
      { cls: "compute_lease", expected: "measurement" },
      { cls: "work_product", expected: "decision" },
      { cls: "moderation_action", expected: "fact" },
    ]

    for (const { cls, expected } of tests) {
      const contrib = makeContribution({
        contributionClass: cls as DharmaContributionRecord["contributionClass"],
        description: `Test for ${cls}`,
      })
      const refs = buildEvidenceRefs(contrib)
      const claims = extractClaims(contrib, refs)
      expect(claims[0].claimType).toBe(expected)
    }
  })

  test("sets confidence from evidence quality", () => {
    const high = makeContribution({ evidenceQuality: "high" })
    const medium = makeContribution({ evidenceQuality: "medium" })
    const low = makeContribution({ evidenceQuality: "low" })
    const refs = buildEvidenceRefs(high)

    expect(extractClaims(high, refs)[0].confidence).toBe(0.9)
    expect(extractClaims(medium, refs)[0].confidence).toBe(0.6)
    expect(extractClaims(low, refs)[0].confidence).toBe(0.3)
  })
})

// ── analyzeDuplicates ────────────────────────────────────────────────────────

describe("analyzeDuplicates", () => {
  test("no duplicates when existing is empty", () => {
    const candidate = makeCandidate()
    const result = analyzeDuplicates(candidate, [])

    expect(result.similarEntryIds).toHaveLength(0)
    expect(result.similarityScores).toEqual({})
    expect(result.conclusion).toBe("new")
  })

  test("detects duplicate when evidence digest overlaps and scope matches", () => {
    const candidate = makeCandidate({
      evidenceRefs: [
        {
          receiptDigest: "r_001",
          contributionId: "c_001",
          artifactDigest: "same_digest",
          description: "Some evidence",
        },
      ],
      knowledgeClass: "performance_evidence",
      claims: [
        {
          claimId: "cl_001",
          statement: "Benchmark",
          claimType: "measurement",
          supportRefs: [],
          scope: {
            hardwareTargets: ["m1"],
            softwareVersions: ["v2"],
            modelFamilies: [],
            contextNotes: [],
          },
          confidence: 0.9,
        },
      ],
    })

    const existing = [
      makeEntry({
        evidenceRefs: [
          {
            receiptDigest: "r_001",
            contributionId: "c_old",
            artifactDigest: "same_digest",
            description: "Old evidence",
          },
        ],
        knowledgeClass: "performance_evidence",
        claims: [
          {
            claimId: "cl_old",
            statement: "Old benchmark",
            claimType: "measurement",
            supportRefs: [],
            scope: {
              hardwareTargets: ["m1"],
              softwareVersions: ["v2"],
              modelFamilies: [],
              contextNotes: [],
            },
            confidence: 0.8,
          },
        ],
      }),
    ]

    const result = analyzeDuplicates(candidate, existing)
    expect(result.similarEntryIds).toHaveLength(1)
    expect(result.conclusion).toBe("duplicate")
    expect(result.hardwareConflict).toBe(false)
    expect(result.scopeConflict).toBe(false)
  })

  test("detects hardware conflict when hardware differs", () => {
    const candidate = makeCandidate({
      evidenceRefs: [
        {
          receiptDigest: "r_001",
          contributionId: "c_001",
          artifactDigest: "shared_digest",
          description: "Some evidence",
        },
      ],
      knowledgeClass: "performance_evidence",
      claims: [
        {
          claimId: "cl_001",
          statement: "Benchmark on M1",
          claimType: "measurement",
          supportRefs: [],
          scope: {
            hardwareTargets: ["m1"],
            softwareVersions: ["v2"],
            modelFamilies: [],
            contextNotes: [],
          },
          confidence: 0.9,
        },
      ],
    })

    const existing = [
      makeEntry({
        evidenceRefs: [
          {
            receiptDigest: "r_001",
            contributionId: "c_old",
            artifactDigest: "shared_digest",
            description: "Old evidence",
          },
        ],
        knowledgeClass: "performance_evidence",
        claims: [
          {
            claimId: "cl_old",
            statement: "Benchmark on NVIDIA",
            claimType: "measurement",
            supportRefs: [],
            scope: {
              hardwareTargets: ["nvidia"],
              softwareVersions: ["v2"],
              modelFamilies: [],
              contextNotes: [],
            },
            confidence: 0.8,
          },
        ],
      }),
    ]

    const result = analyzeDuplicates(candidate, existing)
    // Same evidence but different hardware => supersedes, not duplicate
    expect(result.similarEntryIds).toHaveLength(1)
    expect(result.hardwareConflict).toBe(true)
    expect(result.conclusion).toBe("supersedes")
  })

  test("cross-class entries are not compared", () => {
    const candidate = makeCandidate({
      evidenceRefs: [
        {
          receiptDigest: "r_001",
          contributionId: "c_001",
          artifactDigest: "same_digest",
          description: "Some evidence",
        },
      ],
      knowledgeClass: "performance_evidence",
    })

    const existing = [
      makeEntry({
        knowledgeClass: "workflow_pattern",
        evidenceRefs: [
          {
            receiptDigest: "r_001",
            contributionId: "c_old",
            artifactDigest: "same_digest",
            description: "Old evidence",
          },
        ],
      }),
    ]

    const result = analyzeDuplicates(candidate, existing)
    expect(result.similarEntryIds).toHaveLength(0)
    expect(result.conclusion).toBe("new")
  })
})

// ── promoteCandidate ─────────────────────────────────────────────────────────

describe("promoteCandidate", () => {
  test("auto-publishes automatic classes without curator", () => {
    const candidate = makeCandidate({ knowledgeClass: "performance_evidence" })
    const result = promoteCandidate(candidate, [])

    expect(result.requiresCuratorApproval).toBe(false)
    expect(result.mode).toBe("automatic")
    expect(result.entry).not.toBeNull()
    expect(result.entry!.status).toBe("published")
    expect(result.entry!.knowledgeClass).toBe("performance_evidence")
  })

  test("auto-publishes compatibility_fact", () => {
    const candidate = makeCandidate({ knowledgeClass: "compatibility_fact" })
    const result = promoteCandidate(candidate, [])

    expect(result.requiresCuratorApproval).toBe(false)
    expect(result.mode).toBe("automatic")
    expect(result.entry).not.toBeNull()
  })

  test("auto-publishes failure_mode", () => {
    const candidate = makeCandidate({ knowledgeClass: "failure_mode" })
    const result = promoteCandidate(candidate, [])

    expect(result.requiresCuratorApproval).toBe(false)
    expect(result.mode).toBe("automatic")
    expect(result.entry).not.toBeNull()
  })

  test("forms correct IngestionMode for non-automatic classes", () => {
    const candidate = makeCandidate({ knowledgeClass: "architecture_decision" })
    const result = promoteCandidate(candidate, [])

    expect(result.requiresCuratorApproval).toBe(true)
    expect(result.mode).toBe("curator_proposed")
    expect(result.entry).toBeNull()
  })

  test("non-automatic classes still need approvedBy to publish", () => {
    const candidate = makeCandidate({ knowledgeClass: "implementation_pattern" })
    const result = promoteCandidate(candidate, [])

    expect(result.entry).toBeNull()
  })

  test("rejects duplicate candidates with duplicate_found status", () => {
    const candidate = makeCandidate({
      evidenceRefs: [
        {
          receiptDigest: "r_001",
          contributionId: "c_001",
          artifactDigest: "dup_digest",
          description: "Duplicate evidence",
        },
      ],
      knowledgeClass: "performance_evidence",
      claims: [
        {
          claimId: "cl_001",
          statement: "Benchmark",
          claimType: "measurement",
          supportRefs: [],
          scope: {
            hardwareTargets: ["m1"],
            softwareVersions: ["v2"],
            modelFamilies: [],
            contextNotes: [],
          },
          confidence: 0.9,
        },
      ],
    })

    const existing = [
      makeEntry({
        evidenceRefs: [
          {
            receiptDigest: "r_001",
            contributionId: "c_old",
            artifactDigest: "dup_digest",
            description: "Old evidence",
          },
        ],
        knowledgeClass: "performance_evidence",
        claims: [
          {
            claimId: "cl_old",
            statement: "Old benchmark",
            claimType: "measurement",
            supportRefs: [],
            scope: {
              hardwareTargets: ["m1"],
              softwareVersions: ["v2"],
              modelFamilies: [],
              contextNotes: [],
            },
            confidence: 0.8,
          },
        ],
      }),
    ]

    const result = promoteCandidate(candidate, existing)
    expect(result.entry).toBeNull()
    expect(result.candidate.status).toBe("duplicate_found")
    expect(result.requiresCuratorApproval).toBe(true)
  })

  test("populates entry provenance from candidate", () => {
    const candidate = makeCandidate({ knowledgeClass: "performance_evidence" })
    const result = promoteCandidate(candidate, [])

    expect(result.entry).not.toBeNull()
    expect(result.entry!.sourceContributionIds).toEqual(["c_001"])
    expect(result.entry!.evidenceRefs).toHaveLength(1)
    expect(result.entry!.claims).toHaveLength(1)
  })
})

// ── Full pipeline smoke test ─────────────────────────────────────────────────

describe("full ingestion pipeline", () => {
  test("accepted contribution → candidate → promoted entry (auto class)", () => {
    const contrib = makeContribution({
      contributionId: "c_042",
      contributionClass: "compute_lease",
      description: "Throughput benchmark: 1200 req/s on M1 Pro",
      receiptDigests: ["r_throughput_001"],
      outcomeRelation: "throughput:M1-Pro:v1",
    })

    const candidate = createCandidateFromContribution(contrib)
    expect(candidate.knowledgeClass).toBe("performance_evidence")
    expect(candidate.status).toBe("pending_validation")
    expect(candidate.claims[0].claimType).toBe("measurement")

    const result = promoteCandidate(candidate, [])
    expect(result.mode).toBe("automatic")
    expect(result.requiresCuratorApproval).toBe(false)
    expect(result.entry).not.toBeNull()
    expect(result.entry!.status).toBe("published")
    expect(result.entry!.knowledgeClass).toBe("performance_evidence")
    expect(result.entry!.provenance.ingestionMode).toBe("automatic")
  })

  test("accepted contribution → candidate → curator proposes (non-auto class)", () => {
    const contrib = makeContribution({
      contributionId: "c_099",
      contributionClass: "review_evidence",
      description: "Code review finding: unchecked buffer in parse()",
      receiptDigests: ["r_review_001"],
      outcomeRelation: "review:parse-module:v2",
    })

    const candidate = createCandidateFromContribution(contrib)
    expect(candidate.knowledgeClass).toBe("debugging_finding")

    const result = promoteCandidate(candidate, [])
    expect(result.mode).toBe("curator_proposed")
    expect(result.requiresCuratorApproval).toBe(true)
    expect(result.entry).toBeNull()
  })

  test("entry includes full evidence refs when published", () => {
    const contrib = makeContribution({
      contributionClass: "compute_lease",
      description: "Latency benchmark for model X",
      receiptDigests: ["r_alpha"],
      outcomeRelation: "latency:model-x:v3",
    })
    const candidate = createCandidateFromContribution(contrib)
    const result = promoteCandidate(candidate, [])

    expect(result.entry).not.toBeNull()
    expect(result.entry!.evidenceRefs).toHaveLength(1)
    expect(result.entry!.evidenceRefs[0].receiptDigest).toBe("r_alpha")
    expect(result.entry!.sourceContributionIds).toEqual(["c_001"])
  })

  test("sets validated status on the promoted candidate", () => {
    const candidate = makeCandidate()
    const result = promoteCandidate(candidate, [])

    expect(result.candidate.status).toBe("proposed")
  })
})
