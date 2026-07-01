export class WorkerError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = "WorkerError"; this.code = code }
}
export class WorkerLifecycleError extends WorkerError {
  constructor(message: string) { super("WORKER_LIFECYCLE_ERROR", message) }
}
export class ModelError extends WorkerError {
  constructor(message: string) { super("MODEL_ERROR", message) }
}
export class RequestAdmissionError extends WorkerError {
  readonly errorCode: string
  constructor(errorCode: string, message: string) { super("REQUEST_ADMISSION_ERROR", message); this.errorCode = errorCode }
}
export class KvEventError extends WorkerError {
  constructor(message: string) { super("KV_EVENT_ERROR", message) }
}
export class ReceiptError extends WorkerError {
  constructor(message: string) { super("RECEIPT_ERROR", message) }
}
export class DrainError extends WorkerError {
  constructor(message: string) { super("DRAIN_ERROR", message) }
}
export class LlmDAdapterError extends WorkerError {
  constructor(message: string) { super("LLMD_ADAPTER_ERROR", message) }
}
export class DharmaCorrelationError extends WorkerError {
  constructor(message: string) { super("DHARMA_CORRELATION_ERROR", message) }
}
