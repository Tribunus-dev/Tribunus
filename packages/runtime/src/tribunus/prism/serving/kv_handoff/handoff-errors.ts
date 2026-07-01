export class HandoffError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = "HandoffError"; this.code = code }
}
export class HandoffAuthorizationError extends HandoffError {
  constructor(message: string) { super("HANDOFF_AUTHORIZATION_ERROR", message) }
}
export class SourceExportError extends HandoffError {
  readonly rejectionClass: string
  constructor(cls: string, message: string) { super("SOURCE_EXPORT_ERROR", message); this.rejectionClass = cls }
}
export class DestinationImportError extends HandoffError {
  readonly rejectionClass: string
  constructor(cls: string, message: string) { super("DESTINATION_IMPORT_ERROR", message); this.rejectionClass = cls }
}
export class CompatibilityError extends HandoffError {
  constructor(message: string) { super("COMPATIBILITY_ERROR", message) }
}
export class ManifestError extends HandoffError {
  constructor(message: string) { super("MANIFEST_ERROR", message) }
}
export class TransportError extends HandoffError {
  constructor(message: string) { super("TRANSPORT_ERROR", message) }
}
export class CommitError extends HandoffError {
  constructor(message: string) { super("COMMIT_ERROR", message) }
}
export class RollbackError extends HandoffError {
  constructor(message: string) { super("ROLLBACK_ERROR", message) }
}
export class HandoffCancellationError extends HandoffError {
  constructor(message: string) { super("HANDOFF_CANCELLATION_ERROR", message) }
}
