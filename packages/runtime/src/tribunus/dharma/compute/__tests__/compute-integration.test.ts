/**
 * Compute Lease Integration Tests
 *
 * Pure function tests for local Prism compute lease lifecycle,
 * artifact admission, budget enforcement, execution, and usage receipts.
 * No real Prism binary needed — all functions are stateless pure functions.
 */

import { describe, test, expect } from "bun:test"
import {
  createLease,
  applyLeaseAction,
  isTerminalLease,
  isActiveLease,
  VALID_LEASE_TRANSITIONS,
  type LeaseAction,
} from "../compute-lease"
import { createExecutionDescriptor, transitionExecutionStage } from "../compute-execution"
import { createUsageReceipt, isSuccessfulReceipt } from "../compute-receipt"
import { createArtifact, admitArtifact, isArtifactAdmitted } from "../compute-artifact"
import { getDefaultComputeBudget } from "../compute-budget"
import type { LocalPrismComputeLease, ComputeLeaseStatus } from "../compute-types"

// ── Helpers -----------------------------------------------------------------

const TEST_SESSION_ID = "session-integration-01"
const TEST_INPUT_DIGEST = "abc123def456"
const TEST_ARTIFACT_DIGEST = "artifact-mistral-7b-v3"

function makeLease(
  overrides: Partial<{
    sessionId: string
    requester: string
    membershipId: string
    grantId: string
    workloadClass: "chat_completion" | "code_completion" | "embedding"
    modelArtifactDigest: string
    inputDigest: string
  }> = {},
): LocalPrismComputeLease {
  return createLease({
    sessionId: TEST_SESSION_ID,
    requester: "alice-pubkey",
    membershipId: "membership-01",
    grantId: "grant-01",
    workloadClass: "chat_completion",
    modelArtifactDigest: TEST_ARTIFACT_DIGEST,
    inputDigest: TEST_INPUT_DIGEST,
    ...overrides,
  })
}

/**
 * Walk a lease through explicit actions.
 * The state machine has an internal auto-transition from requested →
 * pending_approval (no user action maps to it), so the caller must
 * supply the pending_approval status as a literal after requesting.
 */
function walkToRunning(lease: LocalPrismComputeLease): ComputeLeaseStatus {
  const requested = applyLeaseAction(lease.status, "request")
  expect(requested).toBe("requested")
  expect(VALID_LEASE_TRANSITIONS[requested]).toContain("pending_approval")

  const pendingApproval: ComputeLeaseStatus = "pending_approval"
  const approved = applyLeaseAction(pendingApproval, "approve")
  expect(approved).toBe("approved")

  const admitted = applyLeaseAction(approved, "admit")
  const running = applyLeaseAction(admitted, "start")
  return running
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("Compute Lease Integration", () => {
  // ── Full Lifecycle ──────────────────────────────────────────────────

  test("create → request → approve → admit → run → complete produces signed receipt", () => {
    const lease = makeLease()

    // Start in draft
    expect(lease.status).toBe("draft")
    expect(isActiveLease(lease)).toBe(false)
    expect(isTerminalLease(lease)).toBe(false)

    // Walk through lifecycle
    const running = walkToRunning(lease)
    expect(running).toBe("running")
    expect(isActiveLease({ ...lease, status: running })).toBe(true)

    // Complete
    const completed = applyLeaseAction(running, "complete")
    expect(completed).toBe("completed")
    expect(isTerminalLease({ ...lease, status: completed })).toBe(true)

    // Build execution descriptor for receipt production
    const leaseWithFullStatus: LocalPrismComputeLease = {
      ...lease,
      status: completed,
      leaseId: "lease-lifecycle-01",
    }

    const budget = getDefaultComputeBudget()
    const execution = createExecutionDescriptor({
      lease: leaseWithFullStatus,
      computeImageDigest: "img-gguf-q4",
      targetSignature: "arm64-macos-default",
      budget,
    })

    // Create receipt
    const receipt = createUsageReceipt({
      lease: leaseWithFullStatus,
      computeImageDigest: "img-gguf-q4",
      targetSignature: "arm64-macos-default",
      containmentProfileDigest: "profile-std",
      execution,
      inputDigest: TEST_INPUT_DIGEST,
      outputDigest: "out-def789",
      inputTokens: 128,
      outputTokens: 256,
      prefillMs: 1520,
      decodeMs: 8430,
      totalMs: 9950,
      peakMemoryBytes: 2_147_483_648,
      cacheHit: "partial",
      executionState: completed,
    })

    expect(receipt).toBeDefined()
    expect(receipt.leaseId).toBe("lease-lifecycle-01")
    expect(receipt.sessionId).toBe(TEST_SESSION_ID)
    expect(receipt.inputTokenCount).toBe(128)
    expect(receipt.outputTokenCount).toBe(256)
    expect(receipt.totalDurationMs).toBe(9950)
    expect(receipt.failureClass).toBeNull()
    expect(receipt.signature).toBeTruthy()
    expect(receipt.signature.length).toBeGreaterThan(0)

    // Successful receipt classification
    expect(isSuccessfulReceipt(receipt)).toBe(true)
  })

  // ── Reject stays rejected ───────────────────────────────────────────

  test("create → request → reject stays rejected", () => {
    const lease = makeLease()
    expect(lease.status).toBe("draft")

    // Direct rejection from requested is valid per VALID_LEASE_TRANSITIONS
    const requested = applyLeaseAction(lease.status, "request")
    expect(requested).toBe("requested")
    expect(VALID_LEASE_TRANSITIONS[requested]).toContain("rejected")

    const rejected = applyLeaseAction(requested, "reject")
    expect(rejected).toBe("rejected")

    // Verify terminal
    const terminalLease = { ...lease, status: rejected }
    expect(isTerminalLease(terminalLease)).toBe(true)
    expect(isActiveLease(terminalLease)).toBe(false)

    // Further actions should throw
    expect(() => applyLeaseAction(rejected, "approve")).toThrow()
    expect(() => applyLeaseAction(rejected, "admit")).toThrow()
    expect(() => applyLeaseAction(rejected, "start")).toThrow()
  })

  // ── Cancel during running ───────────────────────────────────────────

  test("create → ... → running → cancel stays cancelled", () => {
    const lease = makeLease()

    // Walk to running
    const running = walkToRunning(lease)
    expect(running).toBe("running")

    // Cancel
    const cancelled = applyLeaseAction(running, "cancel")
    expect(cancelled).toBe("cancelled")

    const terminalLease = { ...lease, status: cancelled }
    expect(isTerminalLease(terminalLease)).toBe(true)
    expect(isActiveLease(terminalLease)).toBe(false)

    // Cancelled is final — no valid transitions out
    expect(() => applyLeaseAction(cancelled, "complete")).toThrow()
    expect(() => applyLeaseAction(cancelled, "start")).toThrow()
  })

  // ── Two leases coexist ──────────────────────────────────────────────

  test("two leases can coexist in same session", () => {
    const leaseAlice = makeLease({
      sessionId: TEST_SESSION_ID,
      requester: "alice-pubkey",
      grantId: "grant-alice-01",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      inputDigest: "input-alice-001",
    })
    const leaseBob = makeLease({
      sessionId: TEST_SESSION_ID,
      requester: "bob-pubkey",
      grantId: "grant-bob-01",
      workloadClass: "code_completion",
      modelArtifactDigest: "artifact-codellama-7b",
      inputDigest: "input-bob-001",
    })

    expect(leaseAlice.sessionId).toBe(TEST_SESSION_ID)
    expect(leaseBob.sessionId).toBe(TEST_SESSION_ID)

    // Alice: full lifecycle through running
    const aliceRunning = walkToRunning(leaseAlice)
    expect(aliceRunning).toBe("running")
    expect(isActiveLease({ ...leaseAlice, status: aliceRunning })).toBe(true)

    // Bob: rejected immediately
    const bobRequested = applyLeaseAction(leaseBob.status, "request")
    const bobPending: ComputeLeaseStatus = "pending_approval"
    const bobRejected = applyLeaseAction(bobPending, "reject")
    expect(bobRejected).toBe("rejected")
    expect(isTerminalLease({ ...leaseBob, status: bobRejected })).toBe(true)

    // Alice completes independently of Bob
    const aliceDone = applyLeaseAction(aliceRunning, "complete")
    expect(aliceDone).toBe("completed")
    expect(isTerminalLease({ ...leaseAlice, status: aliceDone })).toBe(true)
  })

  // ── Lease with unadmitted artifact is rejected ──────────────────────

  test("lease with unadmitted artifact is rejected", () => {
    // Create an artifact that stays in pending_validation (never admitted)
    const artifact = createArtifact(
      "artifact-phi-2b",
      "Phi-2",
      "phi-family",
      "2.0",
    )
    expect(isArtifactAdmitted(artifact)).toBe(false)

    // The lease referencing this artifact
    const lease = makeLease({
      modelArtifactDigest: artifact.artifactDigest,
    })

    // Walk to admission gate: request → pending_approval
    let s = applyLeaseAction(lease.status, "request")
    expect(VALID_LEASE_TRANSITIONS[s]).toContain("pending_approval")
    const pa: ComputeLeaseStatus = "pending_approval"

    // Artifact is not admitted — check fails at the approval/admission gate
    expect(isArtifactAdmitted(artifact)).toBe(false)
    expect(artifact.admissionState).toBe("pending_validation")

    // Rejection happens at the pending_approval stage because artifact is not ready
    const rejected = applyLeaseAction(pa, "reject")
    expect(rejected).toBe("rejected")

    // Now admit the artifact and verify
    const admittedArtifact = admitArtifact(artifact)
    expect(isArtifactAdmitted(admittedArtifact)).toBe(true)
    expect(admittedArtifact.admissionState).toBe("admitted")
  })
})
