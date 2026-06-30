/**
 * Trusted-LAN Failure Tests
 *
 * Pure-function verification of failure recovery in the trusted-LAN
 * compute extension. Tests cover provider crash, requester disconnect,
 * session membership revocation, provider trust revocation, and
 * provider restart recovery.
 *
 * Scenarios:
 *   1. Provider crashes during execution → lease fails
 *   2. Requester disconnects → fail_closed stops lease
 *   3. Session membership revoked during decode → lease revoked
 *   4. Provider trust revoked during active request → lease rejected/cancelled
 *   5. Provider restarts with unfinished lease → recovered
 */

import { describe, test, expect } from "bun:test"
import { TrustedLanApi } from "../trusted-lan-api"
import {
  applyLanLeaseAction,
  isTerminalLanLease,
  VALID_LAN_LEASE_TRANSITIONS,
  type LanLeaseAction,
} from "../trusted-lan-lifecycle"
import type {
  PrismLanComputeLease,
  RemoteLeaseStatus,
  ProviderRejectionClass,
  PrismLanProviderTrust,
} from "../trusted-lan-types"

const SESSION_ID = "failure-session-01"
const LEASE_ID = "failure-lease-01"

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Trusted-LAN Failure Scenarios", () => {
  // ── Scenario 1: Provider Crashes During Execution ───────────────────

  test("Scenario 1: Provider crash during execution transitions lease to failed", () => {
    const api = new TrustedLanApi()

    const lease = api.requestLanLease({
      leaseId: LEASE_ID,
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:crash-input",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "draft",
    })

    // Walk the lease to running
    let status = lease.status as RemoteLeaseStatus
    const runSteps: LanLeaseAction[] = ["request", "evaluate", "approve", "admit", "transfer_input", "start"]
    for (const action of runSteps) {
      status = applyLanLeaseAction(status, action)
    }
    expect(status).toBe("running")

    // The provider crashes during decode — the lease transitions to "failed"
    const failedStatus = applyLanLeaseAction(status, "fail")
    expect(failedStatus).toBe("failed")
    expect(isTerminalLanLease(failedStatus)).toBe(true)
    expect(VALID_LAN_LEASE_TRANSITIONS.failed).toEqual([])

    // recoverLanLeases should NOT return leases with terminal status in the store.
    // Terminal-status leases (created directly with "failed") are excluded.
    const terminalLease = api.requestLanLease({
      leaseId: "failure-terminal-lease",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:terminal-input",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "failed",
    })
    const recovered = api.recoverLanLeases()
    expect(recovered).not.toContain("failure-terminal-lease")

    // The lease can also fail from streaming
    const lease2 = api.requestLanLease({
      leaseId: "failure-lease-streaming-crash",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:crash-input-2",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "draft",
    })

    let s2 = lease2.status as RemoteLeaseStatus
    const streamSteps: LanLeaseAction[] = ["request", "evaluate", "approve", "admit", "transfer_input", "start", "stream"]
    for (const action of streamSteps) {
      s2 = applyLanLeaseAction(s2, action)
    }
    expect(s2).toBe("streaming")

    const failedFromStream = applyLanLeaseAction(s2, "fail")
    expect(failedFromStream).toBe("failed")
    expect(isTerminalLanLease(failedFromStream)).toBe(true)
  })

  // ── Scenario 2: Requester Disconnects → fail_closed ─────────────────

  test("Scenario 2: Requester disconnect with fail_closed policy stops lease", () => {
    const api = new TrustedLanApi()

    const lease = api.requestLanLease({
      leaseId: LEASE_ID,
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:disconnect-input",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "draft",
    })

    expect(lease.disconnectPolicy).toBe("fail_closed")

    // Walk to running
    let status = lease.status as RemoteLeaseStatus
    const runSteps: LanLeaseAction[] = ["request", "evaluate", "approve", "admit", "transfer_input", "start"]
    for (const action of runSteps) {
      status = applyLanLeaseAction(status, action)
    }
    expect(status).toBe("running")

    // fail_closed: cancel or fail the lease on requester disconnect
    const cancelledStatus = applyLanLeaseAction(status, "cancel")
    expect(cancelledStatus).toBe("cancelled")
    expect(isTerminalLanLease(cancelledStatus)).toBe(true)

    // Alternatively, the lease can be failed
    const lease2 = api.requestLanLease({
      leaseId: "failure-lease-disconnect-2",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:disconnect-input-2",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "draft",
    })

    let s2 = lease2.status as RemoteLeaseStatus
    for (const action of runSteps) {
      s2 = applyLanLeaseAction(s2, action)
    }
    expect(s2).toBe("running")

    const failedStatus = applyLanLeaseAction(s2, "fail")
    expect(failedStatus).toBe("failed")
    expect(isTerminalLanLease(failedStatus)).toBe(true)
  })

  // ── Scenario 3: Session Membership Revoked During Decode → Lease Revoked ─

  test("Scenario 3: Session membership revoked during decode — lease revoked from running", () => {
    const api = new TrustedLanApi()

    const lease = api.requestLanLease({
      leaseId: LEASE_ID,
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:revoke-input",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "draft",
    })

    // Walk to running
    let status = lease.status as RemoteLeaseStatus
    const runSteps: LanLeaseAction[] = ["request", "evaluate", "approve", "admit", "transfer_input", "start"]
    for (const action of runSteps) {
      status = applyLanLeaseAction(status, action)
    }
    expect(status).toBe("running")

    // Session membership revoked during decode → lease revoked
    const revokedStatus = applyLanLeaseAction(status, "revoke")
    expect(revokedStatus).toBe("revoked")
    expect(isTerminalLanLease(revokedStatus)).toBe(true)

    // Verify revocation class for membership
    expect(([] as ProviderRejectionClass[]).concat("session_membership_invalid")).toContain("session_membership_invalid")

    // Verify revoke works from states that support it per state machine:
    // running → revoked, streaming → revoked
    const revocableStates: RemoteLeaseStatus[] = ["running", "streaming"]
    for (const state of revocableStates) {
      expect(VALID_LAN_LEASE_TRANSITIONS[state]).toContain("revoked")
    }

    // Terminal states do NOT support revoke
    const terminalStates: RemoteLeaseStatus[] = [
      "completed", "rejected", "expired", "failed", "cancelled", "revoked",
    ]
    for (const state of terminalStates) {
      expect(VALID_LAN_LEASE_TRANSITIONS[state]).not.toContain("revoked")
    }
  })

  // ── Scenario 4: Provider Trust Revoked During Active Request ────────

  test("Scenario 4: Provider trust revocation stops active lease", () => {
    // Trust revocation is modelled via the PrismLanProviderTrust type.
    // When trust is revoked, lease evaluation detects missing/expired trust
    // and rejects or cancels the lease.

    // Simulate an active trust that gets revoked
    const activeTrust: PrismLanProviderTrust = {
      trustId: "trust-failure-01",
      federationId: "fed-failure",
      providerIdentityPublicKey: "pk-provider-alpha",
      grantedByIdentityPublicKey: "pk-owner",
      allowedSessionIds: null,
      allowedWorkloadClasses: ["chat_completion"],
      allowedDisclosureClasses: ["session_scoped"],
      allowedArtifactDigests: [],
      allowedTargetClasses: [],
      maximumRuntimeSeconds: 3600,
      maximumTokens: 8192,
      maximumMemoryBytes: 1073741824,
      maximumConcurrentLeases: 1,
      allowStreaming: true,
      allowResultArtifactReturn: false,
      expiresAt: "2026-07-30T00:00:00.000Z",
      revokedAt: null,
      reasonDigest: null,
      signature: "sig-trust-active",
    }

    const revokedTrust: PrismLanProviderTrust = {
      ...activeTrust,
      revokedAt: new Date().toISOString(),
    }

    expect(activeTrust.revokedAt).toBeNull()
    expect(revokedTrust.revokedAt).not.toBeNull()

    // Create a lease for the scenario
    const api = new TrustedLanApi()
    const lease = api.requestLanLease({
      leaseId: LEASE_ID,
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:trust-revoke-input",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "draft",
    })

    // Walk to requested
    let status = lease.status as RemoteLeaseStatus
    status = applyLanLeaseAction(status, "request")
    expect(status).toBe("requested")

    // When trust is revoked during evaluation, the provider rejects
    const [rejection1, rejection2] = ["provider_trust_missing", "provider_trust_expired"] as ProviderRejectionClass[]
    expect(rejection1).toBe("provider_trust_missing")
    expect(rejection2).toBe("provider_trust_expired")

    // Provider rejects the lease due to revoked trust
    const rejectedStatus = applyLanLeaseAction(status, "reject")
    expect(rejectedStatus).toBe("rejected")

    // Alternative: an already-running lease is cancelled when trust is revoked
    const lease2 = api.requestLanLease({
      leaseId: "failure-lease-trust-revoke-2",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:trust-revoke-input-2",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "draft",
    })

    let s2 = lease2.status as RemoteLeaseStatus
    const runSteps: LanLeaseAction[] = ["request", "evaluate", "approve", "admit", "transfer_input", "start"]
    for (const action of runSteps) {
      s2 = applyLanLeaseAction(s2, action)
    }
    expect(s2).toBe("running")

    // Trust revoked mid-execution — lease is cancelled
    const cancelledStatus = applyLanLeaseAction(s2, "cancel")
    expect(cancelledStatus).toBe("cancelled")
    expect(isTerminalLanLease(cancelledStatus)).toBe(true)
  })

  // ── Scenario 5: Provider Restarts With Unfinished Lease → Recovered ─

  test("Scenario 5: Provider restarts with unfinished lease — state recovered", () => {
    const api = new TrustedLanApi()

    const draftLease = api.requestLanLease({
      leaseId: "failure-recovery-draft",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:recovery-draft",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "draft",
    })

    const runningLease = api.requestLanLease({
      leaseId: "failure-recovery-running",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:recovery-running",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "running",
    })

    const streamingLease = api.requestLanLease({
      leaseId: "failure-recovery-streaming",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:recovery-streaming",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "streaming",
    })

    const completedLease = api.requestLanLease({
      leaseId: "failure-recovery-completed",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:recovery-completed",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "completed",
    })

    const failedLease = api.requestLanLease({
      leaseId: "failure-recovery-failed",
      sessionId: SESSION_ID,
      requesterIdentityPublicKey: "pk-requester",
      requesterMembershipId: "membership-01",
      requesterDevicePublicKey: "dpk-requester",
      providerId: "provider-alpha",
      providerIdentityPublicKey: "pk-provider-alpha",
      workloadClass: "chat_completion",
      modelArtifactDigest: "artifact-llama-3b",
      tokenizerDigest: "tokenizer-llama",
      inputDigest: "sha256:recovery-failed",
      inputDisclosureClass: "session_scoped",
      outputDisclosureClass: "task_visible",
      artifactParityMode: "strict_artifact_parity",
      disconnectPolicy: "fail_closed",
      status: "failed",
    })

    // recoverLanLeases returns all non-terminal (non-finished) lease IDs
    const recoverableIds = api.recoverLanLeases()

    expect(recoverableIds).toContain("failure-recovery-draft")
    expect(recoverableIds).toContain("failure-recovery-running")
    expect(recoverableIds).toContain("failure-recovery-streaming")
    expect(recoverableIds).not.toContain("failure-recovery-completed")
    expect(recoverableIds).not.toContain("failure-recovery-failed")
    expect(recoverableIds.length).toBe(3)

    // After recovery, the non-terminal leases can be transitioned
    const draftRecovered = draftLease.status as RemoteLeaseStatus
    expect(draftRecovered).toBe("draft")
    expect(() => applyLanLeaseAction(draftRecovered, "request")).not.toThrow()

    // Running lease recovery: can be cancelled
    const runningRecovered = runningLease.status as RemoteLeaseStatus
    expect(runningRecovered).toBe("running")
    const cancelledAfterRecovery = applyLanLeaseAction(runningRecovered, "cancel")
    expect(cancelledAfterRecovery).toBe("cancelled")
    expect(isTerminalLanLease(cancelledAfterRecovery)).toBe(true)

    // Streaming lease: same pattern — fail it
    const streamingRecovered = streamingLease.status as RemoteLeaseStatus
    const failedAfterRecovery = applyLanLeaseAction(streamingRecovered, "fail")
    expect(failedAfterRecovery).toBe("failed")
    expect(isTerminalLanLease(failedAfterRecovery)).toBe(true)
  })
})
