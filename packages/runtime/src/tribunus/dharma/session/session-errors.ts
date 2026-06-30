/**
 * Dharma Session Authority — Error Types
 */

export class SessionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "SessionError"
    this.code = code
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(sessionId: string) {
    super("SESSION_NOT_FOUND", `Session not found: ${sessionId}`)
  }
}

export class InvalidStateTransitionError extends SessionError {
  constructor(current: string, target: string) {
    super("INVALID_STATE_TRANSITION", `Cannot transition from ${current} to ${target}`)
  }
}

export class MemberNotFoundError extends SessionError {
  constructor(sessionId: string, identity: string) {
    super("MEMBER_NOT_FOUND", `Member ${identity} not found in session ${sessionId}`)
  }
}

export class GrantNotFoundError extends SessionError {
  constructor(grantId: string) {
    super("GRANT_NOT_FOUND", `Grant not found: ${grantId}`)
  }
}

export class CapabilityDeniedError extends SessionError {
  readonly capability: string
  constructor(capability: string, reason: string) {
    super("CAPABILITY_DENIED", `${reason}: ${capability}`)
    this.capability = capability
  }
}

export class ScopeDeniedError extends SessionError {
  readonly target: string
  constructor(target: string, scopeType: string) {
    super("SCOPE_DENIED", `${scopeType} scope denied for: ${target}`)
    this.target = target
  }
}

export class GrantExpiredError extends SessionError {
  constructor(grantId: string) {
    super("GRANT_EXPIRED", `Grant expired: ${grantId}`)
  }
}

export class GrantRevokedError extends SessionError {
  constructor(grantId: string) {
    super("GRANT_REVOKED", `Grant revoked: ${grantId}`)
  }
}

export class KeyEpochMismatchError extends SessionError {
  constructor(expected: number, actual: number) {
    super("KEY_EPOCH_MISMATCH", `Session key epoch mismatch: expected ${expected}, got ${actual}`)
  }
}

export class InvitationExpiredError extends SessionError {
  constructor(invitationId: string) {
    super("INVITATION_EXPIRED", `Invitation expired: ${invitationId}`)
  }
}

export class InvitationInvalidError extends SessionError {
  constructor(reason: string) {
    super("INVITATION_INVALID", reason)
  }
}

export class ApprovalRequiredError extends SessionError {
  constructor(action: string) {
    super("APPROVAL_REQUIRED", `Approval required for: ${action}`)
  }
}

export class SandboxError extends SessionError {
  constructor(message: string, cause?: unknown) {
    super("SANDBOX_ERROR", message)
    this.cause = cause
  }
}

export class WorkspaceConflictError extends SessionError {
  readonly path: string
  constructor(path: string) {
    super("WORKSPACE_CONFLICT", `Workspace conflict at: ${path}`)
    this.path = path
  }
}

export class OwnershipError extends SessionError {
  constructor(message: string) {
    super("OWNERSHIP_ERROR", message)
  }
}

export class ComputeLeaseError extends SessionError {
  constructor(message: string) {
    super("COMPUTE_LEASE_ERROR", message)
  }
}

export class AggregateError extends SessionError {
  constructor(message: string) {
    super("AGGREGATE_ERROR", message)
  }
}
