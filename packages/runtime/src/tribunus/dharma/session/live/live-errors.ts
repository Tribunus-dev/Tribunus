/**
 * Dharma Live Sandbox — Error Types
 */

export class LiveSandboxError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "LiveSandboxError"
    this.code = code
  }
}

export class MaterializationError extends LiveSandboxError {
  constructor(message: string, cause?: unknown) {
    super("MATERIALIZATION_ERROR", message)
    this.cause = cause
  }
}

export class DigestMismatchError extends LiveSandboxError {
  constructor(expected: string, actual: string) {
    super("DIGEST_MISMATCH", `Expected digest ${expected}, got ${actual}`)
  }
}

export class PathEscapeError extends LiveSandboxError {
  readonly attemptedPath: string
  constructor(path: string) {
    super("PATH_ESCAPE", `Path escape attempt: ${path}`)
    this.attemptedPath = path
  }
}

export class ScopeViolationError extends LiveSandboxError {
  readonly target: string
  constructor(target: string, scopeType: string) {
    super("SCOPE_VIOLATION", `${scopeType} violation: ${target}`)
    this.target = target
  }
}

export class PatchValidationError extends LiveSandboxError {
  constructor(reason: string) {
    super("PATCH_VALIDATION_ERROR", reason)
  }
}

export class PatchConflictError extends LiveSandboxError {
  constructor(path: string) {
    super("PATCH_CONFLICT", `Patch conflicts at: ${path}`)
  }
}

export class ProcessExecutionError extends LiveSandboxError {
  constructor(command: string, reason: string) {
    super("PROCESS_EXECUTION_ERROR", `Cannot execute "${command}": ${reason}`)
  }
}

export class NetworkDeniedError extends LiveSandboxError {
  constructor(domain: string) {
    super("NETWORK_DENIED", `Network access denied: ${domain}`)
  }
}

export class OutputLimitError extends LiveSandboxError {
  readonly limit: number
  constructor(limit: number) {
    super("OUTPUT_LIMIT_EXCEEDED", `Output exceeded ${limit} bytes`)
    this.limit = limit
  }
}

export class TransportError extends LiveSandboxError {
  constructor(message: string) {
    super("TRANSPORT_ERROR", message)
  }
}

export class RecoveryError extends LiveSandboxError {
  constructor(message: string) {
    super("RECOVERY_ERROR", message)
  }
}

export class ArtifactError extends LiveSandboxError {
  constructor(message: string) {
    super("ARTIFACT_ERROR", message)
  }
}
