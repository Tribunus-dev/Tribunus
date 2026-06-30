/**
 * Prism llm-d Worker — Barrel
 *
 * Re-exports all public symbols from every serving module.
 */

// ── Foundation ────────────────────────────────────────────────────────────────

export type { PrismModelWorker, PrismWorkerCapabilities } from "./worker-types"
export type {
  WorkerLifecycleState,
  WorkerHealthState,
  ModelState,
  RequestWorkloadClass,
  PrismWorkerModel,
  PrismWorkerRequest,
  PrefillState,
  DecodeState,
  PrismRequestExecution,
  KvEventState,
  ResidencyLocation,
  PrismKvEvent,
  PrismKvEventBatch,
  PrismWorkerUsageReceipt,
  DharmaWorkerCorrelation,
  WorkerErrorCode,
} from "./worker-types"
export { WORKER_METRICS } from "./worker-types"

export {
  WorkerError,
  WorkerLifecycleError,
  ModelError,
  RequestAdmissionError,
  KvEventError,
  ReceiptError,
  DrainError,
  LlmDAdapterError,
  DharmaCorrelationError,
} from "./worker-errors"

export {
  applyWorkerAction,
  applyModelAction,
  canAcceptRequests,
  VALID_WORKER_TRANSITIONS,
  VALID_MODEL_TRANSITIONS,
  VALID_HEALTH_TRANSITIONS,
} from "./worker-lifecycle"
export type { WorkerAction, ModelAction } from "./worker-lifecycle"

// ── Worker Protocol ───────────────────────────────────────────────────────────

export type { PrismWorkerProtocol } from "./worker-api"

// ── Request Admission ─────────────────────────────────────────────────────────

export type { AdmissionResult } from "./worker-admission"
export {
  evaluateAdmission,
  checkWorkerState,
  checkModelLoaded,
  checkTokenBudget,
  checkConcurrency,
  checkDeadline,
} from "./worker-admission"

// ── Model Registry ────────────────────────────────────────────────────────────

export {
  createModelEntry,
  loadModel,
  completeLoad,
  failModel,
  unloadModel,
  revokeModel,
  isModelReady,
} from "./worker-model-registry"

// ── Request Store ─────────────────────────────────────────────────────────────

export {
  createExecution,
  startExecution,
  completeExecution,
  failExecution,
  cancelExecution,
  getActiveExecutionCount,
  getExecutionsForRequest,
} from "./worker-request-store"

// ── Drain ─────────────────────────────────────────────────────────────────────

export { beginDrain, isDrained, getDrainDeadline } from "./worker-drain"

// ── Streaming ─────────────────────────────────────────────────────────────────

export {
  createStreamChunk,
  createStreamDone,
  getStreamEventType,
} from "./worker-streaming"

// ── Cancellation ──────────────────────────────────────────────────────────────

export { cancelRequest, isCancellationIdempotent } from "./worker-cancellation"

// ── Deployment Config ─────────────────────────────────────────────────────────

export type { PrismWorkerDeploymentConfig } from "./deployment-manifest"
export { createDefaultDeploymentConfig } from "./deployment-manifest"

// ── OpenAI Surface ────────────────────────────────────────────────────────────

export type { OpenAiEndpoint } from "./openai-server"
export {
  getEndpointPath,
  parseChatRequest,
  formatChatResponse,
  formatStreamChunk,
  formatErrorResponse,
} from "./openai-server"

// ── LlmD Adapter ──────────────────────────────────────────────────────────────

export type { LlmDPrismAdapter } from "./llmd-adapter"
export { createDefaultAdapterStub } from "./llmd-adapter"

// ── KV Events ─────────────────────────────────────────────────────────────────

export type { CreateKvEventConfig } from "./kv-events"
export {
  createKvEvent,
  createKvEventBatch,
  isKvEventValid,
} from "./kv-events"

// ── KV Replay ─────────────────────────────────────────────────────────────────

export {
  addToReplayBuffer,
  getEventsAfter,
  getLatestSequence,
  detectGap,
} from "./kv-event-replay"

// ── Health ────────────────────────────────────────────────────────────────────

export { assessHealth, isReady } from "./worker-health"

// ── Metrics ───────────────────────────────────────────────────────────────────

export type { WorkerMetrics } from "./worker-metrics"
export { createMetricsCollector } from "./worker-metrics"

// ── Receipts ──────────────────────────────────────────────────────────────────

export type { CreateWorkerReceiptConfig } from "./worker-receipts"
export {
  createWorkerReceipt,
  isReceiptValid,
  getReceiptDigest,
} from "./worker-receipts"

// ── Dharma Correlation ─────────────────────────────────────────────────────────

export { createCorrelation, validateCorrelation } from "./dharma-correlation"
