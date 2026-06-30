/**
 * Tests for compute-lease.ts — 14-state lease lifecycle state machine.
 */

import { describe, it, expect } from "bun:test"
import {
  applyLeaseAction,
  createLease,
  isTerminalLease,
  isActiveLease,
  VALID_LEASE_TRANSITIONS,
} from "../compute-lease.ts"
import type { ComputeLeaseStatus, LocalPrismComputeLease } from "../compute-types.ts"

// ── Helpers -----------------------------------------------------------------

function makeDraftLease(overrides?: Partial<LocalPrismComputeLease>): LocalPrismComputeLease {
  return {
    ...createLease({
      sessionId: "sess-1",
      requester: "pk-abc",
      membershipId: "mem-1",
      grantId: "grant-1",
      workloadClass: "chat_completion",
      modelArtifactDigest: "sha256:deadbeef",
      inputDigest: "sha256:cafe",
    }),
    ...overrides,
  }
}

// ── Transition Table Coverage -----------------------------------------------

describe("VALID_LEASE_TRANSITIONS", () => {
  it("declares every ComputeLeaseStatus as a key", () => {
    const expected: ComputeLeaseStatus[] = [
      "draft", "requested", "pending_approval", "approved",
      "admitted", "running", "streaming", "completed",
      "rejected", "expired", "failed", "cancelled", "revoked",
    ]
    for (const s of expected) {
      expect(VALID_LEASE_TRANSITIONS).toHaveProperty(s)
    }
  })

  it("terminal states have no outgoing transitions", () => {
    for (const s of ["completed", "rejected", "expired", "failed", "cancelled", "revoked"] as const) {
      expect(VALID_LEASE_TRANSITIONS[s]).toEqual([])
    }
  })
})

// ── applyLeaseAction -------------------------------------------------------

describe("applyLeaseAction", () => {
  it("draft → request", () => {
    expect(applyLeaseAction("draft", "request")).toBe("requested")
  })

  it("requested → pending_approval is in the transition table", () => {
    expect(VALID_LEASE_TRANSITIONS.requested).toContain("pending_approval")
  })

  it("requested → reject → rejected", () => {
    expect(applyLeaseAction("requested", "reject")).toBe("rejected")
  })

  it("pending_approval → approve → approved", () => {
    expect(applyLeaseAction("pending_approval", "approve")).toBe("approved")
  })

  it("pending_approval → reject → rejected", () => {
    expect(applyLeaseAction("pending_approval", "reject")).toBe("rejected")
  })

  it("approved → admit → admitted", () => {
    expect(applyLeaseAction("approved", "admit")).toBe("admitted")
  })

  it("approved → expire → expired", () => {
    expect(applyLeaseAction("approved", "expire")).toBe("expired")
  })

  it("admitted → start → running", () => {
    expect(applyLeaseAction("admitted", "start")).toBe("running")
  })

  it("admitted → fail → failed", () => {
    expect(applyLeaseAction("admitted", "fail")).toBe("failed")
  })

  it("running → stream → streaming", () => {
    expect(applyLeaseAction("running", "stream")).toBe("streaming")
  })

  it("running → complete → completed", () => {
    expect(applyLeaseAction("running", "complete")).toBe("completed")
  })

  it("running → cancel → cancelled", () => {
    expect(applyLeaseAction("running", "cancel")).toBe("cancelled")
  })

  it("running → fail → failed", () => {
    expect(applyLeaseAction("running", "fail")).toBe("failed")
  })

  it("streaming → complete → completed", () => {
    expect(applyLeaseAction("streaming", "complete")).toBe("completed")
  })

  it("streaming → cancel → cancelled", () => {
    expect(applyLeaseAction("streaming", "cancel")).toBe("cancelled")
  })

  it("streaming → fail → failed", () => {
    expect(applyLeaseAction("streaming", "fail")).toBe("failed")
  })

  it("revoke works from any active status", () => {
    for (const status of ["draft", "requested", "pending_approval", "approved", "admitted", "running", "streaming"] as ComputeLeaseStatus[]) {
      expect(applyLeaseAction(status, "revoke")).toBe("revoked")
    }
  })

  // ── Invalid transitions ---------------------------------------------------

  const BAD_PAIRS: [ComputeLeaseStatus, string][] = [
    ["draft", "approve"],
    ["draft", "complete"],
    ["draft", "fail"],
    ["draft", "cancel"],
    ["completed", "request"],
    ["completed", "approve"],
    ["rejected", "approve"],
    ["expired", "admit"],
    ["failed", "start"],
    ["cancelled", "stream"],
    ["revoked", "approve"],
    ["draft", "expire"],
    ["requested", "admit"],
    ["pending_approval", "start"],
    ["approved", "complete"],
    ["admitted", "approve"],
    ["running", "reject"],
  ]

  it.each(BAD_PAIRS)("throws for %s → %s", (status, action) => {
    expect(() => applyLeaseAction(status, action as any)).toThrow(
      `Invalid lease action "${action}" from status "${status}"`,
    )
  })
})

// ── createLease -------------------------------------------------------------

describe("createLease", () => {
  it("creates a draft lease with expected defaults", () => {
    const lease = createLease({
      sessionId: "sess-1",
      requester: "pk-alice",
      membershipId: "mem-42",
      grantId: "grant-x",
      workloadClass: "embedding",
      modelArtifactDigest: "sha256:1234",
      inputDigest: "sha256:abcd",
    })

    expect(lease.sessionId).toBe("sess-1")
    expect(lease.requesterIdentityPublicKey).toBe("pk-alice")
    expect(lease.requesterMembershipId).toBe("mem-42")
    expect(lease.grantId).toBe("grant-x")
    expect(lease.workloadClass).toBe("embedding")
    expect(lease.modelArtifactDigest).toBe("sha256:1234")
    expect(lease.inputDigest).toBe("sha256:abcd")
    expect(lease.status).toBe("draft")
    expect(lease.backendKind).toBe("prism_local")
    expect(lease.taskId).toBeNull()
    expect(lease.approvingIdentityPublicKey).toBeNull()
    expect(lease.requestedMaxTokens).toBeNull()
    expect(lease.requestedMaxGpuTimeMs).toBeNull()
    expect(lease.requestedMaxRuntimeSeconds).toBe(300)
    expect(lease.requestedMaxMemoryBytes).toBe(2 * 1024 ** 3)
    expect(lease.requestedMaxOutputBytes).toBe(1024 * 1024)
    expect(lease.issuedAt).toBeTruthy()
    expect(() => new Date(lease.issuedAt)).not.toThrow()
  })
})

// ── isTerminalLease / isActiveLease -----------------------------------------

describe("isTerminalLease", () => {
  it("returns true for terminal statuses", () => {
    for (const s of ["completed", "rejected", "expired", "failed", "cancelled", "revoked"] as const) {
      expect(isTerminalLease(makeDraftLease({ status: s }))).toBe(true)
    }
  })

  it("returns false for non-terminal statuses", () => {
    for (const s of ["draft", "requested", "pending_approval", "approved", "admitted", "running", "streaming"] as const) {
      expect(isTerminalLease(makeDraftLease({ status: s }))).toBe(false)
    }
  })
})

describe("isActiveLease", () => {
  it("returns true for active statuses", () => {
    for (const s of ["requested", "pending_approval", "approved", "admitted", "running", "streaming"] as const) {
      expect(isActiveLease(makeDraftLease({ status: s }))).toBe(true)
    }
  })

  it("returns false for draft and terminal statuses", () => {
    expect(isActiveLease(makeDraftLease({ status: "draft" }))).toBe(false)
    expect(isActiveLease(makeDraftLease({ status: "completed" }))).toBe(false)
    expect(isActiveLease(makeDraftLease({ status: "failed" }))).toBe(false)
  })
})
