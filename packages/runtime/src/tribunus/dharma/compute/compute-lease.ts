/**
 * Dharma Local Prism Compute Lease — Lifecycle State Machine
 *
 * Pure functions for lease creation, state transitions, and status queries.
 * No side effects, no persistence.
 */

import type {
  ComputeLeaseStatus,
  ComputeWorkloadClass,
  LocalPrismComputeLease,
} from "./compute-types.ts"

// ── Lease Actions -----------------------------------------------------------

export type LeaseAction =
  | "request"
  | "approve"
  | "reject"
  | "admit"
  | "start"
  | "stream"
  | "complete"
  | "fail"
  | "cancel"
  | "expire"
  | "revoke"

// ── Valid Transition Table ---------------------------------------------------

export const VALID_LEASE_TRANSITIONS: Record<ComputeLeaseStatus, readonly ComputeLeaseStatus[]> = {
  draft: ["requested"],
  requested: ["pending_approval", "rejected"],
  pending_approval: ["approved", "rejected"],
  approved: ["admitted", "expired"],
  admitted: ["running", "failed"],
  running: ["streaming", "completed", "cancelled", "failed"],
  streaming: ["completed", "cancelled", "failed"],
  completed: [],
  rejected: [],
  expired: [],
  failed: [],
  cancelled: [],
  revoked: [],
}

// ── Action → Status mapping -------------------------------------------------

const ACTION_NEXT: Record<LeaseAction, ComputeLeaseStatus> = {
  request: "requested",
  approve: "approved",
  reject: "rejected",
  admit: "admitted",
  start: "running",
  stream: "streaming",
  complete: "completed",
  fail: "failed",
  cancel: "cancelled",
  expire: "expired",
  revoke: "revoked",
}

// ── Action eligibility per status -------------------------------------------

const ACTION_FROM: Record<LeaseAction, readonly ComputeLeaseStatus[]> = {
  request: ["draft"],
  approve: ["pending_approval"],
  reject: ["requested", "pending_approval"],
  admit: ["approved"],
  start: ["admitted"],
  stream: ["running"],
  complete: ["running", "streaming"],
  fail: ["admitted", "running", "streaming"],
  cancel: ["running", "streaming"],
  expire: ["approved"],
  revoke: ["draft", "requested", "pending_approval", "approved", "admitted", "running", "streaming"],
}

// ── State transit ----------------------------------------------------------

/**
 * Apply a lease action to the current status.
 * Throws if the transition is not valid per the state machine.
 */
export function applyLeaseAction(
  current: ComputeLeaseStatus,
  action: LeaseAction,
): ComputeLeaseStatus {
  const allowedSources = ACTION_FROM[action]
  if (!allowedSources || !allowedSources.some((s) => s === current)) {
    throw new Error(
      `Invalid lease action "${action}" from status "${current}". ` +
        `Allowed source statuses: [${allowedSources?.join(", ") ?? "none"}]`,
    )
  }
  return ACTION_NEXT[action]
}

// ── Create lease ------------------------------------------------------------

const DEFAULT_MAX_RUNTIME_SECONDS = 300
const DEFAULT_MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

/**
 * Create a new LocalPrismComputeLease in "draft" status.
 * Fields NOT in `config` are set to sensible defaults or null.
 */
export function createLease(config: {
  sessionId: string
  requester: string
  membershipId: string
  grantId: string
  workloadClass: ComputeWorkloadClass
  modelArtifactDigest: string
  inputDigest: string
}): LocalPrismComputeLease {
  const now = new Date().toISOString()

  return {
    leaseId: "",
    sessionId: config.sessionId,
    taskId: null,
    requesterIdentityPublicKey: config.requester,
    requesterMembershipId: config.membershipId,
    approvingIdentityPublicKey: null,
    grantId: config.grantId,
    sessionKeyEpoch: 0,
    backendKind: "prism_local",
    workloadClass: config.workloadClass,
    modelArtifactDigest: config.modelArtifactDigest,
    computeImagePolicyDigest: "",
    inputDisclosureClass: "local_private",
    inputDigest: config.inputDigest,
    inputReference: null,
    outputDisclosureClass: "local_private",
    requestedMaxTokens: null,
    requestedMaxRuntimeSeconds: DEFAULT_MAX_RUNTIME_SECONDS,
    requestedMaxMemoryBytes: DEFAULT_MAX_MEMORY_BYTES,
    requestedMaxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    requestedMaxGpuTimeMs: null,
    requiredContainmentLevel: "standard",
    approvalPolicy: "auto",
    status: "draft",
    issuedAt: now,
    expiresAt: null,
    revokedAt: null,
    cancellationReason: null,
    signatureChain: "",
  }
}

// ── Terminal / Active lookup -------------------------------------------------

const TERMINAL: Partial<Record<ComputeLeaseStatus, true | undefined>> = {
  completed: true, rejected: true, expired: true, failed: true, cancelled: true, revoked: true,
}

const ACTIVE: Partial<Record<ComputeLeaseStatus, true | undefined>> = {
  requested: true, pending_approval: true, approved: true, admitted: true, running: true, streaming: true,
}

/**
 * Returns true if the lease is in a terminal (final) status.
 */
export function isTerminalLease(lease: LocalPrismComputeLease): boolean {
  return TERMINAL[lease.status] === true
}

/**
 * Returns true if the lease is currently active (in progress, not terminal and not draft).
 */
export function isActiveLease(lease: LocalPrismComputeLease): boolean {
  return ACTIVE[lease.status] === true
}
