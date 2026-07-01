/**
 * Tests for Track E — Contribution Hooks
 */

import { describe, test, expect } from "bun:test"
import type { SessionCommandRequest, SessionCommandReceipt, CommandKind } from "../types"
import {
  commandKindToContributionClass,
  createContributionHookContext,
  recordContributionFromCommand,
  acceptContributionRecord,
  getSessionSummary,
} from "../contribution-hooks"

// ── commandKindToContributionClass ──────────────────────────────────────────

describe("commandKindToContributionClass", () => {
  const expectedMappings: Record<string, string> = {
    inspect_workspace: "reproduction_evidence",
    read_file: "reproduction_evidence",
    write_file: "work_product",
    apply_patch: "work_product",
    create_overlay: "work_product",
    merge_overlay: "work_product",
    discard_overlay: "work_product",
    execute_command: "compute_lease",
    terminate_command: "work_product",
    request_compute_lease: "compute_lease",
    approve_compute_lease: "moderation_action",
    cancel_compute_lease: "compute_lease",
    invite_participant: "session_stewardship",
    revoke_grant: "work_product",
    request_escalation: "work_product",
    approve_escalation: "moderation_action",
    seal_session: "work_product",
    export_artifact: "artifact_contribution",
  }

  for (const [kind, expected] of Object.entries(expectedMappings)) {
    test(`maps ${kind} to ${expected}`, () => {
      expect(commandKindToContributionClass(kind as CommandKind)).toBe(expected)
    })
  }
})

// ── createContributionHookContext ──────────────────────────────────────────

describe("createContributionHookContext", () => {
  test("creates context with empty store", () => {
    const ctx = createContributionHookContext("session-1", "digest-1")
    expect(ctx.sessionId).toBe("session-1")
    expect(ctx.contributorIdentityDigest).toBe("digest-1")
    expect(ctx.store.records.size).toBe(0)
  })
})

// ── recordContributionFromCommand ──────────────────────────────────────────

describe("recordContributionFromCommand", () => {
  function makeRequest(overrides: Partial<SessionCommandRequest> = {}): SessionCommandRequest {
    return {
      requestId: "req-1",
      sessionId: "session-1",
      actorIdentityPublicKey: "actor-key-1",
      actorMembershipId: "member-1",
      grantId: "grant-1",
      sessionKeyEpoch: 1,
      commandKind: "write_file",
      targetScope: "/tmp/test",
      payloadDigest: "payload-digest-1",
      payloadReference: null,
      idempotencyKey: "idem-1",
      requestedAt: "2025-01-01T00:00:00Z",
      signature: "sig-1",
      ...overrides,
    }
  }

  function makeReceipt(overrides: Partial<SessionCommandReceipt> = {}): SessionCommandReceipt {
    return {
      receiptId: "receipt-1",
      requestId: "req-1",
      sessionId: "session-1",
      actorIdentityPublicKey: "actor-key-1",
      decision: "accepted",
      denialReason: null,
      authorityEvaluationDigest: "eval-digest-1",
      executionId: null,
      workspaceBeforeDigest: null,
      workspaceAfterDigest: null,
      outputDigest: null,
      artifactDigest: null,
      computeLeaseId: null,
      createdAt: "2025-01-01T00:00:00Z",
      finalizedAt: null,
      controllerSignature: "ctrl-sig-1",
      ...overrides,
    }
  }

  test("creates a contribution record with correct fields", () => {
    const ctx = createContributionHookContext("session-1", "contrib-digest-1")
    const request = makeRequest({ commandKind: "write_file" })
    const receipt = makeReceipt()

    const { context: newCtx, record } = recordContributionFromCommand(ctx, request, receipt)

    expect(record.contributionId).toBe("contrib-req-1")
    expect(record.sessionId).toBe("session-1")
    expect(record.contributorIdentityDigest).toBe("contrib-digest-1")
    expect(record.contributionClass).toBe("work_product")
    expect(record.description).toBe("write_file command completed")
    expect(record.receiptDigests).toEqual(["receipt-1"])
    expect(record.acceptedBy).toBeNull()
    expect(record.acceptedAt).toBeNull()
    expect(record.evidenceQuality).toBe("medium")
    expect(record.outcomeRelation).toBe("req-1")
    expect(record.codexEligibility).toBe(false)
    expect(record.visibilityClass).toBe("session")
    expect(typeof record.createdAt).toBe("string")

    // Store updated
    expect(newCtx.store.records.size).toBe(1)
    expect(newCtx.store.records.get("contrib-req-1")).toEqual(record)
  })

  test("uses correct class for moderation_action commands", () => {
    const ctx = createContributionHookContext("session-1", "digest-1")
    const request = makeRequest({ commandKind: "approve_escalation" })
    const receipt = makeReceipt()

    const { record } = recordContributionFromCommand(ctx, request, receipt)
    expect(record.contributionClass).toBe("moderation_action")
  })

  test("stores multiple contributions", () => {
    let ctx = createContributionHookContext("session-1", "digest-1")
    const receipt = makeReceipt()

    const r1 = makeRequest({ requestId: "req-1", commandKind: "write_file" })
    const r2 = makeRequest({ requestId: "req-2", commandKind: "read_file" })
    const r3 = makeRequest({ requestId: "req-3", commandKind: "invite_participant" })

    const res1 = recordContributionFromCommand(ctx, r1, receipt)
    ctx = res1.context
    const res2 = recordContributionFromCommand(ctx, r2, receipt)
    ctx = res2.context
    const res3 = recordContributionFromCommand(ctx, r3, receipt)
    ctx = res3.context

    expect(ctx.store.records.size).toBe(3)
    expect(ctx.store.records.has("contrib-req-1")).toBe(true)
    expect(ctx.store.records.has("contrib-req-2")).toBe(true)
    expect(ctx.store.records.has("contrib-req-3")).toBe(true)
  })
})

// ── acceptContributionRecord ──────────────────────────────────────────────

describe("acceptContributionRecord", () => {
  test("accepts a contribution and updates the store", () => {
    let ctx = createContributionHookContext("session-1", "digest-1")
    const request: SessionCommandRequest = {
      requestId: "req-1",
      sessionId: "session-1",
      actorIdentityPublicKey: "actor-key-1",
      actorMembershipId: "member-1",
      grantId: "grant-1",
      sessionKeyEpoch: 1,
      commandKind: "write_file",
      targetScope: "/tmp",
      payloadDigest: "pd",
      payloadReference: null,
      idempotencyKey: "ik",
      requestedAt: "2025-01-01T00:00:00Z",
      signature: "sig",
    }
    const receipt: SessionCommandReceipt = {
      receiptId: "receipt-1",
      requestId: "req-1",
      sessionId: "session-1",
      actorIdentityPublicKey: "actor-key-1",
      decision: "accepted",
      denialReason: null,
      authorityEvaluationDigest: "ed",
      executionId: null,
      workspaceBeforeDigest: null,
      workspaceAfterDigest: null,
      outputDigest: null,
      artifactDigest: null,
      computeLeaseId: null,
      createdAt: "2025-01-01T00:00:00Z",
      finalizedAt: null,
      controllerSignature: "cs",
    }

    const { context: ctx2 } = recordContributionFromCommand(ctx, request, receipt)
    const ctx3 = acceptContributionRecord(ctx2, "contrib-req-1", "owner-key-1")

    const record = ctx3.store.records.get("contrib-req-1")
    expect(record).toBeDefined()
    expect(record!.acceptedBy).toBe("owner-key-1")
    expect(record!.acceptedAt).not.toBeNull()
    expect(typeof record!.acceptedAt).toBe("string")
  })

  test("returns context unchanged for unknown contribution id", () => {
    const ctx = createContributionHookContext("session-1", "digest-1")
    const result = acceptContributionRecord(ctx, "contrib-nonexistent", "owner-key-1")
    expect(result.store.records.size).toBe(0)
  })
})

// ── getSessionSummary ──────────────────────────────────────────────────────

describe("getSessionSummary", () => {
  test("returns empty summary for empty store", () => {
    const ctx = createContributionHookContext("session-1", "digest-1")
    const summary = getSessionSummary(ctx.store, "session-1")
    expect(summary).toBeDefined()
    expect(summary.acceptedCount).toBe(0)
    expect(summary.pendingCount).toBe(0)
    expect(summary.byClass).toEqual({})
  })

  test("returns summary with contributions", () => {
    let ctx = createContributionHookContext("session-1", "digest-1")
    const receipt: SessionCommandReceipt = {
      receiptId: "r1",
      requestId: "req-1",
      sessionId: "session-1",
      actorIdentityPublicKey: "ak",
      decision: "accepted",
      denialReason: null,
      authorityEvaluationDigest: "ed",
      executionId: null,
      workspaceBeforeDigest: null,
      workspaceAfterDigest: null,
      outputDigest: null,
      artifactDigest: null,
      computeLeaseId: null,
      createdAt: "2025-01-01T00:00:00Z",
      finalizedAt: null,
      controllerSignature: "cs",
    }
    const request: SessionCommandRequest = {
      requestId: "req-1",
      sessionId: "session-1",
      actorIdentityPublicKey: "ak",
      actorMembershipId: "m1",
      grantId: "g1",
      sessionKeyEpoch: 1,
      commandKind: "write_file",
      targetScope: "/tmp",
      payloadDigest: "pd",
      payloadReference: null,
      idempotencyKey: "ik",
      requestedAt: "2025-01-01T00:00:00Z",
      signature: "sig",
    }

    const { context: ctx2 } = recordContributionFromCommand(ctx, request, receipt)
    const summary = getSessionSummary(ctx2.store, "session-1")
    expect(summary.pendingCount).toBe(1)
    expect(summary.byClass.work_product).toBe(1)
  })
})
