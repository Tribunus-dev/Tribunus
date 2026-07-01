/**
 * Dharma Session Authority — Command Request/Receipt Model & Approval Flow
 *
 * Pure functions for creating and transitioning command requests, receipts,
 * and approval requirements within the session authority model.
 */

import type {
  SessionCommandRequest,
  SessionCommandReceipt,
  CommandKind,
  CommandDecision,
  Capability,
  ApprovalRequirement,
  ApprovalStatus,
} from "./types"

// ── Constants ──────────────────────────────────────────────

/**
 * Map CommandKind to the primary Capability required.
 */
export const COMMAND_TO_REQUIRED_CAPABILITY: Record<CommandKind, Capability> = {
  inspect_workspace: "workspace.read",
  read_file: "workspace.read",
  write_file: "workspace.write",
  apply_patch: "workspace.apply_patch",
  create_overlay: "workspace.create_file",
  merge_overlay: "workspace.merge_overlay",
  discard_overlay: "workspace.revert_own_changes",
  execute_command: "terminal.execute_safe",
  terminate_command: "terminal.execute_safe",
  request_compute_lease: "compute.request_local",
  approve_compute_lease: "compute.approve_lease",
  cancel_compute_lease: "compute.cancel_lease",
  invite_participant: "session.invite_peer",
  revoke_grant: "session.modify_grants",
  request_escalation: "agent.request_escalation",
  approve_escalation: "session.modify_grants",
  seal_session: "session.seal",
  export_artifact: "session.export_artifacts",
}

/** Every valid command kind. */
export const VALID_COMMAND_KINDS: readonly CommandKind[] = [
  "inspect_workspace",
  "read_file",
  "write_file",
  "apply_patch",
  "create_overlay",
  "merge_overlay",
  "discard_overlay",
  "execute_command",
  "terminate_command",
  "request_compute_lease",
  "approve_compute_lease",
  "cancel_compute_lease",
  "invite_participant",
  "revoke_grant",
  "request_escalation",
  "approve_escalation",
  "seal_session",
  "export_artifact",
] as const

/**
 * Valid approval-status transitions.
 * Key = current status, value = allowed next statuses.
 */
export const APPROVAL_STATUS_TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  pending:   ["approved", "rejected", "expired"],
  approved:  ["executed", "revoked"],
  executed:  [],
  rejected:  [],
  expired:   [],
  revoked:   [],
} as const

// ── Command Request ────────────────────────────────────────

/**
 * Create a new command request with defaults for omitted fields.
 *
 * Generates a random request ID and ISO timestamp.  If no `idempotencyKey`
 * is supplied a UUID is generated.
 */
export function createCommandRequest(config: {
  sessionId: string
  actorIdentityPublicKey: string
  actorMembershipId: string
  grantId: string
  sessionKeyEpoch: number
  commandKind: CommandKind
  targetScope?: string
  payloadDigest: string
  idempotencyKey?: string
}): SessionCommandRequest {
  const idempotencyKey = config.idempotencyKey ?? crypto.randomUUID()

  return {
    requestId: crypto.randomUUID(),
    sessionId: config.sessionId,
    actorIdentityPublicKey: config.actorIdentityPublicKey,
    actorMembershipId: config.actorMembershipId,
    grantId: config.grantId,
    sessionKeyEpoch: config.sessionKeyEpoch,
    commandKind: config.commandKind,
    targetScope: config.targetScope ?? "",
    payloadDigest: config.payloadDigest,
    payloadReference: null,
    idempotencyKey,
    requestedAt: new Date().toISOString(),
    signature: "",
  }
}

// ── Command Receipt ────────────────────────────────────────

/**
 * Create a command receipt with the given parameters.
 */
export function createCommandReceipt(
  request: SessionCommandRequest,
  decision: CommandDecision,
  overrides?: Partial<SessionCommandReceipt>,
): SessionCommandReceipt {
  return {
    receiptId: crypto.randomUUID(),
    requestId: request.requestId,
    sessionId: request.sessionId,
    actorIdentityPublicKey: request.actorIdentityPublicKey,
    decision,
    denialReason: null,
    authorityEvaluationDigest: null,
    executionId: null,
    workspaceBeforeDigest: null,
    workspaceAfterDigest: null,
    outputDigest: null,
    artifactDigest: null,
    computeLeaseId: null,
    createdAt: new Date().toISOString(),
    finalizedAt: null,
    controllerSignature: "",
    ...overrides,
  }
}

// ── Approval Requirement ───────────────────────────────────

/**
 * Create an approval-requirement record with smart defaults.
 *
 * - `requiredApprovalCount` defaults to 1.
 * - `scope` defaults to the empty string.
 * - `status` starts at "pending".
 * - `expiresAt` defaults to 1 hour from now.
 */
export function createApprovalRequirement(config: {
  sessionId: string
  requestId: string
  requestedByIdentity: string
  requiredApproverRoles: string[]
  requiredApprovalCount?: number
  scope?: string
  expiresAt?: string
}): ApprovalRequirement {
  const now = new Date()
  const expiresAt = config.expiresAt ?? new Date(now.getTime() + 3_600_000).toISOString()

  return {
    approvalId: crypto.randomUUID(),
    sessionId: config.sessionId,
    requestId: config.requestId,
    requestedByIdentity: config.requestedByIdentity,
    requiredApproverRoles: config.requiredApproverRoles,
    requiredApprovalCount: config.requiredApprovalCount ?? 1,
    scope: config.scope ?? "",
    expiresAt,
    status: "pending",
  }
}

// ── Approval Guard ─────────────────────────────────────────

/**
 * Return `true` when a command kind appears in the supplied sensitive kinds.
 */
export function isApprovalRequired(
  commandKind: CommandKind,
  sensitiveKinds: CommandKind[],
): boolean {
  return sensitiveKinds.includes(commandKind)
}

// ── Approval Status Machine ────────────────────────────────

/**
 * Transition an approval status to a new status.
 *
 * Returns `undefined` when the transition is not allowed by the state machine.
 */
export function transitionApprovalStatus(
  current: ApprovalStatus,
  action: "approve" | "reject" | "expire" | "revoke" | "execute",
): ApprovalStatus | undefined {
  const allowed = APPROVAL_STATUS_TRANSITIONS[current]

  const actionToStatus: Record<string, ApprovalStatus> = {
    approve: "approved",
    reject:  "rejected",
    expire:  "expired",
    revoke:  "revoked",
    execute: "executed",
  }

  const target = actionToStatus[action]
  if (!target) return undefined
  if (!allowed.includes(target)) return undefined

  return target
}

// ── Idempotency ────────────────────────────────────────────

/** Return the idempotency key of a command request. */
export function getIdempotencyKey(request: SessionCommandRequest): string {
  return request.idempotencyKey
}

// ── Decision Helpers ───────────────────────────────────────

/**
 * Check whether a command decision is final and no longer mutable.
 */
export function isFinalDecision(decision: CommandDecision): boolean {
  return (
    decision === "completed" ||
    decision === "failed" ||
    decision === "cancelled" ||
    decision === "revoked"
  )
}
