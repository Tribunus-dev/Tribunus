/**
 * Track E — Contribution Accounting: Policy & Abuse Control Tests
 */

import { describe, test, expect } from "bun:test"
import {
  createDefaultContributionPolicy,
  createRestrictivePolicy,
  isClassEnabled,
  isContributionEligible,
  isCodexEligible,
  checkNoSelfDealing,
  checkNoFabricatedWork,
  checkNoDuplicateReceipt,
  checkNoComputeDominance,
  runAbuseChecks,
} from "../contribution-policy"
import type { DharmaContributionRecord } from "../contribution-types"

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<DharmaContributionRecord> = {}): DharmaContributionRecord {
  return {
    contributionId: "c_001",
    sessionId: "s_abc",
    contributorIdentityDigest: "did:dht:alice",
    contributionClass: "work_product",
    description: "Test contribution",
    receiptDigests: ["r_001"],
    acceptedBy: null,
    acceptedAt: null,
    evidenceQuality: "high",
    resourceCostSummary: { computeMs: 500 },
    outcomeRelation: "out_001",
    codexEligibility: true,
    visibilityClass: "session",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Policy Creation ──────────────────────────────────────────────────────────

describe("createDefaultContributionPolicy", () => {
  test("enables all nine contribution classes", () => {
    const policy = createDefaultContributionPolicy()
    expect(policy.enabledClasses.length).toBe(9)
    expect(policy.enabledClasses).toContain("work_product")
    expect(policy.enabledClasses).toContain("session_stewardship")
  })

  test("sets sensible defaults", () => {
    const policy = createDefaultContributionPolicy()
    expect(policy.maxContributionAgeDays).toBe(90)
    expect(policy.minEvidenceQuality).toBe("low")
    expect(policy.allowSelfApproval).toBe(false)
    expect(policy.maxPendingPerSession).toBe(50)
    expect(policy.requireAcceptedForCodexEligibility).toBe(true)
  })
})

describe("createRestrictivePolicy", () => {
  test("enables only four contribution classes", () => {
    const policy = createRestrictivePolicy()
    expect(policy.enabledClasses.length).toBe(4)
    expect(policy.enabledClasses).toContain("work_product")
    expect(policy.enabledClasses).toContain("artifact_contribution")
    expect(policy.enabledClasses).not.toContain("compute_lease")
  })

  test("sets restrictive defaults", () => {
    const policy = createRestrictivePolicy()
    expect(policy.maxContributionAgeDays).toBe(30)
    expect(policy.minEvidenceQuality).toBe("medium")
    expect(policy.maxPendingPerSession).toBe(10)
  })
})

// ── isClassEnabled ───────────────────────────────────────────────────────────

describe("isClassEnabled", () => {
  test("returns true for an enabled class", () => {
    const policy = createDefaultContributionPolicy()
    expect(isClassEnabled(policy, "work_product")).toBe(true)
  })

  test("returns false for a disabled class in restrictive policy", () => {
    const policy = createRestrictivePolicy()
    expect(isClassEnabled(policy, "compute_lease")).toBe(false)
  })
})

// ── isContributionEligible ───────────────────────────────────────────────────

describe("isContributionEligible", () => {
  const policy = createDefaultContributionPolicy()

  test("passes a fresh, enabled, accepted record", () => {
    const record = makeRecord({ acceptedBy: "did:dht:bob", acceptedAt: new Date().toISOString() })
    expect(isContributionEligible(record, policy)).toBe(true)
  })

  test("fails when class is disabled", () => {
    const restricted = createRestrictivePolicy()
    const record = makeRecord({ contributionClass: "compute_lease" })
    expect(isContributionEligible(record, restricted)).toBe(false)
  })

  test("fails when evidence quality is below minimum", () => {
    const restricted = createRestrictivePolicy()
    const record = makeRecord({ evidenceQuality: "low" })
    expect(isContributionEligible(record, restricted)).toBe(false)
  })

  test("fails when policy requires acceptance but record is not accepted", () => {
    const record = makeRecord({ acceptedBy: null })
    expect(isContributionEligible(record, policy)).toBe(false)
  })

  test("passes without acceptance when requireAcceptedForCodexEligibility is false", () => {
    const permissivePolicy = { ...policy, requireAcceptedForCodexEligibility: false }
    const record = makeRecord({ acceptedBy: null })
    expect(isContributionEligible(record, permissivePolicy)).toBe(true)
  })

  test("fails when contribution is too old", () => {
    const oldRecord = makeRecord({
      createdAt: "2020-01-01T00:00:00.000Z",
      acceptedBy: "did:dht:bob",
      acceptedAt: "2020-01-02T00:00:00.000Z",
    })
    expect(isContributionEligible(oldRecord, policy)).toBe(false)
  })
})

// ── isCodexEligible ──────────────────────────────────────────────────────────

describe("isCodexEligible", () => {
  const policy = createDefaultContributionPolicy()

  test("returns true when record is eligible and codexEligibility is true", () => {
    const record = makeRecord({ acceptedBy: "did:dht:bob", acceptedAt: new Date().toISOString() })
    expect(isCodexEligible(record, policy)).toBe(true)
  })

  test("returns false when record.codexEligibility is false", () => {
    const record = makeRecord({ codexEligibility: false, acceptedBy: "did:dht:bob", acceptedAt: new Date().toISOString() })
    expect(isCodexEligible(record, policy)).toBe(false)
  })

  test("returns false when record fails isContributionEligible", () => {
    const record = makeRecord({ evidenceQuality: "low", acceptedBy: "did:dht:bob", acceptedAt: new Date().toISOString() })
    const restricted = createRestrictivePolicy()
    expect(isCodexEligible(record, restricted)).toBe(false)
  })
})

// ── Abuse: checkNoSelfDealing ────────────────────────────────────────────────

describe("checkNoSelfDealing", () => {
  test("passes when reviewer is different from contributor", () => {
    const record = makeRecord()
    const result = checkNoSelfDealing(record, "did:dht:bob")
    expect(result.passed).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("fails when reviewer is the contributor", () => {
    const record = makeRecord()
    const result = checkNoSelfDealing(record, "did:dht:alice")
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("same identity")
  })
})

// ── Abuse: checkNoFabricatedWork ─────────────────────────────────────────────

describe("checkNoFabricatedWork", () => {
  test("passes when record has receipt digests", () => {
    const record = makeRecord({ receiptDigests: ["r_001"] })
    expect(checkNoFabricatedWork(record).passed).toBe(true)
  })

  test("passes when quality is low with no receipts", () => {
    const record = makeRecord({ receiptDigests: [], evidenceQuality: "low" })
    expect(checkNoFabricatedWork(record).passed).toBe(true)
  })

  test("fails when no receipts but medium quality", () => {
    const record = makeRecord({ receiptDigests: [], evidenceQuality: "medium" })
    const result = checkNoFabricatedWork(record)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("zero evidence receipts")
  })

  test("fails when no receipts but high quality", () => {
    const record = makeRecord({ receiptDigests: [], evidenceQuality: "high" })
    const result = checkNoFabricatedWork(record)
    expect(result.passed).toBe(false)
  })
})

// ── Abuse: checkNoDuplicateReceipt ───────────────────────────────────────────

describe("checkNoDuplicateReceipt", () => {
  test("passes when receipt digests are unique", () => {
    const record = makeRecord({ receiptDigests: ["r_003"] })
    const existing = [
      makeRecord({ contributionId: "c_002", receiptDigests: ["r_001"] }),
      makeRecord({ contributionId: "c_003", receiptDigests: ["r_002"] }),
    ]
    expect(checkNoDuplicateReceipt(record, existing).passed).toBe(true)
  })

  test("fails when a receipt digest already exists", () => {
    const record = makeRecord({ receiptDigests: ["r_001"] })
    const existing = [
      makeRecord({ contributionId: "c_002", receiptDigests: ["r_001"] }),
    ]
    const result = checkNoDuplicateReceipt(record, existing)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("already used")
  })

  test("ignores self when checking duplicates", () => {
    const record = makeRecord({ contributionId: "c_001", receiptDigests: ["r_001"] })
    const existing = [record]
    expect(checkNoDuplicateReceipt(record, existing).passed).toBe(true)
  })

  test("checks all digests in the record", () => {
    const record = makeRecord({ receiptDigests: ["r_001", "r_005"] })
    const existing = [
      makeRecord({ contributionId: "c_002", receiptDigests: ["r_001"] }),
    ]
    expect(checkNoDuplicateReceipt(record, existing).passed).toBe(false)
  })
})

// ── Abuse: checkNoComputeDominance ───────────────────────────────────────────

describe("checkNoComputeDominance", () => {
  test("passes for empty record list", () => {
    expect(checkNoComputeDominance([]).passed).toBe(true)
  })

  test("passes when no contributor exceeds 80%", () => {
    const records = [
      makeRecord({ contributionId: "c_001", contributorIdentityDigest: "did:dht:alice" }),
      makeRecord({ contributionId: "c_002", contributorIdentityDigest: "did:dht:bob" }),
    ]
    expect(checkNoComputeDominance(records).passed).toBe(true)
  })

  test("fails when a single contributor accounts for >80%", () => {
    const records = [
      makeRecord({ contributionId: "c_001", contributorIdentityDigest: "did:dht:alice" }),  // 5
      makeRecord({ contributionId: "c_002", contributorIdentityDigest: "did:dht:alice" }),  // 5
      makeRecord({ contributionId: "c_003", contributorIdentityDigest: "did:dht:alice" }),  // 5
      makeRecord({ contributionId: "c_004", contributorIdentityDigest: "did:dht:alice" }),  // 5
      makeRecord({ contributionId: "c_005", contributorIdentityDigest: "did:dht:alice" }),  // 5
      makeRecord({ contributionId: "c_006", contributorIdentityDigest: "did:dht:bob" }),    // 1
    ]
    const result = checkNoComputeDominance(records)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain(">80%")
  })
})

// ── Abuse: runAbuseChecks ────────────────────────────────────────────────────

describe("runAbuseChecks", () => {
  test("returns all four check results", () => {
    const record = makeRecord()
    const existing = [
      makeRecord({ contributionId: "c_002", contributorIdentityDigest: "did:dht:bob", receiptDigests: ["r_099"] }),
    ]
    const results = runAbuseChecks(record, existing, "did:dht:bob")
    expect(results.length).toBe(4)
  })

  test("check names match expected values", () => {
    const record = makeRecord()
    const existing: DharmaContributionRecord[] = []
    const results = runAbuseChecks(record, existing, "did:dht:bob")
    expect(results.map((r) => r.checkName).sort()).toEqual([
      "no_compute_dominance",
      "no_duplicate_receipt",
      "no_fabricated_work",
      "no_self_dealing",
    ])
  })

  test("detects self-dealing", () => {
    const record = makeRecord()
    const existing: DharmaContributionRecord[] = []
    const results = runAbuseChecks(record, existing, "did:dht:alice")
    const selfDeal = results.find((r) => r.checkName === "no_self_dealing")
    expect(selfDeal?.passed).toBe(false)
  })
})
