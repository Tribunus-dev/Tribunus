/**
 * Prism llm-d Worker — Types
 */

// ── Worker Lifecycle --------------------------------------------------------

export type WorkerLifecycleState = "starting" | "initializing" | "loading_model" | "ready" | "serving" | "degraded" | "draining" | "stopped" | "failed"

export type WorkerHealthState = "healthy" | "degraded" | "unhealthy" | "draining"

export interface PrismModelWorker {
  workerId: string
  workerInstanceId: string
  workerVersion: string
  protocolVersion: number
  lifecycleState: WorkerLifecycleState
  advertisedModels: string[]
  targetCapabilitySignature: string
  containmentProfileDigest: string | null
  deploymentClass: string
  startedAt: string
}

export interface PrismWorkerCapabilities {
  protocolVersion: number
  supportedWorkloadClasses: string[]
  supportedStreamModes: string[]
  supportedArtifactFormats: string[]
  supportedComputeTargets: string[]
  maximumConcurrentRequests: number
  maximumInputTokens: number
  maximumOutputTokens: number
  supportsCancellation: boolean
  supportsStreaming: boolean
  supportsKvEvents: boolean
  supportsDrain: boolean
  supportsDharmaLeaseCorrelation: boolean
}

// ── Model Artifact ----------------------------------------------------------

export type ModelState = "unavailable" | "admitted" | "loading" | "loaded" | "draining" | "unloading" | "failed" | "revoked"

export interface PrismWorkerModel {
  modelId: string
  artifactDigest: string
  tokenizerDigest: string
  modelFamily: string
  quantizationScheme: string
  artifactAdmissionState: string
  computeImageDigest: string
  targetCapabilitySignature: string
  modelState: ModelState
  loadedAt: string | null
  lastUsedAt: string | null
}

// ── Request -----------------------------------------------------------------

export type RequestWorkloadClass = "chat_completion" | "completion" | "embedding"

export interface PrismWorkerRequest {
  requestId: string
  requestNamespace: string
  modelId: string
  modelArtifactDigest: string
  workloadClass: RequestWorkloadClass
  inputDigest: string
  promptReference: string
  maxInputTokens: number
  maxOutputTokens: number
  samplingPolicy: string
  stream: boolean
  deadlineAt: string | null
  dharmaLeaseId: string | null
  sessionId: string | null
  traceContext: string | null
}

// ── Execution ---------------------------------------------------------------

export type PrefillState = "pending" | "running" | "completed" | "failed" | "cancelled"
export type DecodeState = "pending" | "running" | "streaming" | "completed" | "failed" | "cancelled"

export interface PrismRequestExecution {
  executionId: string
  requestId: string
  modelArtifactDigest: string
  computeImageDigest: string
  targetCapabilitySignature: string
  prefillState: PrefillState
  decodeState: DecodeState
  kvNamespaceId: string | null
  admissionTime: string
  startedAt: string
  completedAt: string | null
}

// ── KV Events ---------------------------------------------------------------

export type KvEventState = "stored" | "touched" | "reused" | "evicted" | "invalidated" | "released"
export type ResidencyLocation = "device_local" | "unified_memory" | "host_memory" | "durable_local_cache"

export interface PrismKvEvent {
  eventId: string
  eventVersion: number
  workerId: string
  workerInstanceId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  requestNamespace: string
  prefixDigest: string
  kvNamespaceId: string
  localityKey: string
  residencyLocation: ResidencyLocation
  residencyTier: string
  byteCount: number
  tokenCount: number | null
  state: KvEventState
  emittedAt: string
}

export interface PrismKvEventBatch {
  workerId: string
  sequenceNumber: number
  emittedAt: string
  events: PrismKvEvent[]
}

// ── Usage Receipt -----------------------------------------------------------

export interface PrismWorkerUsageReceipt {
  receiptId: string
  requestId: string
  dharmaLeaseId: string | null
  sessionId: string | null
  workerId: string
  workerInstanceId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  computeImageDigest: string
  targetCapabilitySignature: string
  workloadClass: string
  inputDigest: string
  outputDigest: string | null
  inputTokenCount: number | null
  outputTokenCount: number | null
  prefillDurationMs: number | null
  decodeDurationMs: number | null
  totalDurationMs: number
  peakMemoryBytes: number | null
  kvCacheStatus: string | null
  executionState: string
  failureClass: string | null
  emittedAt: string
  workerSignature: string
}

// ── Dharma Correlation ------------------------------------------------------

export interface DharmaWorkerCorrelation {
  dharmaLeaseId: string
  sessionId: string
  requesterIdentityDigest: string
  disclosureClass: string
  resultBundleId: string | null
}

// ── OpenAI-Compatible Error Codes -------------------------------------------

export type WorkerErrorCode =
  | "model_not_loaded" | "artifact_not_admitted" | "worker_draining"
  | "worker_overloaded" | "request_cancelled" | "request_timeout"
  | "input_too_large" | "output_budget_exceeded"
  | "compute_image_unavailable" | "backend_execution_failed"

// ── Metrics Names -----------------------------------------------------------

export const WORKER_METRICS = [
  "prism_worker_up", "prism_worker_ready",
  "prism_worker_requests_total", "prism_worker_requests_inflight",
  "prism_worker_request_failures_total", "prism_worker_request_cancellations_total",
  "prism_worker_prefill_duration_seconds", "prism_worker_decode_duration_seconds",
  "prism_worker_end_to_end_duration_seconds",
  "prism_worker_input_tokens_total", "prism_worker_output_tokens_total",
  "prism_worker_kv_events_total", "prism_worker_kv_bytes",
  "prism_worker_kv_cache_hits_total", "prism_worker_kv_cache_misses_total",
  "prism_worker_model_load_duration_seconds", "prism_worker_model_load_failures_total",
  "prism_worker_compute_image_load_duration_seconds",
  "prism_worker_drain_state", "prism_worker_usage_receipts_total",
] as const
