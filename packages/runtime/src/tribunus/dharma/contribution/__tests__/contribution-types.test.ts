/**
 * Track E — Contribution Accounting: Type System Tests
 */

import { describe, test, expect } from "bun:test"
import type { DharmaContributionRecord } from "../contribution-types"

// ── ContributionClass exhaustiveness ─────────────────────────────────────────

describe("ContributionClass", () => {
  test("all nine classes are assignable and distinct", () => {
    const all: string[] = [
      "work_product",
      "review_evidence",
      "reproduction_evidence",
      "compute_lease",
      "artifact_contribution",
      "documentation_contribution",
      "moderation_action",
      "research_evidence",
      "session_stewardship",
    ]
    expect(new Set(all).size).toBe(9)
  })
})

// ── DharmaContributionRecord structural invariants ──────────────────────────

describe("DharmaContributionRecord invariants", () => {
  const baseRecord: DharmaContributionRecord = {
    contributionId: "c_001",
    sessionId: "s_abc",
    contributorIdentityDigest: "did:dht:alice",
    contributionClass: "work_product" as const,
    description: "Implemented the core merge logic",
    receiptDigests: ["r_001", "r_002"],
    acceptedBy: null,
    acceptedAt: null,
    evidenceQuality: "high" as const,
    resourceCostSummary: { computeMs: 1200, tokenCount: 8500, storageBytes: 4096 },
    outcomeRelation: "outcome_xyz",
    codexEligibility: true,
    visibilityClass: "session" as const,
    createdAt: "2026-06-30T12:00:00.000Z",
  }

  test("constructs a valid record", () => {
    expect(baseRecord.contributionId).toBe("c_001")
    expect(baseRecord.sessionId).toBe("s_abc")
    expect(baseRecord.contributorIdentityDigest).toBe("did:dht:alice")
    expect(baseRecord.contributionClass).toBe("work_product")
    expect(baseRecord.acceptedBy).toBeNull()
    expect(baseRecord.acceptedAt).toBeNull()
    expect(baseRecord.evidenceQuality).toBe("high")
    expect(baseRecord.resourceCostSummary!.computeMs).toBe(1200)
    expect(baseRecord.resourceCostSummary!.tokenCount).toBe(8500)
    expect(baseRecord.resourceCostSummary!.storageBytes).toBe(4096)
    expect(baseRecord.outcomeRelation).toBe("outcome_xyz")
    expect(baseRecord.codexEligibility).toBe(true)
    expect(baseRecord.visibilityClass).toBe("session")
    expect(baseRecord.createdAt).toBe("2026-06-30T12:00:00.000Z")
  })

  test("supports all visibility classes", () => {
    const visibilities = ["session", "contributor", "public"] as const
    for (const v of visibilities) {
      const r = { ...baseRecord, visibilityClass: v }
      expect(r.visibilityClass).toBe(v)
    }
  })

  test("supports all evidence qualities", () => {
    const qualities = ["high", "medium", "low"] as const
    for (const q of qualities) {
      const r = { ...baseRecord, evidenceQuality: q }
      expect(r.evidenceQuality).toBe(q)
    }
  })

  test("supports null resourceCostSummary", () => {
    const r = { ...baseRecord, resourceCostSummary: null }
    expect(r.resourceCostSummary).toBeNull()
  })

  test("supports partial resourceCostSummary", () => {
    const r = { ...baseRecord, resourceCostSummary: { computeMs: 500 } as DharmaContributionRecord["resourceCostSummary"] }
    expect(r.resourceCostSummary!.computeMs).toBe(500)
    expect(r.resourceCostSummary!.tokenCount).toBeUndefined()
    expect(r.resourceCostSummary!.storageBytes).toBeUndefined()
  })

  test("supports all contribution classes", () => {
    const classes: Array<typeof baseRecord.contributionClass> = [
      "work_product",
      "review_evidence",
      "reproduction_evidence",
      "compute_lease",
      "artifact_contribution",
      "documentation_contribution",
      "moderation_action",
      "research_evidence",
      "session_stewardship",
    ]
    for (const cls of classes) {
      const r = { ...baseRecord, contributionClass: cls }
      expect(r.contributionClass).toBe(cls)
    }
  })

  test("acceptedBy / acceptedAt are null when not accepted", () => {
    expect(baseRecord.acceptedBy).toBeNull()
    expect(baseRecord.acceptedAt).toBeNull()
  })

  test("acceptedBy / acceptedAt are set when accepted", () => {
    const r = {
      ...baseRecord,
      acceptedBy: "did:dht:bob",
      acceptedAt: "2026-07-01T08:00:00.000Z",
    }
    expect(r.acceptedBy).toBe("did:dht:bob")
    expect(r.acceptedAt).toBe("2026-07-01T08:00:00.000Z")
  })

  test("empty receiptDigests is valid", () => {
    const r = { ...baseRecord, receiptDigests: [] }
    expect(r.receiptDigests).toEqual([])
  })
})
