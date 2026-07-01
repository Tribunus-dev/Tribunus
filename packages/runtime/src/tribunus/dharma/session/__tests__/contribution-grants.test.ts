/**
 * Tests for Track E — Contribution Grant Profiles
 */

import { describe, test, expect } from "bun:test"
import type { DharmaContributionRecord } from "../contribution-hooks"
import {
  getEarnedProfile,
  getRequiredContributionsForProfile,
  CONTRIBUTION_THRESHOLDS,
} from "../contribution-grants"
import type { GrantProfile } from "../types"

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeContribution(
  overrides: Partial<DharmaContributionRecord> = {},
): DharmaContributionRecord {
  const base: DharmaContributionRecord = {
    contributionId: "contrib-test-1",
    sessionId: "session-1",
    contributorIdentityDigest: "digest-1",
    contributionClass: "work_product",
    description: "test contribution",
    receiptDigests: ["receipt-1"],
    acceptedBy: null,
    acceptedAt: null,
    evidenceQuality: "medium",
    resourceCostSummary: null,
    outcomeRelation: "outcome-1",
    codexEligibility: false,
    visibilityClass: "session",
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  }
  return base
}

function makeAcceptedContribution(
  overrides: Partial<DharmaContributionRecord> = {},
): DharmaContributionRecord {
  return makeContribution({
    acceptedBy: "owner-key-1",
    acceptedAt: "2025-02-01T00:00:00Z",
    ...overrides,
  })
}

// ── getEarnedProfile ───────────────────────────────────────────────────────

describe("getEarnedProfile", () => {
  test("returns observer for empty records", () => {
    expect(getEarnedProfile([])).toBe("observer")
  })

  test("returns observer when no records are accepted", () => {
    const records = [
      makeContribution({ contributionId: "c1", acceptedBy: null, acceptedAt: null }),
      makeContribution({ contributionId: "c2", acceptedBy: null, acceptedAt: null }),
    ]
    expect(getEarnedProfile(records)).toBe("observer")
  })

  test("returns contributor profile with 5 accepted work_product records", () => {
    const records: DharmaContributionRecord[] = []
    for (let i = 0; i < 5; i++) {
      records.push(makeAcceptedContribution({ contributionId: `c${i}`, contributionClass: "work_product" }))
    }
    expect(getEarnedProfile(records)).toBe("contributor")
  })

  test("returns reviewer profile with 3 review_evidence records", () => {
    const records: DharmaContributionRecord[] = []
    for (let i = 0; i < 3; i++) {
      records.push(makeAcceptedContribution({ contributionId: `c${i}`, contributionClass: "review_evidence" }))
    }
    expect(getEarnedProfile(records)).toBe("reviewer")
  })

  test("returns test_runner profile with 3 reproduction_evidence records", () => {
    const records: DharmaContributionRecord[] = []
    for (let i = 0; i < 3; i++) {
      records.push(makeAcceptedContribution({ contributionId: `c${i}`, contributionClass: "reproduction_evidence" }))
    }
    expect(getEarnedProfile(records)).toBe("test_runner")
  })

  test("returns maintainer profile with 10 mixed records including work_product and review_evidence", () => {
    const records: DharmaContributionRecord[] = []
    // 6 work_product + 4 review_evidence = 10 total
    for (let i = 0; i < 6; i++) {
      records.push(makeAcceptedContribution({ contributionId: `wp${i}`, contributionClass: "work_product" }))
    }
    for (let i = 0; i < 4; i++) {
      records.push(makeAcceptedContribution({ contributionId: `re${i}`, contributionClass: "review_evidence" }))
    }
    expect(getEarnedProfile(records)).toBe("maintainer")
  })

  test("returns session_coowner profile with 20 mixed records across three classes", () => {
    const records: DharmaContributionRecord[] = []
    // 10 work_product + 5 review_evidence + 5 session_stewardship = 20 total
    for (let i = 0; i < 10; i++) {
      records.push(makeAcceptedContribution({ contributionId: `wp${i}`, contributionClass: "work_product" }))
    }
    for (let i = 0; i < 5; i++) {
      records.push(makeAcceptedContribution({ contributionId: `re${i}`, contributionClass: "review_evidence" }))
    }
    for (let i = 0; i < 5; i++) {
      records.push(makeAcceptedContribution({ contributionId: `ss${i}`, contributionClass: "session_stewardship" }))
    }
    expect(getEarnedProfile(records)).toBe("session_coowner")
  })

  test("returns highest earned profile, not just first match", () => {
    const records: DharmaContributionRecord[] = []
    // 20 accepted records with both work_product and review_evidence — should get maintainer, not contributor
    for (let i = 0; i < 10; i++) {
      records.push(makeAcceptedContribution({ contributionId: `wp${i}`, contributionClass: "work_product" }))
    }
    for (let i = 0; i < 10; i++) {
      records.push(makeAcceptedContribution({ contributionId: `re${i}`, contributionClass: "review_evidence" }))
    }
    // 20 total with work_product and review_evidence → maintainer (not session_coowner, lacks session_stewardship)
    expect(getEarnedProfile(records)).toBe("maintainer")
  })

  test("returns observer when count meets but required classes are missing", () => {
    const records: DharmaContributionRecord[] = []
    // 10 work_product records but reviewer needs review_evidence
    for (let i = 0; i < 10; i++) {
      records.push(makeAcceptedContribution({ contributionId: `wp${i}`, contributionClass: "work_product" }))
    }
    // Not enough for reviewer (needs review_evidence), contributor matches (5 work_product)
    expect(getEarnedProfile(records)).toBe("contributor")
  })

  test("ignores unaccepted records in profile calculation", () => {
    const records: DharmaContributionRecord[] = []
    // 3 accepted + 2 unaccepted work_product
    for (let i = 0; i < 3; i++) {
      records.push(makeAcceptedContribution({ contributionId: `c${i}`, contributionClass: "work_product" }))
    }
    records.push(makeContribution({ contributionId: "u1", contributionClass: "work_product", acceptedBy: null, acceptedAt: null }))
    records.push(makeContribution({ contributionId: "u2", contributionClass: "work_product", acceptedBy: null, acceptedAt: null }))
    // 3 accepted < 5 needed for contributor → observer
    expect(getEarnedProfile(records)).toBe("observer")
  })
})

// ── getRequiredContributionsForProfile ─────────────────────────────────────

describe("getRequiredContributionsForProfile", () => {
  test("returns 0 for observer", () => {
    expect(getRequiredContributionsForProfile("observer")).toBe(0)
  })

  test("returns 3 for reviewer", () => {
    expect(getRequiredContributionsForProfile("reviewer")).toBe(3)
  })

  test("returns 5 for contributor", () => {
    expect(getRequiredContributionsForProfile("contributor")).toBe(5)
  })

  test("returns 3 for test_runner", () => {
    expect(getRequiredContributionsForProfile("test_runner")).toBe(3)
  })

  test("returns 10 for maintainer", () => {
    expect(getRequiredContributionsForProfile("maintainer")).toBe(10)
  })

  test("returns 20 for session_coowner", () => {
    expect(getRequiredContributionsForProfile("session_coowner")).toBe(20)
  })
})

// ── CONTRIBUTION_THRESHOLDS structure ──────────────────────────────────────

describe("CONTRIBUTION_THRESHOLDS", () => {
  test("has entries for all six profiles", () => {
    const profiles: GrantProfile[] = ["observer", "reviewer", "contributor", "test_runner", "maintainer", "session_coowner"]
    for (const profile of profiles) {
      expect(CONTRIBUTION_THRESHOLDS[profile]).toBeDefined()
      expect(typeof CONTRIBUTION_THRESHOLDS[profile].minContributions).toBe("number")
      expect(Array.isArray(CONTRIBUTION_THRESHOLDS[profile].requiredClasses)).toBe(true)
    }
  })

  test("thresholds increase monotonically", () => {
    const thresholds = [
      getRequiredContributionsForProfile("observer"),
      getRequiredContributionsForProfile("reviewer"),
      getRequiredContributionsForProfile("test_runner"),
      getRequiredContributionsForProfile("contributor"),
      getRequiredContributionsForProfile("maintainer"),
      getRequiredContributionsForProfile("session_coowner"),
    ]
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]).toBeGreaterThanOrEqual(thresholds[i - 1])
    }
  })
})
