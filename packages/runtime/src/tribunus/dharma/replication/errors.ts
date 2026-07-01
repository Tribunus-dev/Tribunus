/**
 * Dharma Replication — Error Types
 */

export class ReplicationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "ReplicationError"
    this.code = code
  }
}

export class CorestoreError extends ReplicationError {
  constructor(message: string, cause?: unknown) {
    super("CORESTORE_ERROR", message)
    this.cause = cause
  }
}

export class AutobaseError extends ReplicationError {
  constructor(message: string, cause?: unknown) {
    super("AUTOBASE_ERROR", message)
    this.cause = cause
  }
}

export class SwarmError extends ReplicationError {
  constructor(message: string, cause?: unknown) {
    super("SWARM_ERROR", message)
    this.cause = cause
  }
}

export class HandshakeError extends ReplicationError {
  constructor(message: string) {
    super("HANDSHAKE_ERROR", message)
  }
}

export class InvitationError extends ReplicationError {
  constructor(message: string) {
    super("INVITATION_ERROR", message)
  }
}

export class OutboxError extends ReplicationError {
  constructor(message: string) {
    super("OUTBOX_ERROR", message)
  }
}

export class ImporterError extends ReplicationError {
  constructor(message: string, cause?: unknown) {
    super("IMPORTER_ERROR", message)
    this.cause = cause
  }
}

export class QuotaExceededError extends ReplicationError {
  readonly limit: string
  constructor(limit: string, message: string) {
    super("QUOTA_EXCEEDED", message)
    this.limit = limit
  }
}
