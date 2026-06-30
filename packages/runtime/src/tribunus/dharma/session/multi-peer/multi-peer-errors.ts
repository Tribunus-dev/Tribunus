export class MultiPeerError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = "MultiPeerError"; this.code = code }
}
export class TaskError extends MultiPeerError {
  constructor(message: string) { super("TASK_ERROR", message) }
}
export class ClaimError extends MultiPeerError {
  constructor(message: string) { super("CLAIM_ERROR", message) }
}
export class SourcePackageError extends MultiPeerError {
  constructor(message: string) { super("SOURCE_PACKAGE_ERROR", message) }
}
export class ResultValidationError extends MultiPeerError {
  constructor(message: string) { super("RESULT_VALIDATION_ERROR", message) }
}
export class ConflictError extends MultiPeerError {
  readonly conflictId: string
  constructor(conflictId: string, message: string) { super("CONFLICT_ERROR", message); this.conflictId = conflictId }
}
export class ArtifactAccessError extends MultiPeerError {
  constructor(message: string) { super("ARTIFACT_ACCESS_ERROR", message) }
}
export class CanonicalOutcomeError extends MultiPeerError {
  constructor(message: string) { super("CANONICAL_OUTCOME_ERROR", message) }
}
