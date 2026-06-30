/**
 * Compute Containment Tests
 *
 * Pure-function tests for Prism containment integration:
 * session containment profile inheritance, session revocation's
 * effect on active compute, and sandbox destruction's effect on
 * KV namespaces.
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
import { getDefaultComputeBudget } from "../compute-budget"
import { createKvNamespace, applyKvAction } from "../compute-kv"
import type { LocalPrismComputeLease, LocalKvNamespace, ComputeLeaseStatus } from "../compute-types"

// ── Helpers -----------------------------------------------------------------

const TEST_SESSION_ID = "session-containment-01"
const TEST_ARTIFACT_DIGEST = "artifact-llama-3b"

function makeLease(): LocalPrismComputeLease {
  return createLease({
    sessionId: TEST_SESSION_ID,
    requester: "alice-pubkey",
    membershipId: "membership-01",
    grantId: "grant-01",
    workloadClass: "chat_completion",
    modelArtifactDigest: TEST_ARTIFACT_DIGEST,
    inputDigest: "input-containment-001",
  })
}

/** Walk a lease to a target status using the action-based state machine. */
function walkToRunning(lease: LocalPrismComputeLease): ComputeLeaseStatus {
  const requested = applyLeaseAction(lease.status, "request")
  expect(VALID_LEASE_TRANSITIONS[requested]).toContain("pending_approval")
  const pendingApproval: ComputeLeaseStatus = "pending_approval"
  const approved = applyLeaseAction(pendingApproval, "approve")
  const admitted = applyLeaseAction(approved, "admit")
  return applyLeaseAction(admitted, "start")
}

function makeKvNamespace(leaseId: string): LocalKvNamespace {
  return createKvNamespace({
    sessionId: TEST_SESSION_ID,
    leaseId,
    modelDigest: TEST_ARTIFACT_DIGEST,
    ownerIdentity: "alice-pubkey",
    prefixDigest: "kv-prefix-01",
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Compute Containment", () => {
  // ── Containment Inheritance ────────────────────────────────────────

  test("Prism execution inherits session containment profile", () => {
    // Create a lease with a specific containment level
    const lease = makeLease()

    // Verify default containment level
    expect(lease.requiredContainmentLevel).toBe("standard")

    // Build execution descriptor
    const budget = getDefaultComputeBudget()
    const execution = createExecutionDescriptor({
      lease,
      computeImageDigest: "img-gguf-q4",
      targetSignature: "arm64-macos-default",
      budget,
    })

    // The execution descriptor inherits the containment context from the lease
    expect(execution.containmentContextDigest).toBe("standard")
    expect(execution.containmentContextDigest).toBe(lease.requiredContainmentLevel)

    // Session context is also propagated
    expect(execution.sessionContextDigest).toBe(TEST_SESSION_ID)

    // Create a lease with a strict containment level for comparison
    const strictLease: LocalPrismComputeLease = {
      ...lease,
      requiredContainmentLevel: "strict",
    }
    const strictExecution = createExecutionDescriptor({
      lease: strictLease,
      computeImageDigest: "img-gguf-q4",
      targetSignature: "arm64-macos-default",
      budget,
    })
    expect(strictExecution.containmentContextDigest).toBe("strict")
    expect(strictExecution.containmentContextDigest).not.toBe(
      execution.containmentContextDigest,
    )
  })

  // ── Session Revocation Cancels Execution ──────────────────────────

  test("session revocation cancels active Prism execution", () => {
    const lease = makeLease()

    // Walk lease to running
    const runningStatus = walkToRunning(lease)
    const activeLease: LocalPrismComputeLease = { ...lease, status: runningStatus }
    expect(isActiveLease(activeLease)).toBe(true)
    expect(isTerminalLease(activeLease)).toBe(false)

    // Simulate session revocation by issuing a revoke action
    // "revoke" transitions to "revoked" from any active state
    const revokedStatus = applyLeaseAction(runningStatus, "revoke")
    expect(revokedStatus).toBe("revoked")

    const revokedLease: LocalPrismComputeLease = { ...lease, status: revokedStatus }
    expect(isTerminalLease(revokedLease)).toBe(true)
    expect(isActiveLease(revokedLease)).toBe(false)

    // Verify the execution stage also transitions appropriately
    const executionStage = transitionExecutionStage("decode", "cancel")
    expect(executionStage).toBe("cancelled")
  })

  // ── Sandbox Destruction Invalidates KV ────────────────────────────

  test("sandbox destruction invalidates local KV namespaces", () => {
    // Simulate active KV namespaces for a compute lease
    const ns1 = makeKvNamespace("lease-001")
    const ns2 = makeKvNamespace("lease-001")

    // Both start as allocated
    expect(ns1.state).toBe("allocated")
    expect(ns2.state).toBe("allocated")

    // Simulate priming (normal compute activity)
    const primed1 = { ...ns1, state: applyKvAction(ns1.state, "prime") }
    expect(primed1.state).toBe("primed")

    // Sandbox destruction → invalidate all namespaces
    const invalidated1 = { ...primed1, state: applyKvAction(primed1.state, "invalidate") }
    expect(invalidated1.state).toBe("invalidated")

    // Second namespace — prime it first, then invalidate (allocated → primed → invalidated)
    const primed2 = { ...ns2, state: applyKvAction(ns2.state, "prime") }
    const invalidated2 = { ...primed2, state: applyKvAction(primed2.state, "invalidate") }
    expect(invalidated2.state).toBe("invalidated")

    // Invalidated namespaces can be released cleanly
    const released1 = { ...invalidated1, state: applyKvAction(invalidated1.state, "release") }
    expect(released1.state).toBe("released")

    // Released is terminal (no onward transitions)
    expect(() => applyKvAction(released1.state, "prime")).toThrow()

    // Verify all KV transitions from the state machine are valid per the spec:
    expect(() => applyKvAction("decoding", "sync")).not.toThrow()
    expect(() => applyKvAction("synchronized", "decode")).not.toThrow()
    // Verify invalid transitions throw
    // "allocated" → "decode" is not a valid transition
    expect(() => applyKvAction("allocated", "decode")).toThrow()
    // "primed" → "sync" is not a valid transition
    expect(() => applyKvAction("primed", "sync")).toThrow()
    expect(() => applyKvAction("released", "invalidate")).toThrow()
  })
})
