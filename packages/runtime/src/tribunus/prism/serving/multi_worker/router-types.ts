/**
 * Prism Multi-Worker Router — Types
 */

// ── Worker Compatibility Envelope -------------------------------------------

export interface PrismWorkerCompatibilityEnvelope {
  workerId: string
  workerInstanceId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  modelFamily: string
  workloadClasses: string[]
  targetCapabilitySignature: string
  computeImageDigest: string
  precisionMode: string
  maximumContextLength: number
  maximumOutputTokens: number
  maximumConcurrentRequests: number
  kvEventVersion: number
  kvLocalityMode: string
  supportsStreaming: boolean
  supportsCancellation: boolean
  supportsDrain: boolean
  supportsDharmaCorrelation: boolean
  lifecycleState: string
}

// ── Prefix Affinity ---------------------------------------------------------

export interface PrismPrefixAffinityKey {
  modelArtifactDigest: string
  tokenizerDigest: string
  requestNamespace: string
  normalizedPrefixDigest: string
  tokenBlockSize: number
  blockSequenceDigest: string
}

export interface PrefixAffinityResult {
  workerId: string
  matchedPrefixTokens: number
  matchedPrefixBlocks: number
  longestConsecutivePrefixBlocks: number
  residencyWeight: number
  affinityScore: number
  eventFreshness: string | null
}

// ── Route Records -----------------------------------------------------------

export interface RouteRecord {
  routeId: string
  requestId: string
  selectedWorkerId: string
  candidateWorkerIds: string[]
  selectionReason: string
  prefixAffinitySummary: string
  loadSummary: string
  retryCount: number
  traceContext: string | null
  createdAt: string
  completedAt: string | null
  outcome: RouteOutcome
}

export type RouteOutcome = "completed" | "failed" | "retried" | "cancelled"

// ── Router Worker State -----------------------------------------------------

export interface RouterWorkerState {
  workerId: string
  instanceId: string
  compatibility: PrismWorkerCompatibilityEnvelope | null
  healthy: boolean
  ready: boolean
  draining: boolean
  activeRequests: number
  maxConcurrentRequests: number
  lastHealthCheck: string | null
  lastError: string | null
  lastKvEventSequence: number
  kvEventFreshness: string | null
}

// ── KV Index ----------------------------------------------------------------

export interface RouterKvIndexEntry {
  workerId: string
  prefixDigest: string
  sequenceNumber: number
  state: string
  timestamp: string
}

// ── Selection Weights -------------------------------------------------------

export interface SelectionWeights {
  cacheAffinityWeight: number
  loadWeight: number
  healthWeight: number
  errorWeight: number
  drainWeight: number
}

export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  cacheAffinityWeight: 0.5,
  loadWeight: 0.2,
  healthWeight: 0.2,
  errorWeight: 0.05,
  drainWeight: 0.05,
}

// ── Compatibility Report ----------------------------------------------------

export interface LlmDPrismCompatibilityReport {
  llmdVersion: string
  gatewayApiInferenceExtensionVersion: string
  prismWorkerProtocolVersion: number
  validatedAt: string
  workerContractStatus: ContractStatus
  routingContractStatus: ContractStatus
  kvEventContractStatus: ContractStatus
  healthContractStatus: ContractStatus
  metricsContractStatus: ContractStatus
  drainContractStatus: ContractStatus
  cancellationContractStatus: ContractStatus
  knownGaps: CompatibilityGap[]
  deferredFeatures: string[]
  testEvidenceRefs: string[]
}

export type ContractStatus = "native" | "adapter_required" | "unsupported" | "deferred"

export interface CompatibilityGap {
  area: string
  description: string
  severity: "blocking" | "major" | "minor"
  mitigation: string | null
}

// ── Router Events -----------------------------------------------------------

export type RouterTraceEvent =
  | "route.received" | "route.filtered" | "route.scored" | "route.selected"
  | "route.forwarded" | "route.retry" | "route.failed" | "route.completed"
  | "worker.drain_started" | "worker.drain_completed" | "worker.failover"
  | "kv_index.replayed"

// ── Router Enums ------------------------------------------------------------

export type RouteAction = "accept" | "retry" | "fail" | "redirect"
export type FailoverPolicy = "fail_after_first_output" | "retry_before_output" | "retry_idempotent"
