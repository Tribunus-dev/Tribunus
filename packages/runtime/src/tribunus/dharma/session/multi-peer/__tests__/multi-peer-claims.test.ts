/**
 * Tests for Dharma Multi-Peer Claim Lifecycle State Machine
 */

import { describe, it, expect } from "bun:test"
import type { DharmaTaskClaim, ClaimStatus } from "../multi-peer-types"
import {
  VALID_CLAIM_TRANSITIONS,
  applyClaimAction,
  createClaim,
  isClaimActive,
  canClaimTask,
} from "../multi-peer-claims"
import type { ClaimAction, CreateClaimConfig } from "../multi-peer-claims"
import type { DharmaTaskContract } from "../multi-peer-types"

// ── Helpers ────────────────────────────────────────────────────────────────

function makeClaimConfig(overrides?: Partial<CreateClaimConfig>): CreateClaimConfig {
  return {
    taskId: "task-001",
    sessionId: "session-001",
    claimantIdentity: "pk-alice",
    claimantMembershipId: "mem-alice",
    sourceBasisDigest: "abc123def456",
    ...overrides,
  }
}

function makeClaim(overrides?: Partial<DharmaTaskClaim>): DharmaTaskClaim {
  return {
    ...createClaim(makeClaimConfig()),
    ...overrides,
  }
}

function makeTask(overrides?: Partial<DharmaTaskContract>): DharmaTaskContract {
  return {
    taskId: "task-001",
    sessionId: "session-001",
    createdByIdentityPublicKey: "pk-owner",
    title: "Test task",
    summary: "",
    taskKind: "bug_fix",
    parallelism: "exclusive",
    sourceBasisDigest: "abc123def456",
    sourceDisclosurePackageId: null,
    allowedPathScopes: [],
    deniedPathScopes: [],
    expectedArtifactClasses: [],
    verificationContract: "default",
    acceptancePolicy: "attested",
    requiredCapabilities: [],
    assignedMembershipIds: [],
    maxContributors: 1,
    maxResultBundles: 10,
    claimDeadline: null,
    completionDeadline: null,
    status: "available",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    signature: "",
    ...overrides,
  }
}

// ── VALID_CLAIM_TRANSITIONS ────────────────────────────────────────────────

describe("VALID_CLAIM_TRANSITIONS", () => {
  it("available transitions to claimed only", () => {
    expect(VALID_CLAIM_TRANSITIONS["available"]).toEqual(["claimed"])
  })

  it("claimed transitions to in_progress, released, or expired", () => {
    expect(VALID_CLAIM_TRANSITIONS["claimed"]).toEqual(["in_progress", "released", "expired"])
  })

  it("in_progress transitions to result_submitted or abandoned", () => {
    expect(VALID_CLAIM_TRANSITIONS["in_progress"]).toEqual(["result_submitted", "abandoned"])
  })

  it("result_submitted transitions to completed, accepted, rejected, conflicted, or superseded", () => {
    expect(VALID_CLAIM_TRANSITIONS["result_submitted"]).toEqual([
      "completed", "accepted", "rejected", "conflicted", "superseded",
    ])
  })

  it("terminal states have no outgoing transitions", () => {
    for (const s of ["completed", "released", "expired", "abandoned", "accepted", "rejected", "conflicted", "superseded"]) {
      expect(VALID_CLAIM_TRANSITIONS[s]).toEqual([])
    }
  })
})

// ── applyClaimAction ────────────────────────────────────────────────────────

describe("applyClaimAction", () => {
  it("available -> claim -> claimed", () => {
    expect(applyClaimAction("available", "claim")).toBe("claimed")
  })

  it("claimed -> start_work -> in_progress", () => {
    expect(applyClaimAction("claimed", "start_work")).toBe("in_progress")
  })

  it("claimed -> release -> released", () => {
    expect(applyClaimAction("claimed", "release")).toBe("released")
  })

  it("claimed -> expire -> expired", () => {
    expect(applyClaimAction("claimed", "expire")).toBe("expired")
  })

  it("in_progress -> submit -> result_submitted", () => {
    expect(applyClaimAction("in_progress", "submit")).toBe("result_submitted")
  })

  it("in_progress -> abandon -> abandoned", () => {
    expect(applyClaimAction("in_progress", "abandon")).toBe("abandoned")
  })

  it("result_submitted -> complete -> completed", () => {
    expect(applyClaimAction("result_submitted", "complete")).toBe("completed")
  })

  it("result_submitted -> accept -> accepted", () => {
    expect(applyClaimAction("result_submitted", "accept")).toBe("accepted")
  })

  it("result_submitted -> reject -> rejected", () => {
    expect(applyClaimAction("result_submitted", "reject")).toBe("rejected")
  })

  it("result_submitted -> conflict -> conflicted", () => {
    expect(applyClaimAction("result_submitted", "conflict")).toBe("conflicted")
  })

  it("result_submitted -> supersede -> superseded", () => {
    expect(applyClaimAction("result_submitted", "supersede")).toBe("superseded")
  })

  it("throws for invalid transitions", () => {
    expect(() => applyClaimAction("available", "complete")).toThrow()
    expect(() => applyClaimAction("available", "start_work")).toThrow()
    expect(() => applyClaimAction("claimed", "submit")).toThrow()
    expect(() => applyClaimAction("in_progress", "claim")).toThrow()
    expect(() => applyClaimAction("completed", "claim")).toThrow()
    expect(() => applyClaimAction("expired", "claim")).toThrow()
  })

  // ── Full happy-path lifecycle ───────────────────────────────────────────
  it("traverses full happy-path lifecycle", () => {
    let state: ClaimStatus = "available"
    state = applyClaimAction(state, "claim")          // claimed
    state = applyClaimAction(state, "start_work")     // in_progress
    state = applyClaimAction(state, "submit")         // result_submitted
    state = applyClaimAction(state, "accept")         // accepted
    expect(state).toBe("accepted")
  })

  it("traverses complete path", () => {
    let state: ClaimStatus = "available"
    state = applyClaimAction(state, "claim")
    state = applyClaimAction(state, "start_work")
    state = applyClaimAction(state, "submit")
    state = applyClaimAction(state, "complete")
    expect(state).toBe("completed")
  })

  it("traverses release path", () => {
    let state: ClaimStatus = "available"
    state = applyClaimAction(state, "claim")
    state = applyClaimAction(state, "release")
    expect(state).toBe("released")
  })

  it("traverses expire path", () => {
    let state: ClaimStatus = "available"
    state = applyClaimAction(state, "claim")
    state = applyClaimAction(state, "expire")
    expect(state).toBe("expired")
  })

  it("traverses abandon path", () => {
    let state: ClaimStatus = "available"
    state = applyClaimAction(state, "claim")
    state = applyClaimAction(state, "start_work")
    state = applyClaimAction(state, "abandon")
    expect(state).toBe("abandoned")
  })

  it("conflicted is terminal for claims", () => {
    expect(() => applyClaimAction("conflicted", "complete")).toThrow()
    expect(() => applyClaimAction("conflicted", "supersede")).toThrow()
  })
})

// ── createClaim ────────────────────────────────────────────────────────────

describe("createClaim", () => {
  it("creates a claim in available status", () => {
    const claim = createClaim(makeClaimConfig())
    expect(claim.claimId).toBeDefined()
    expect(claim.taskId).toBe("task-001")
    expect(claim.sessionId).toBe("session-001")
    expect(claim.claimantIdentityPublicKey).toBe("pk-alice")
    expect(claim.claimantMembershipId).toBe("mem-alice")
    expect(claim.claimedSourceBasisDigest).toBe("abc123def456")
    expect(claim.status).toBe("available")
    expect(claim.claimedAt).toBeDefined()
    expect(claim.expiresAt).toBeNull()
  })

  it("generates unique claimIds", () => {
    const a = createClaim(makeClaimConfig())
    const b = createClaim(makeClaimConfig())
    expect(a.claimId).not.toBe(b.claimId)
  })
})

// ── isClaimActive ──────────────────────────────────────────────────────────

describe("isClaimActive", () => {
  it("returns true for in-progress states", () => {
    for (const status of ["available", "claimed", "in_progress", "result_submitted"] as const) {
      expect(isClaimActive(makeClaim({ status }))).toBe(true)
    }
  })

  it("returns false for terminal states", () => {
    for (const status of ["completed", "released", "expired", "abandoned", "accepted", "rejected", "superseded"] as const) {
      expect(isClaimActive(makeClaim({ status }))).toBe(false)
    }
  })
})

// ── canClaimTask ───────────────────────────────────────────────────────────

describe("canClaimTask", () => {
  it("allows claim on available exclusive task with no claims", () => {
    const task = makeTask({ status: "available", parallelism: "exclusive" })
    const result = canClaimTask(task, [])
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("rejects claim on non-available task", () => {
    const task = makeTask({ status: "draft" })
    const result = canClaimTask(task, [])
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe("Task is not available")
  })

  it("rejects second claim on exclusive task", () => {
    const task = makeTask({ status: "available", parallelism: "exclusive" })
    const existing = [makeClaim({ status: "in_progress" })]
    const result = canClaimTask(task, existing)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe("Task is exclusive; already claimed")
  })

  it("rejects second claim on review_only task", () => {
    const task = makeTask({ status: "available", parallelism: "review_only" })
    const existing = [makeClaim({ status: "in_progress" })]
    const result = canClaimTask(task, existing)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe("Review-only task already claimed")
  })

  it("allows parallel claims on parallel_competing task", () => {
    const task = makeTask({
      status: "available",
      parallelism: "parallel_competing",
      maxContributors: 3,
    })
    const existing = [makeClaim({ status: "in_progress" })]
    const result = canClaimTask(task, existing)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("rejects claim when max contributors reached", () => {
    const task = makeTask({
      status: "available",
      parallelism: "parallel_competing",
      maxContributors: 2,
    })
    const existing = [
      makeClaim({ status: "in_progress" }),
      makeClaim({ status: "in_progress" }),
    ]
    const result = canClaimTask(task, existing)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Max contributors")
  })

  it("counts only active claims toward max contributors", () => {
    const task = makeTask({
      status: "available",
      parallelism: "parallel_competing",
      maxContributors: 2,
    })
    // One active + one completed — completed should not count
    const existing = [
      makeClaim({ status: "in_progress" }),
      makeClaim({ status: "completed" }),
    ]
    const result = canClaimTask(task, existing)
    expect(result.allowed).toBe(true)
  })
})
