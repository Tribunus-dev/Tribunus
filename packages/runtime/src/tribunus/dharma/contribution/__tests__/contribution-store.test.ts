/**
 * Track E — Contribution Accounting: In-Memory Store Tests
 */

import { describe, test, expect } from "bun:test"
import {
  createContributionStore,
  addContribution,
  getContribution,
  getContributionsBySession,
  getContributionsByContributor,
  acceptContribution,
  revokeContribution,
  getSessionSummary,
} from "../contribution-store"
import type { DharmaContributionRecord, ContributionStore } from "../contribution-store"

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
    createdAt: "2026-06-30T12:00:00.000Z",
    ...overrides,
  }
}

// ── Store Creation ───────────────────────────────────────────────────────────

describe("createContributionStore", () => {
  test("creates an empty store", () => {
    const store = createContributionStore()
    expect(store.records.size).toBe(0)
  })
})

// ── addContribution / getContribution ────────────────────────────────────────

describe("addContribution", () => {
  test("adds a record and getContribution retrieves it", () => {
    const store = createContributionStore()
    const record = makeRecord()
    const updated = addContribution(store, record)
    expect(getContribution(updated, "c_001")).toEqual(record)
  })

  test("returns a new store without mutating the original", () => {
    const store = createContributionStore()
    const record = makeRecord()
    addContribution(store, record)
    expect(store.records.size).toBe(0)
  })
})

describe("getContribution", () => {
  test("returns undefined for unknown id", () => {
    const store = createContributionStore()
    expect(getContribution(store, "nonexistent")).toBeUndefined()
  })
})

// ── getContributionsBySession ────────────────────────────────────────────────

describe("getContributionsBySession", () => {
  test("returns empty for session with no contributions", () => {
    const store = createContributionStore()
    expect(getContributionsBySession(store, "s_none")).toEqual([])
  })

  test("returns only contributions for the specified session", () => {
    let store = createContributionStore()
    store = addContribution(store, makeRecord({ contributionId: "c_001", sessionId: "s_abc" }))
    store = addContribution(store, makeRecord({ contributionId: "c_002", sessionId: "s_abc" }))
    store = addContribution(store, makeRecord({ contributionId: "c_003", sessionId: "s_xyz" }))

    const sessionResults = getContributionsBySession(store, "s_abc")
    expect(sessionResults.length).toBe(2)
    expect(sessionResults.map((r) => r.contributionId).sort()).toEqual(["c_001", "c_002"])
  })
})

// ── getContributionsByContributor ────────────────────────────────────────────

describe("getContributionsByContributor", () => {
  test("returns empty for unknown contributor", () => {
    const store = createContributionStore()
    expect(getContributionsByContributor(store, "did:dht:unknown")).toEqual([])
  })

  test("returns only contributions by the specified contributor", () => {
    let store = createContributionStore()
    store = addContribution(store, makeRecord({ contributionId: "c_001", contributorIdentityDigest: "did:dht:alice" }))
    store = addContribution(store, makeRecord({ contributionId: "c_002", contributorIdentityDigest: "did:dht:alice" }))
    store = addContribution(store, makeRecord({ contributionId: "c_003", contributorIdentityDigest: "did:dht:bob" }))

    const aliceResults = getContributionsByContributor(store, "did:dht:alice")
    expect(aliceResults.length).toBe(2)
    expect(aliceResults.map((r) => r.contributionId).sort()).toEqual(["c_001", "c_002"])
  })
})

// ── acceptContribution ───────────────────────────────────────────────────────

describe("acceptContribution", () => {
  test("sets acceptedBy and acceptedAt", () => {
    let store = createContributionStore()
    store = addContribution(store, makeRecord())
    const updated = acceptContribution(store, "c_001", "did:dht:bob")
    expect(updated).toBeDefined()
    expect(updated!.acceptedBy).toBe("did:dht:bob")
    expect(updated!.acceptedAt).toBeDefined()
    expect(typeof updated!.acceptedAt).toBe("string")
  })

  test("returns undefined for unknown id", () => {
    const store = createContributionStore()
    expect(acceptContribution(store, "nonexistent", "did:dht:bob")).toBeUndefined()
  })

  test("does not mutate the original record in the store", () => {
    let store = createContributionStore()
    store = addContribution(store, makeRecord())
    const originalRecord = getContribution(store, "c_001")
    acceptContribution(store, "c_001", "did:dht:bob")
    // The store's record should still be the original (unaccepted)
    expect(getContribution(store, "c_001")!.acceptedBy).toBeNull()
  })
})

// ── revokeContribution ───────────────────────────────────────────────────────

describe("revokeContribution", () => {
  test("clears acceptedBy, acceptedAt, and codexEligibility", () => {
    let store = createContributionStore()
    store = addContribution(store, makeRecord({
      acceptedBy: "did:dht:bob",
      acceptedAt: "2026-07-01T08:00:00.000Z",
      codexEligibility: true,
    }))
    const revoked = revokeContribution(store, "c_001")
    expect(revoked).toBeDefined()
    expect(revoked!.acceptedBy).toBeNull()
    expect(revoked!.acceptedAt).toBeNull()
    expect(revoked!.codexEligibility).toBe(false)
  })

  test("returns undefined for unknown id", () => {
    const store = createContributionStore()
    expect(revokeContribution(store, "nonexistent")).toBeUndefined()
  })
})

// ── getSessionSummary ────────────────────────────────────────────────────────

describe("getSessionSummary", () => {
  test("returns zero counts for session with no contributions", () => {
    const store = createContributionStore()
    const summary = getSessionSummary(store, "s_abc")
    expect(summary.contributorCount).toBe(0)
    expect(summary.acceptedCount).toBe(0)
    expect(summary.pendingCount).toBe(0)
    expect(summary.computeMsTotal).toBe(0)
    expect(summary.codexEligibleCount).toBe(0)
  })

  test("correctly aggregates contributions", () => {
    let store = createContributionStore()

    // Alice — 2 accepted, 1 pending
    store = addContribution(store, makeRecord({
      contributionId: "c_001",
      sessionId: "s_abc",
      contributorIdentityDigest: "did:dht:alice",
      contributionClass: "work_product",
      acceptedBy: "did:dht:bob",
      acceptedAt: "2026-07-01T08:00:00.000Z",
      resourceCostSummary: { computeMs: 100 },
      codexEligibility: true,
    }))
    store = addContribution(store, makeRecord({
      contributionId: "c_002",
      sessionId: "s_abc",
      contributorIdentityDigest: "did:dht:alice",
      contributionClass: "review_evidence",
      acceptedBy: "did:dht:bob",
      acceptedAt: "2026-07-01T09:00:00.000Z",
      resourceCostSummary: { computeMs: 200 },
      codexEligibility: true,
    }))
    store = addContribution(store, makeRecord({
      contributionId: "c_003",
      sessionId: "s_abc",
      contributorIdentityDigest: "did:dht:alice",
      contributionClass: "work_product",
      acceptedBy: null,
      acceptedAt: null,
      resourceCostSummary: null,
      codexEligibility: false,
    }))

    // Bob — 1 accepted
    store = addContribution(store, makeRecord({
      contributionId: "c_004",
      sessionId: "s_abc",
      contributorIdentityDigest: "did:dht:bob",
      contributionClass: "documentation_contribution",
      acceptedBy: "did:dht:alice",
      acceptedAt: "2026-07-01T10:00:00.000Z",
      resourceCostSummary: { computeMs: 50 },
      codexEligibility: true,
    }))

    const summary = getSessionSummary(store, "s_abc")

    expect(summary.sessionId).toBe("s_abc")
    expect(summary.contributorCount).toBe(2)
    expect(summary.acceptedCount).toBe(3)
    expect(summary.pendingCount).toBe(1)
    expect(summary.byClass["work_product"]).toBe(2)
    expect(summary.byClass["review_evidence"]).toBe(1)
    expect(summary.byClass["documentation_contribution"]).toBe(1)
    expect(summary.computeMsTotal).toBe(350)
    expect(summary.codexEligibleCount).toBe(3)
  })

  test("only includes computeMs from records with resourceCostSummary", () => {
    let store = createContributionStore()
    store = addContribution(store, makeRecord({
      contributionId: "c_001",
      sessionId: "s_abc",
      acceptedBy: "did:dht:bob",
      acceptedAt: "2026-07-01T00:00:00.000Z",
      resourceCostSummary: null,
    }))
    const summary = getSessionSummary(store, "s_abc")
    expect(summary.computeMsTotal).toBe(0)
  })
})
