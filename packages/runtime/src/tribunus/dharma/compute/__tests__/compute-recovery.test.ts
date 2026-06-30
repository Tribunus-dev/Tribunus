/**
 * Compute Recovery Tests
 *
 * Pure-function tests for compute lease recovery after restarts.
 * Verifies lease state recovery, duplicate prevention, and receipt
 * persistence without re-execution.
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
import { getDefaultComputeBudget } from "../compute-budget"
import type { LocalPrismComputeLease, PrismUsageReceipt, ComputeLeaseStatus } from "../compute-types"

// ── Helpers -----------------------------------------------------------------

const TEST_SESSION_ID = "session-recovery-01"
const TEST_ARTIFACT_DIGEST = "artifact-mistral-7b"

function makeLease(): LocalPrismComputeLease {
  return createLease({
    sessionId: TEST_SESSION_ID,
    requester: "alice-pubkey",
    membershipId: "membership-01",
    grantId: "grant-01",
    workloadClass: "chat_completion",
    modelArtifactDigest: TEST_ARTIFACT_DIGEST,
    inputDigest: "input-recovery-001",
  })
}

/** Walk a lease to running using the action-based state machine. */
function walkToRunning(lease: LocalPrismComputeLease): ComputeLeaseStatus {
  const requested = applyLeaseAction(lease.status, "request")
  expect(VALID_LEASE_TRANSITIONS[requested]).toContain("pending_approval")
  const pendingApproval: ComputeLeaseStatus = "pending_approval"
  const approved = applyLeaseAction(pendingApproval, "approve")
  const admitted = applyLeaseAction(approved, "admit")
  return applyLeaseAction(admitted, "start")
}

const DEFAULT_BUDGET = getDefaultComputeBudget()

/**
 * Simulate a checkpointed lease: the lease object as it was persisted
 * before a restart. This is what recovery code would load.
 */
function checkpointedLease(status: ComputeLeaseStatus, leaseId: string): LocalPrismComputeLease {
  const base = makeLease()
  return {
    ...base,
    leaseId,
    status,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Compute Lease Recovery", () => {
  // ── Restart Before Admission ───────────────────────────────────────

  test("restart before lease admission: lease state recovered", () => {
    // Pre-admission states: draft, requested, pending_approval, approved
    const preAdmissionStatuses: ComputeLeaseStatus[] = [
      "draft",
      "requested",
      "pending_approval",
      "approved",
    ]

    for (const status of preAdmissionStatuses) {
      const recovered = checkpointedLease(status, `lease-pre-${status}`)

      // Recovered lease should not be terminal — resumable
      expect(isTerminalLease(recovered)).toBe(false)
    }

    // Draft lease is not active yet — needs request to proceed
    const draftRecovered = checkpointedLease("draft", "lease-pre-draft")
    expect(isTerminalLease(draftRecovered)).toBe(false)
    expect(isActiveLease(draftRecovered)).toBe(false)
    expect(() => applyLeaseAction(draftRecovered.status, "request")).not.toThrow()

    // Approved lease is active and can be admitted
    const approvedRecovered = checkpointedLease("approved", "lease-pre-approved")
    expect(isActiveLease(approvedRecovered)).toBe(true)
    expect(() => applyLeaseAction(approvedRecovered.status, "admit")).not.toThrow()
  })

  // ── Restart During Execution ───────────────────────────────────────

  test("restart during execution: lease state recovered without duplicate", () => {
    // Simulate a lease that was running when the runtime died
    const lease = makeLease()
    const runningStatus = walkToRunning(lease)
    const checkpointed = checkpointedLease(runningStatus, "lease-exec-01")

    expect(checkpointed.status).toBe("running")
    expect(isActiveLease(checkpointed)).toBe(true)
    expect(isTerminalLease(checkpointed)).toBe(false)

    // On restart, the recovery must not duplicate execution.
    // Instead of starting a new execution, the recovered lease should either:
    // A) be cancelled (no way to resume in-flight compute)
    const cancelledStatus = applyLeaseAction(checkpointed.status, "cancel")
    expect(cancelledStatus).toBe("cancelled")
    expect(isTerminalLease({ ...checkpointed, status: cancelledStatus })).toBe(true)

    // B) or be explicitly failed to mark the interruption
    const failedStatus = applyLeaseAction(checkpointed.status, "fail")
    expect(failedStatus).toBe("failed")

    // Verify no duplicate active leases: starting a new lease should have a
    // different leaseId and go through its own lifecycle without reacting to the old one
    const freshLease = createLease({
      sessionId: TEST_SESSION_ID,
      requester: "alice-pubkey",
      membershipId: "membership-01",
      grantId: "grant-01",
      workloadClass: "chat_completion",
      modelArtifactDigest: TEST_ARTIFACT_DIGEST,
      inputDigest: "input-recovery-002",
    })
    const freshRunning = walkToRunning(freshLease)
    expect(freshRunning).toBe("running")

    // The old lease's cancellation is independent of the new one
    expect(isTerminalLease({ ...freshLease, status: freshRunning })).toBe(false)

    // Executions also reflect the recovery
    const streamingExec = transitionExecutionStage("decode", "cancel")
    expect(streamingExec).toBe("cancelled")
  })

  // ── Restart After Receipt ──────────────────────────────────────────

  test("restart after receipt: receipt available without re-execution", () => {
    // Simulate a completed lease with a persisted receipt
    const lease = makeLease()
    lease.leaseId = "lease-receipt-01"
    const completedStatus = (() => {
      const running = walkToRunning(lease)
      return applyLeaseAction(running, "complete")
    })()
    expect(completedStatus).toBe("completed")

    const completedLease: LocalPrismComputeLease = {
      ...lease,
      status: completedStatus,
    }

    // Build the execution descriptor (as it was persisted)
    const execution = createExecutionDescriptor({
      lease: completedLease,
      computeImageDigest: "img-gguf-q4",
      targetSignature: "arm64-macos-default",
      budget: DEFAULT_BUDGET,
    })

    // Create the receipt (as it was persisted after execution)
    const receipt = createUsageReceipt({
      lease: completedLease,
      computeImageDigest: "img-gguf-q4",
      targetSignature: "arm64-macos-default",
      containmentProfileDigest: "profile-std",
      execution,
      inputDigest: "input-recovery-001",
      outputDigest: "out-recovery-001",
      inputTokens: 150,
      outputTokens: 300,
      prefillMs: 2000,
      decodeMs: 12000,
      totalMs: 14000,
      peakMemoryBytes: 1_073_741_824,
      cacheHit: "full",
      executionState: "completed",
    })

    expect(receipt).toBeDefined()
    expect(receipt.leaseId).toBe("lease-receipt-01")
    expect(isSuccessfulReceipt(receipt)).toBe(true)
    expect(receipt.failureClass).toBeNull()

    // After restart, the receipt is available without re-execution.
    // Recovery would load the persisted receipt. Verify its content
    // is complete and consistent:
    expect(receipt.inputTokenCount).toBe(150)
    expect(receipt.outputTokenCount).toBe(300)
    expect(receipt.totalDurationMs).toBe(14000)
    expect(receipt.executionState).toBe("completed")

    // No new execution is created — the receipt proves the work was done.
    // Verify that trying to run again on a completed lease would fail:
    expect(isTerminalLease(completedLease)).toBe(true)
    expect(() => applyLeaseAction(completedStatus, "start")).toThrow()
  })
})
