/**
 * Codex Benefit Accounting — Tests
 *
 * Covers: createBenefitEvent, getAllocationShares, computeAllocations,
 * validateAllocations, BenefitStore operations, getTotalAllocation aggregation.
 */

import { describe, test, expect } from "bun:test"
import { createBenefitPolicy, createCodexEntry } from "../codex-types"
import type {
  CodexEntry,
  BenefitPolicy,
  BenefitAllocation,
  KnowledgeClass,
  CodexVisibilityClass,
  CodexClaim,
} from "../codex-types"
import {
  createBenefitEvent,
  getAllocationShares,
  computeAllocations,
  validateAllocations,
  createBenefitStore,
  recordBenefitEvent,
  getContributorBenefits,
  getEntryBenefits,
  getTotalAllocation,
  addPolicy,
  BENEFIT_KINDS,
} from "../codex-benefits"

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<CodexEntry> = {}): CodexEntry {
  const claim: CodexClaim = {
    claimId: "clm_001",
    statement: "Test claim",
    claimType: "fact",
    supportRefs: [],
    scope: {
      hardwareTargets: [],
      softwareVersions: [],
      modelFamilies: [],
      contextNotes: [],
    },
    confidence: 0.9,
  }

   return {
     ...createCodexEntry(
    "entry_001",
    "Test Entry",
    "performance_evidence" as KnowledgeClass,
    "public" as CodexVisibilityClass,
    [claim],
     ),
     ...overrides,
}
}

function makePolicy(policyId: string): BenefitPolicy {
  return createBenefitPolicy(policyId)
}

// ── BENEFIT_KINDS ───────────────────────────────────────────────────────────

describe("BENEFIT_KINDS", () => {
  test("has the four expected benefit kinds", () => {
    expect(BENEFIT_KINDS).toEqual([
      "citation",
      "reuse",
      "independent_reproduction",
      "maintenance",
    ])
  })

  test("is a const tuple (readonly)", () => {
    const kinds: readonly string[] = BENEFIT_KINDS
    expect(kinds.length).toBe(4)
  })
})

// ── createBenefitEvent ──────────────────────────────────────────────────────

describe("createBenefitEvent", () => {
  test("creates a benefit event with allocations", () => {
    const entry = makeEntry()
    // Make entry look authored by alice
    entry.provenance.authoredBy = ["digest_alice"]
    const policy = makePolicy("pol_001")

    const event = createBenefitEvent(
      entry,
      "citation",
      "contrib_001",
      policy,
      ["digest_alice", "digest_bob"],
    )

    expect(event.eventId).toBeDefined()
    expect(event.eventId.length).toBeGreaterThan(0)
    expect(event.codexEntryId).toBe("entry_001")
    expect(event.benefitKind).toBe("citation")
    expect(event.sourceContributionId).toBe("contrib_001")
    expect(event.policyVersion).toBe("1.0.0")
    expect(event.recordedAt).toBeDefined()
    expect(typeof event.recordedAt).toBe("string")

    // Must have allocations
    expect(event.allocations.length).toBeGreaterThan(0)

    // Sum must be 1.0
    const sum = event.allocations.reduce((s, a) => s + a.share, 0)
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001)
  })

  test("assigns original_evidence role to entry authors", () => {
    const entry = makeEntry()
    entry.provenance.authoredBy = ["digest_alice", "digest_carol"]
    const policy = makePolicy("pol_001")

    const event = createBenefitEvent(
      entry,
      "reuse",
      "contrib_002",
      policy,
      ["digest_alice", "digest_bob", "digest_carol"],
    )

    // Alice and Carol should get allocations (authors get original_evidence)
    const aliceAlloc = event.allocations.find((a) => a.recipientIdentityDigest === "digest_alice")
    const carolAlloc = event.allocations.find((a) => a.recipientIdentityDigest === "digest_carol")
    const bobAlloc = event.allocations.find((a) => a.recipientIdentityDigest === "digest_bob")

    expect(aliceAlloc).toBeDefined()
    expect(carolAlloc).toBeDefined()
    expect(bobAlloc).toBeDefined()

    // Alice and Carol have original_evidence kind, Bob gets synthesis (reuse → synthesis)
    expect(aliceAlloc!.kind).toBe("original_evidence")
    expect(carolAlloc!.kind).toBe("original_evidence")
    expect(bobAlloc!.kind).toBe("synthesis")
  })

  test("works with single contributor and each benefit kind", () => {
    const entry = makeEntry()
    entry.provenance.authoredBy = ["digest_alice"]
    const policy = makePolicy("pol_001")
    const kinds = ["citation", "reuse", "independent_reproduction", "maintenance"] as const

    for (const kind of kinds) {
      const event = createBenefitEvent(entry, kind, "contrib_001", policy, ["digest_alice"])
      expect(event.benefitKind).toBe(kind)
      const sum = event.allocations.reduce((s, a) => s + a.share, 0)
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001)
    }
  })
})

// ── getAllocationShares ────────────────────────────────────────────────────

describe("getAllocationShares", () => {
  test("returns the policy's allocation shares", () => {
    const policy = makePolicy("pol_001")
    const shares = getAllocationShares(policy, "citation")

    expect(shares.original_evidence).toBe(0.4)
    expect(shares.synthesis).toBe(0.15)
    expect(shares.review).toBe(0.2)
    expect(shares.reproduction).toBe(0.1)
    expect(shares.maintenance).toBe(0.15)
  })

  test("returns a copy, not a reference to the policy's object", () => {
    const policy = makePolicy("pol_001")
    const shares = getAllocationShares(policy, "citation")
    shares.original_evidence = 0.99
    expect(policy.allocationShares.original_evidence).toBe(0.4)
  })

  test("ignores benefitKind parameter (reserved for future)", () => {
    const policy = makePolicy("pol_001")
    const sharesA = getAllocationShares(policy, "citation")
    const sharesB = getAllocationShares(policy, "independent_reproduction")
    expect(sharesA).toEqual(sharesB)
  })
})

// ── computeAllocations ─────────────────────────────────────────────────────

describe("computeAllocations", () => {
  test("distributes single-role shares equally among claimants", () => {
    const policy = makePolicy("pol_001")

    const allocations = computeAllocations(policy, "citation", [
      { identityDigest: "alice", roles: ["original_evidence"] },
      { identityDigest: "bob", roles: ["original_evidence"] },
    ])

    // Two authors split original_evidence (0.4): 0.2 raw each
    // After normalization to sum=1.0: 0.5 each
    expect(allocations.length).toBe(2)
    for (const alloc of allocations) {
      expect(alloc.share).toBeCloseTo(0.5, 4)
    }
  })

  test("handles multiple roles per contributor", () => {
    const policy = makePolicy("pol_001")

    // Alice has both original_evidence and synthesis roles
    const allocations = computeAllocations(policy, "citation", [
      { identityDigest: "alice", roles: ["original_evidence", "synthesis"] },
    ])

    expect(allocations.length).toBe(1)
    // original_evidence (0.4) + synthesis (0.15) = 0.55, normalized to 1.0
    expect(allocations[0].share).toBeCloseTo(1.0, 4)
  })

  test("returns empty array for empty contributors", () => {
    const policy = makePolicy("pol_001")
    expect(computeAllocations(policy, "citation", [])).toEqual([])
  })

  test("deduplicates identical roles for a single contributor", () => {
    const policy = makePolicy("pol_001")

    const allocations = computeAllocations(policy, "citation", [
      { identityDigest: "alice", roles: ["review", "review"] },
    ])

    expect(allocations.length).toBe(1)
    // review (0.2), normalized to 1.0
    expect(allocations[0].share).toBeCloseTo(1.0, 4)
  })

  test("distributes multi-role, multi-contributor scenario correctly", () => {
    const policy = makePolicy("pol_001")

    // Alice: original_evidence
    // Bob: synthesis, review
    // Carol: review
    // Dave: reproduction
    const allocations = computeAllocations(policy, "independent_reproduction", [
      { identityDigest: "alice", roles: ["original_evidence"] },
      { identityDigest: "bob", roles: ["synthesis", "review"] },
      { identityDigest: "carol", roles: ["review"] },
      { identityDigest: "dave", roles: ["reproduction"] },
    ])

    expect(allocations.length).toBe(4)

    // Alice: original_evidence (0.4) alone = 0.4
    // Bob: synthesis (0.15) alone + review (0.2 / 2 = 0.1) = 0.25
    // Carol: review (0.2 / 2 = 0.1) = 0.1
    // Dave: reproduction (0.1) alone = 0.1
    // Raw total = 0.4 + 0.25 + 0.1 + 0.1 = 0.85
    // Normalized: alice = 0.4/0.85 ≈ 0.4706, bob = 0.25/0.85 ≈ 0.2941,
    //             carol = 0.1/0.85 ≈ 0.1176, dave = 0.1/0.85 ≈ 0.1176

    const allocMap = new Map(allocations.map((a) => [a.recipientIdentityDigest, a]))

    expect(allocMap.get("alice")!.share).toBeCloseTo(0.4 / 0.85, 4)
    expect(allocMap.get("bob")!.share).toBeCloseTo(0.25 / 0.85, 4)
    expect(allocMap.get("carol")!.share).toBeCloseTo(0.1 / 0.85, 4)
    expect(allocMap.get("dave")!.share).toBeCloseTo(0.1 / 0.85, 4)

    // Sum of normalized shares = 1.0
    const sum = allocations.reduce((s, a) => s + a.share, 0)
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001)
  })

  test("sorts allocations deterministically by identityDigest", () => {
    const policy = makePolicy("pol_001")

    const allocations = computeAllocations(policy, "citation", [
      { identityDigest: "zoe", roles: ["original_evidence"] },
      { identityDigest: "alice", roles: ["original_evidence"] },
    ])

    expect(allocations[0].recipientIdentityDigest).toBe("alice")
    expect(allocations[1].recipientIdentityDigest).toBe("zoe")
  })
})

// ── validateAllocations ─────────────────────────────────────────────────────

describe("validateAllocations", () => {
  test("accepts valid allocations that sum to 1.0", () => {
    const allocs: BenefitAllocation[] = [
      { kind: "original_evidence", recipientIdentityDigest: "alice", share: 0.6 },
      { kind: "synthesis", recipientIdentityDigest: "bob", share: 0.4 },
    ]
    expect(validateAllocations(allocs)).toEqual({ valid: true, reason: null })
  })

  test("accepts allocations summing close to 1.0 (within epsilon)", () => {
    const allocs: BenefitAllocation[] = [
      { kind: "original_evidence", recipientIdentityDigest: "alice", share: 0.5004 },
      { kind: "review", recipientIdentityDigest: "bob", share: 0.4996 },
    ]
    expect(validateAllocations(allocs)).toEqual({ valid: true, reason: null })
  })

  test("rejects allocations summing to less than 0.999", () => {
    const allocs: BenefitAllocation[] = [
      { kind: "original_evidence", recipientIdentityDigest: "alice", share: 0.5 },
      { kind: "review", recipientIdentityDigest: "bob", share: 0.3 },
    ]
    const result = validateAllocations(allocs)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/deviates from 1\.0/)
  })

  test("rejects allocations summing to more than 1.001", () => {
    const allocs: BenefitAllocation[] = [
      { kind: "original_evidence", recipientIdentityDigest: "alice", share: 0.7 },
      { kind: "review", recipientIdentityDigest: "bob", share: 0.5 },
    ]
    const result = validateAllocations(allocs)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/deviates from 1\.0/)
  })

  test("rejects empty allocations array", () => {
    const result = validateAllocations([])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/empty/)
  })

  test("rejects negative share", () => {
    const allocs: BenefitAllocation[] = [
      { kind: "original_evidence", recipientIdentityDigest: "alice", share: -0.1 },
      { kind: "review", recipientIdentityDigest: "bob", share: 1.1 },
    ]
    const result = validateAllocations(allocs)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/out of/)
  })

  test("rejects share > 1", () => {
    const allocs: BenefitAllocation[] = [
      { kind: "original_evidence", recipientIdentityDigest: "alice", share: 1.5 },
    ]
    const result = validateAllocations(allocs)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/out of/)
  })

  test("rejects duplicate recipients", () => {
    const allocs: BenefitAllocation[] = [
      { kind: "original_evidence", recipientIdentityDigest: "alice", share: 0.5 },
      { kind: "review", recipientIdentityDigest: "alice", share: 0.5 },
    ]
    const result = validateAllocations(allocs)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/duplicate/i)
  })

  test("rejects NaN share", () => {
    const allocs: BenefitAllocation[] = [
      { kind: "original_evidence", recipientIdentityDigest: "alice", share: NaN },
    ]
    const result = validateAllocations(allocs)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/finite/i)
  })
})

// ── BenefitStore ────────────────────────────────────────────────────────────

describe("BenefitStore", () => {
  test("createBenefitStore creates an empty store", () => {
    const store = createBenefitStore()
    expect(store.events.size).toBe(0)
    expect(store.policies.size).toBe(0)
  })

  test("recordBenefitEvent adds an event and returns a new store", () => {
    const store = createBenefitStore()
    const policy = makePolicy("pol_001")
    const entry = makeEntry()
    entry.provenance.authoredBy = ["digest_alice"]
    const event = createBenefitEvent(entry, "citation", "contrib_001", policy, ["digest_alice"])

    const updated = recordBenefitEvent(store, event)

    // Original is unchanged
    expect(store.events.size).toBe(0)
    // Updated has the event
    expect(updated.events.size).toBe(1)
    expect(updated.events.get(event.eventId)).toBe(event)
  })

  test("recordBenefitEvent preserves existing events and policies", () => {
    let store = createBenefitStore()
    const policy = makePolicy("pol_001")
    store = addPolicy(store, policy)

    const entry = makeEntry()
    entry.provenance.authoredBy = ["digest_alice"]

    const event1 = createBenefitEvent(entry, "citation", "contrib_001", policy, ["digest_alice"])
    const event2 = createBenefitEvent(entry, "reuse", "contrib_002", policy, ["digest_alice"])

    store = recordBenefitEvent(store, event1)
    store = recordBenefitEvent(store, event2)

    expect(store.events.size).toBe(2)
    expect(store.policies.size).toBe(1)
    expect(store.policies.get("pol_001")).toBe(policy)
  })

  test("getContributorBenefits returns all events for a contributor", () => {
    let store = createBenefitStore()
    const policy = makePolicy("pol_001")
    const entry = makeEntry()
    entry.provenance.authoredBy = ["digest_alice"]

    const event1 = createBenefitEvent(entry, "citation", "contrib_001", policy, ["digest_alice", "digest_bob"])
    const event2 = createBenefitEvent(entry, "reuse", "contrib_002", policy, ["digest_bob", "digest_carol"])

    store = recordBenefitEvent(store, event1)
    store = recordBenefitEvent(store, event2)

    const aliceEvents = getContributorBenefits(store, "digest_alice")
    expect(aliceEvents.length).toBe(1)
    expect(aliceEvents[0].eventId).toBe(event1.eventId)

    const bobEvents = getContributorBenefits(store, "digest_bob")
    expect(bobEvents.length).toBe(2)

    const carolEvents = getContributorBenefits(store, "digest_carol")
    expect(carolEvents.length).toBe(1)
  })

  test("getEntryBenefits returns all events for an entry", () => {
    let store = createBenefitStore()
    const policy = makePolicy("pol_001")

    const entry1 = makeEntry()
    entry1.provenance.authoredBy = ["digest_alice"]

    const entry2 = makeEntry({ codexEntryId: "entry_002" })
    entry2.provenance.authoredBy = ["digest_bob"]

    const event1 = createBenefitEvent(entry1, "citation", "contrib_001", policy, ["digest_alice"])
    const event2 = createBenefitEvent(entry1, "reuse", "contrib_002", policy, ["digest_alice"])
    const event3 = createBenefitEvent(entry2, "maintenance", "contrib_003", policy, ["digest_bob"])

    store = recordBenefitEvent(store, event1)
    store = recordBenefitEvent(store, event2)
    store = recordBenefitEvent(store, event3)

    const entry1Events = getEntryBenefits(store, "entry_001")
    expect(entry1Events.length).toBe(2)
    expect(entry1Events.map((e) => e.eventId)).toContain(event1.eventId)
    expect(entry1Events.map((e) => e.eventId)).toContain(event2.eventId)

    const entry2Events = getEntryBenefits(store, "entry_002")
    expect(entry2Events.length).toBe(1)
    expect(entry2Events[0].eventId).toBe(event3.eventId)
  })

  test("addPolicy adds a policy and returns a new store", () => {
    const store = createBenefitStore()
    const policy = makePolicy("pol_001")

    const updated = addPolicy(store, policy)

    expect(store.policies.size).toBe(0)
    expect(updated.policies.size).toBe(1)
    expect(updated.policies.get("pol_001")).toBe(policy)
  })

  test("getTotalAllocation aggregates share values across events", () => {
    let store = createBenefitStore()
    const policy = makePolicy("pol_001")
    const entry = makeEntry()
    entry.provenance.authoredBy = ["digest_alice"]

    // Two events, both benefit alice and bob
    const event1 = createBenefitEvent(entry, "citation", "contrib_001", policy, ["digest_alice", "digest_bob"])
    const event2 = createBenefitEvent(entry, "reuse", "contrib_002", policy, ["digest_alice", "digest_bob"])

    store = recordBenefitEvent(store, event1)
    store = recordBenefitEvent(store, event2)

    // Each event sum is 1.0, so total across both events is 2.0
    const aliceTotal = getTotalAllocation(store, "digest_alice")
    const bobTotal = getTotalAllocation(store, "digest_bob")
    const total = aliceTotal + bobTotal

    expect(Math.abs(total - 2.0)).toBeLessThan(0.01)
  })

  test("getTotalAllocation returns 0 for unknown contributor", () => {
    const store = createBenefitStore()
    expect(getTotalAllocation(store, "nobody")).toBe(0)
  })
})
