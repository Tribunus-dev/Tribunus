/**
 * Dharma OS-Enforced Sandbox — Error Types
 */

export class ContainmentError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "ContainmentError"
    this.code = code
  }
}

export class FilesystemEscapeError extends ContainmentError {
  readonly attemptedPath: string
  constructor(path: string) {
    super("FILESYSTEM_ESCAPE", `Filesystem escape attempt: ${path}`)
    this.attemptedPath = path
  }
}

export class NetworkDeniedError extends ContainmentError {
  constructor(detail: string) {
    super("NETWORK_DENIED", `Network access denied: ${detail}`)
  }
}

export class SecretExposureError extends ContainmentError {
  readonly variable: string
  constructor(variable: string) {
    super("SECRET_EXPOSURE", `Secret variable would leak: ${variable}`)
    this.variable = variable
  }
}

export class ResourceLimitExceededError extends ContainmentError {
  readonly limit: string
  constructor(limit: string, value: number) {
    super("RESOURCE_LIMIT_EXCEEDED", `${limit} limit exceeded: ${value}`)
    this.limit = limit
  }
}

export class ProcessSpawnDeniedError extends ContainmentError {
  constructor(reason: string) {
    super("PROCESS_SPAWN_DENIED", reason)
  }
}

export class IpcDeniedError extends ContainmentError {
  constructor(detail: string) {
    super("IPC_DENIED", `IPC access denied: ${detail}`)
  }
}

export class BackendUnavailableError extends ContainmentError {
  readonly backend: string
  constructor(backend: string, reason: string) {
    super("BACKEND_UNAVAILABLE", `Backend ${backend} unavailable: ${reason}`)
    this.backend = backend
  }
}

export class TerminationError extends ContainmentError {
  constructor(message: string) {
    super("TERMINATION_ERROR", message)
  }
}

export class CapabilityDetectionError extends ContainmentError {
  constructor(message: string) {
    super("CAPABILITY_DETECTION_ERROR", message)
  }
}
