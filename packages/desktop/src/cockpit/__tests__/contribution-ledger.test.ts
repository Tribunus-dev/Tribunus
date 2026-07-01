/**
 * ContributionLedger — Unit Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createLedgerEntry,
  acceptEntry,
  getEntriesByContributor,
  getSessionSummary,
  type ContributionLedgerEntry,
} from "../contribution-ledger"

/* ── createLedgerEntry ──────────────────────────────────── */

describe("createLedgerEntry", () => {
  test("creates an entry with pending acceptance", () => {
    const entry = createLedgerEntry("s1", "alice", "computation", "Ran inference task")
    expect(entry.sessionId).toBe("s1")
    expect(entry.contributorId).toBe("alice")
    expect(entry.contributionClass).toBe("computation")
    expect(entry.description).toBe("Ran inference task")
    expect(entry.acceptedAt).toBeNull()
    expect(entry.acceptedBy).toBeNull()
    expect(entry.receiptDigests).toEqual([])
  })
})

/* ── acceptEntry ────────────────────────────────────────── */

describe("acceptEntry", () => {
  test("accepts a pending entry", () => {
    const entry = createLedgerEntry("s1", "alice", "computation", "Did work")
    const accepted = acceptEntry(entry, "reviewer1")
    expect(accepted.acceptedAt).toBeTruthy()
    expect(accepted.acceptedBy).toBe("reviewer1")
  })

  test("throws when accepting an already accepted entry", () => {
    const entry = createLedgerEntry("s1", "alice", "computation", "Did work")
    const accepted = acceptEntry(entry, "r1")
    expect(() => acceptEntry(accepted, "r2")).toThrow("already accepted")
  })
})

/* ── getEntriesByContributor ────────────────────────────── */

describe("getEntriesByContributor", () => {
  test("filters entries by contributor", () => {
    const entries: ContributionLedgerEntry[] = [
      createLedgerEntry("s1", "alice", "compute", "A"),
      createLedgerEntry("s1", "bob", "curation", "B"),
      createLedgerEntry("s1", "alice", "compute", "C"),
    ]
    const alice = getEntriesByContributor(entries, "alice")
    expect(alice).toHaveLength(2)
    expect(alice.every((e) => e.contributorId === "alice")).toBeTrue()
  })

  test("returns empty for unknown contributor", () => {
    const entries = [createLedgerEntry("s1", "alice", "compute", "A")]
    expect(getEntriesByContributor(entries, "nobody")).toHaveLength(0)
  })
})

/* ── getSessionSummary ──────────────────────────────────── */

describe("getSessionSummary", () => {
  test("summarizes an empty ledger", () => {
    const summary = getSessionSummary([])
    expect(summary.totalContributors).toBe(0)
    expect(summary.totalAccepted).toBe(0)
    expect(summary.byClass).toEqual({})
  })

  test("counts contributors, accepted, and classes", () => {
    const entries: ContributionLedgerEntry[] = [
      createLedgerEntry("s1", "alice", "compute", "A"),
      createLedgerEntry("s1", "bob", "curation", "B"),
      createLedgerEntry("s1", "alice", "compute", "C"),
      { ...createLedgerEntry("s1", "carol", "compute", "D"), acceptedAt: "x", acceptedBy: "r1" },
    ]

    const summary = getSessionSummary(entries)

    expect(summary.totalContributors).toBe(3)
    expect(summary.totalAccepted).toBe(1)
    expect(summary.byClass).toEqual({
      compute: 3,
      curation: 1,
    })
  })
})
