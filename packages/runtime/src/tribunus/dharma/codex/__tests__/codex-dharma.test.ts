/**
 * Codex — Dharma Accounting Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createBugResolution,
  verifyResolution,
  createDharmaLedger,
  earnDharmaFromResolution,
  getDharmaBalance,
  getContributorDharma,
  getCodexEntryDharma,
  getResolutionDharma,
  getTotalDharma,
  getDharmaLeaderboard,
  isDharmaEarned,
  createBugResolutionBenefitPolicy,
  type DharmaEntry,
} from "../codex-dharma"
import { createBenefitStore, addPolicy } from "../codex-benefits"
import type { CodexEntry } from "../codex-types"

function makeEntry(overrides?: Partial<CodexEntry>): CodexEntry {
  return {
    codexEntryId: "entry-buffer-bind",
    schemaVersion: 1,
    status: "published",
    visibilityClass: "contributor",
    knowledgeClass: "debugging_finding",
    title: "Buffer must be bound before dispatch",
    abstract: "test",
    claims: [],
    canonicalContentDigest: "abc",
    sourceContributionIds: ["contrib-1"],
    sourceArtifactRefs: [],
    evidenceRefs: [],
    provenance: { createdFromReceiptIds: [], derivationPolicyVersion: "1", ingestionMode: "automatic", authoredBy: ["alice"], approvedBy: ["bob"], createdAtLogicalTime: "1000" },
    quality: { evidenceQuality: "high", corroborationCount: 3, reproducibilityStatus: "independently_reproduced", confidence: 0.9 },
    semanticIndex: { embeddingModelDigest: "", embeddingVectorRef: "", lexicalTerms: [], entityRefs: [] },
    lineage: { supersedes: null, supersededBy: null, relatedEntryIds: [] },
    policy: { queryEligibility: "authenticated", derivativeUsePolicy: "permitted", benefitPolicyId: "bp-1" },
    signatures: [],
    ...overrides,
  }
}

describe("BugResolution", () => {
  test("creates resolution with correct fields", () => {
    const r = createBugResolution("entry-1", "contrib-42", "https://github.com/org/repo/issues/123", "GPU crash on Metal buffer dispatch", "direct_pattern_match")
    expect(r.resolutionId).toBeTruthy()
    expect(r.codexEntryId).toBe("entry-1")
    expect(r.contributionId).toBe("contrib-42")
    expect(r.externalRef).toContain("github.com")
    expect(r.verificationStatus).toBe("unverified")
  })

  test("verifyResolution updates status", () => {
    const r = createBugResolution("entry-1", "contrib-42", "CVE-2026-1234", "crash", "direct_pattern_match")
    const verified = verifyResolution(r, "confirmed_fixed", "receipt-verify-1", "charlie")
    expect(verified.verificationStatus).toBe("confirmed_fixed")
    expect(verified.verificationReceiptDigest).toBe("receipt-verify-1")
    expect(verified.verifiedBy).toBe("charlie")
  })
})

describe("DharmaLedger", () => {
  test("empty ledger has zero balance", () => {
    const ledger = createDharmaLedger()
    expect(getDharmaBalance(ledger, "alice")).toBe(0)
    expect(getTotalDharma(ledger)).toBe(0)
  })

  test("earnDharmaFromResolution creates entry and updates balance", () => {
    const entry = makeEntry()
    const resolution = createBugResolution(entry.codexEntryId, "contrib-42", "issue-1", "crash", "direct_pattern_match")
    const verified = verifyResolution(resolution, "confirmed_fixed", "receipt-v", "charlie")
    const policy = createBugResolutionBenefitPolicy("bp-1")
    let store = addPolicy(createBenefitStore(), policy)
    let ledger = createDharmaLedger()

    const result = earnDharmaFromResolution(verified, entry, "contrib-42", policy, store, ledger, ["alice", "bob"])

    // Dharma entry created
    expect(result.dharmaEntry.amount).toBe(1)
    expect(result.dharmaEntry.contributorDigest).toBe("alice")
    expect(result.dharmaEntry.codexEntryId).toBe(entry.codexEntryId)
    expect(result.dharmaEntry.resolutionId).toBe(verified.resolutionId)

    // Balance updated
    expect(getDharmaBalance(result.ledger, "alice")).toBe(1)

    // Benefit event created
    expect(result.benefitEvent.benefitKind).toBe("reuse")
    expect(result.benefitEvent.codexEntryId).toBe(entry.codexEntryId)

    // Total dharma
    expect(getTotalDharma(result.ledger)).toBe(1)
  })

  test("multiple resolutions accumulate", () => {
    const entry = makeEntry()
    const policy = createBugResolutionBenefitPolicy("bp-1")
    let store = addPolicy(createBenefitStore(), policy)
    let ledger = createDharmaLedger()

    // First resolution
    const r1 = verifyResolution(createBugResolution(entry.codexEntryId, "contrib-1", "issue-1", "crash1", "direct_pattern_match"), "confirmed_fixed", "r1", "charlie")
    const result1 = earnDharmaFromResolution(r1, entry, "contrib-1", policy, store, ledger, ["alice"])
    store = result1.benefitStore
    ledger = result1.ledger

    // Second resolution (same entry, different bug)
    const r2 = verifyResolution(createBugResolution(entry.codexEntryId, "contrib-2", "issue-2", "crash2", "adapted_from_pattern"), "confirmed_fixed", "r2", "charlie")
    const result2 = earnDharmaFromResolution(r2, entry, "contrib-2", policy, store, ledger, ["alice"])
    ledger = result2.ledger

    expect(getDharmaBalance(ledger, "alice")).toBe(2)
    expect(getTotalDharma(ledger)).toBe(2)
    expect(getContributorDharma(ledger, "alice")).toHaveLength(2)
  })

  test("only confirmed fixed/prevented earn dharma", () => {
    expect(isDharmaEarned("confirmed_fixed")).toBe(true)
    expect(isDharmaEarned("confirmed_prevented")).toBe(true)
    expect(isDharmaEarned("unverified")).toBe(false)
    expect(isDharmaEarned("regression_observed")).toBe(false)
  })

  test("leaderboard returns sorted balances", () => {
    const entry = makeEntry()
    const policy = createBugResolutionBenefitPolicy("bp-1")
    let store = addPolicy(createBenefitStore(), policy)
    let ledger = createDharmaLedger()

    const r1 = verifyResolution(createBugResolution(entry.codexEntryId, "c1", "i1", "crash", "direct_pattern_match"), "confirmed_fixed", "r1", "v1")
    const r2 = verifyResolution(createBugResolution(entry.codexEntryId, "c2", "i2", "crash", "direct_pattern_match"), "confirmed_fixed", "r2", "v1")

    // Alice resolves two bugs alone, Bob resolves one
    const res1 = earnDharmaFromResolution(r1, entry, "c1", policy, store, ledger, ["alice"])
    const res2 = earnDharmaFromResolution(r2, entry, "c2", policy, res1.benefitStore, res1.ledger, ["alice"])

    const board = getDharmaLeaderboard(res2.ledger)
    expect(getDharmaBalance(res2.ledger, "alice")).toBe(2)
    expect(getDharmaBalance(res2.ledger, "bob")).toBe(0)
    expect(board.length).toBe(1)
    expect(board[0].contributorDigest).toBe("alice")
    expect(board[0].balance).toBe(2)
  })
})
