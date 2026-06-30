/**
 * Dharma Session Authority — Session Commands — unit tests
 *
 * Tests cover the pure functions for command request/receipt creation,
 * approval requirements, status transitions, and decision helpers.
 */

import { describe, it, expect } from "bun:test"
import {
  createCommandRequest,
  createCommandReceipt,
  createApprovalRequirement,
  isApprovalRequired,
  transitionApprovalStatus,
  getIdempotencyKey,
  isFinalDecision,
} from "../session-commands"
import type {
  SessionCommandRequest,
  CommandKind,
} from "../types"

// ── Fixtures ───────────────────────────────────────────────

const BASE_CONFIG = {
  sessionId: "sess_01j3xyz789",
  actorIdentityPublicKey: "did:dht:alice",
  actorMembershipId: "mem_01j3abc123",
  grantId: "grant_01j3def456",
  sessionKeyEpoch: 1,
  commandKind: "read_file" as CommandKind,
  payloadDigest: "sha256_abc123",
}

const SENSITIVE_KINDS: CommandKind[] = [
  "seal_session",
  "export_artifact",
  "revoke_grant",
]

const NON_SENSITIVE_KINDS: CommandKind[] = [
  "read_file",
  "inspect_workspace",
]

// ── Command Request ────────────────────────────────────────

describe("createCommandRequest", () => {
  it("generates a valid request with all fields", () => {
    const request = createCommandRequest(BASE_CONFIG)

    expect(request).toBeDefined()
    expect(request.requestId).toBeTruthy()
    expect(request.sessionId).toBe("sess_01j3xyz789")
    expect(request.actorIdentityPublicKey).toBe("did:dht:alice")
    expect(request.actorMembershipId).toBe("mem_01j3abc123")
    expect(request.grantId).toBe("grant_01j3def456")
    expect(request.sessionKeyEpoch).toBe(1)
    expect(request.commandKind).toBe("read_file")
    expect(request.targetScope).toBe("")
    expect(request.payloadDigest).toBe("sha256_abc123")
    expect(request.payloadReference).toBeNull()
    expect(request.idempotencyKey).toBeTruthy()
    expect(request.requestedAt).toBeTruthy()
    expect(request.signature).toBe("")
  })

  it("generates an idempotency key when omitted", () => {
    const request1 = createCommandRequest(BASE_CONFIG)
    const request2 = createCommandRequest(BASE_CONFIG)

    // Each call should generate a unique idempotency key
    expect(request1.idempotencyKey).toBeTruthy()
    expect(request2.idempotencyKey).toBeTruthy()
    expect(request1.idempotencyKey).not.toBe(request2.idempotencyKey)
  })

  it("uses the provided idempotency key when supplied", () => {
    const request = createCommandRequest({
      ...BASE_CONFIG,
      idempotencyKey: "idem_001",
    })

    expect(request.idempotencyKey).toBe("idem_001")
  })

  it("accepts an explicit target scope", () => {
    const request = createCommandRequest({
      ...BASE_CONFIG,
      targetScope: "src/main.ts",
    })

    expect(request.targetScope).toBe("src/main.ts")
  })
})

// ── Command Receipt ────────────────────────────────────────

describe("createCommandReceipt", () => {
  it("creates a receipt with the correct decision", () => {
    const request = createCommandRequest(BASE_CONFIG)
    const receipt = createCommandReceipt(request, "accepted")

    expect(receipt.decision).toBe("accepted")
    expect(receipt.denialReason).toBeNull()
    expect(receipt.createdAt).toBeTruthy()
    expect(receipt.finalizedAt).toBeNull()
  })

  it("links back to the originating request", () => {
    const request = createCommandRequest(BASE_CONFIG)
    const receipt = createCommandReceipt(request, "rejected", { denialReason: "insufficient_capabilities" })

    expect(receipt.requestId).toBe(request.requestId)
    expect(receipt.sessionId).toBe(request.sessionId)
    expect(receipt.actorIdentityPublicKey).toBe(request.actorIdentityPublicKey)
    expect(receipt.denialReason).toBe("insufficient_capabilities")
  })

  it("supports overrides for additional fields", () => {
    const request = createCommandRequest(BASE_CONFIG)
    const executionId = "exec_001"
    const receipt = createCommandReceipt(request, "running", { executionId })

    expect(receipt.executionId).toBe("exec_001")
  })
})

// ── Approval Requirement ───────────────────────────────────

describe("createApprovalRequirement", () => {
  it("creates an approval requirement with default values", () => {
    const req = createApprovalRequirement({
      sessionId: "sess_01j3xyz789",
      requestId: "req_001",
      requestedByIdentity: "did:dht:alice",
      requiredApproverRoles: ["maintainer"],
    })

    expect(req.approvalId).toBeTruthy()
    expect(req.sessionId).toBe("sess_01j3xyz789")
    expect(req.requestId).toBe("req_001")
    expect(req.requestedByIdentity).toBe("did:dht:alice")
    expect(req.requiredApproverRoles).toEqual(["maintainer"])
    expect(req.requiredApprovalCount).toBe(1)
    expect(req.scope).toBe("")
    expect(req.expiresAt).toBeTruthy()
    expect(req.status).toBe("pending")
  })

  it("accepts explicit overrides for optional fields", () => {
    const req = createApprovalRequirement({
      sessionId: "sess_01j3xyz789",
      requestId: "req_001",
      requestedByIdentity: "did:dht:alice",
      requiredApproverRoles: ["maintainer", "session_coowner"],
      requiredApprovalCount: 2,
      scope: "workspace.write",
      expiresAt: "2026-07-01T00:00:00.000Z",
    })

    expect(req.requiredApprovalCount).toBe(2)
    expect(req.scope).toBe("workspace.write")
    expect(req.expiresAt).toBe("2026-07-01T00:00:00.000Z")
  })
})

// ── isApprovalRequired ─────────────────────────────────────

describe("isApprovalRequired", () => {
  it("returns true for command kinds in the sensitive list", () => {
    for (const kind of SENSITIVE_KINDS) {
      expect(isApprovalRequired(kind, SENSITIVE_KINDS)).toBe(true)
    }
  })

  it("returns false for non-sensitive command kinds", () => {
    for (const kind of NON_SENSITIVE_KINDS) {
      expect(isApprovalRequired(kind, SENSITIVE_KINDS)).toBe(false)
    }
  })
})

// ── transitionApprovalStatus ───────────────────────────────

describe("transitionApprovalStatus", () => {
  it("allows pending → approved", () => {
    const result = transitionApprovalStatus("pending", "approve")
    expect(result).toBe("approved")
  })

  it("allows pending → rejected", () => {
    const result = transitionApprovalStatus("pending", "reject")
    expect(result).toBe("rejected")
  })

  it("allows pending → expired", () => {
    const result = transitionApprovalStatus("pending", "expire")
    expect(result).toBe("expired")
  })

  it("allows approved → executed", () => {
    const result = transitionApprovalStatus("approved", "execute")
    expect(result).toBe("executed")
  })

  it("allows approved → revoked", () => {
    const result = transitionApprovalStatus("approved", "revoke")
    expect(result).toBe("revoked")
  })

  it("rejects approved → pending (invalid transition)", () => {
    // There's no "pending" action, but we can test that approved can't go back
    // via the "revoke" action that would produce a different target
    const result = transitionApprovalStatus("approved", "approve")
    expect(result).toBeUndefined()
  })

  it("rejects executed → any transition (terminal state)", () => {
    expect(transitionApprovalStatus("executed", "approve")).toBeUndefined()
    expect(transitionApprovalStatus("executed", "reject")).toBeUndefined()
    expect(transitionApprovalStatus("executed", "revoke")).toBeUndefined()
  })

  it("rejects rejected → any transition", () => {
    expect(transitionApprovalStatus("rejected", "approve")).toBeUndefined()
  })

  it("rejects expired → any transition", () => {
    expect(transitionApprovalStatus("expired", "approve")).toBeUndefined()
  })

  it("rejects revoked → any transition", () => {
    expect(transitionApprovalStatus("revoked", "approve")).toBeUndefined()
  })
})

// ── getIdempotencyKey ──────────────────────────────────────

describe("getIdempotencyKey", () => {
  it("returns the idempotency key from a request", () => {
    const request = createCommandRequest({
      ...BASE_CONFIG,
      idempotencyKey: "idem_fixed",
    })
    expect(getIdempotencyKey(request)).toBe("idem_fixed")
  })
})

// ── isFinalDecision ────────────────────────────────────────

describe("isFinalDecision", () => {
  it("returns true for completed", () => {
    expect(isFinalDecision("completed")).toBe(true)
  })

  it("returns true for failed", () => {
    expect(isFinalDecision("failed")).toBe(true)
  })

  it("returns true for cancelled", () => {
    expect(isFinalDecision("cancelled")).toBe(true)
  })

  it("returns true for revoked", () => {
    expect(isFinalDecision("revoked")).toBe(true)
  })

  it("returns false for pending_approval", () => {
    expect(isFinalDecision("pending_approval")).toBe(false)
  })

  it("returns false for accepted", () => {
    expect(isFinalDecision("accepted")).toBe(false)
  })

  it("returns false for running", () => {
    expect(isFinalDecision("running")).toBe(false)
  })

  it("returns false for rejected", () => {
    // "rejected" is a terminal decision for the command request itself,
    // but from the command lifecycle perspective it is not considered
    // "final" by our decision helper because rejected commands may
    // still be re-submitted.
    expect(isFinalDecision("rejected")).toBe(false)
  })
})
