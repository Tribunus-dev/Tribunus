/**
 * Prism Prefill/Decode Role Separation — Types
 */

// ── Worker Roles ------------------------------------------------------------

export type PrismWorkerRole = "unified" | "prefill_preferred" | "decode_preferred" | "prefill_only" | "decode_only"

export type PhaseCoLocationPolicy = "same_worker_required" | "future_transfer_capable" | "not_supported"

export type PromptLengthBand = "short" | "medium" | "long" | "very_long"
export type GenerationLengthBand = "short" | "medium" | "long"
export type LatencyClass = "interactive" | "balanced" | "throughput" | "batch"

// ── Phase Capability --------------------------------------------------------

export interface PrismPhaseCapability {
  supported: boolean
  enabled: boolean
  admissionState: string
  maximumConcurrentOperations: number
  maximumInputTokens: number
  maximumOutputTokens: number | null
  maximumRuntimeMs: number
  maximumMemoryBytes: number
  preferredBatchSize: number | null
  targetProfileDigest: string
  computeImageProfileDigest: string
}

// ── Extended Compatibility Envelope -----------------------------------------

export interface PrismWorkerCompatibilityEnvelopeV2 {
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
  lifecycleState: string
  workerRoles: PrismWorkerRole[]
  prefillCapability: PrismPhaseCapability
  decodeCapability: PrismPhaseCapability
  prefillProfile: PrismPrefillProfile
  decodeProfile: PrismDecodeProfile
  phaseCoLocationPolicy: PhaseCoLocationPolicy
  prefillCapacity: number
  decodeCapacity: number
  supportsPhaseMetrics: boolean
  supportsPhaseReceipts: boolean
}

// ── Prefill Profile ---------------------------------------------------------

export interface PrismPrefillProfile {
  profileDigest: string
  maximumContextTokens: number
  maximumPrefillBatchSize: number
  maximumPrefillConcurrency: number
  maximumPrefillMemoryBytes: number
  preferredPromptLengthBand: PromptLengthBand
  estimatedPrefillTokensPerSecond: number
  supportsPrefixReuse: boolean
  supportsPromptBatching: boolean
  targetCapabilitySignature: string
  computeImageDigest: string
}

// ── Decode Profile ----------------------------------------------------------

export interface PrismDecodeProfile {
  profileDigest: string
  maximumDecodeConcurrency: number
  maximumActiveKvNamespaces: number
  maximumOutputTokens: number
  preferredGenerationLengthBand: GenerationLengthBand
  estimatedDecodeTokensPerSecond: number
  supportsStreaming: boolean
  supportsCancellation: boolean
  supportsKvReuse: boolean
  latencyClass: LatencyClass
  targetCapabilitySignature: string
  computeImageDigest: string
}

// ── Phase Requirements ------------------------------------------------------

export interface PrismPhaseRequirements {
  requiredPrefill: boolean
  requiredDecode: boolean
  inputTokenCount: number
  requestedOutputTokens: number
  stream: boolean
  promptLengthClass: PromptLengthBand
  generationLengthClass: GenerationLengthBand
  latencyPreference: LatencyClass
  batchEligibility: boolean
  deadlineAt: string | null
}

// ── Phase Capacity ----------------------------------------------------------

export interface PrismPhaseCapacitySnapshot {
  workerId: string
  observedAt: string
  prefillActiveOperations: number
  prefillMaximumOperations: number
  prefillPendingOperations: number
  prefillMemoryBytesInUse: number
  prefillMemoryBytesLimit: number
  decodeActiveOperations: number
  decodeMaximumOperations: number
  decodePendingOperations: number
  decodeActiveKvNamespaces: number
  decodeMaximumKvNamespaces: number
  decodeMemoryBytesInUse: number
  decodeMemoryBytesLimit: number
}

// ── Phase Readiness ---------------------------------------------------------

export interface PrismWorkerReadiness {
  workerId: string
  overallReady: boolean
  prefillReady: boolean
  decodeReady: boolean
  admittedModelCount: number
  prefillCapacityAvailable: boolean
  decodeCapacityAvailable: boolean
  drainState: string
  observedAt: string
}

// ── Route Plan --------------------------------------------------------------

export interface PrismRoutePlan {
  routeId: string
  requestId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  candidateWorkers: string[]
  selectedWorkerId: string
  prefillWorkerId: string
  decodeWorkerId: string
  executionPinningPolicy: PhaseCoLocationPolicy
  prefillSelectionReason: string
  decodeSelectionReason: string
  prefixAffinitySummary: string
  prefillLoadSummary: string
  decodeLoadSummary: string
  phaseBudgetSummary: string
  createdAt: string
}

// ── Execution Pin -----------------------------------------------------------

export type ExecutionPinState =
  | "reserved" | "prefill_running" | "prefill_completed"
  | "decode_running" | "completed" | "cancelled" | "failed"

export interface PrismExecutionPin {
  executionId: string
  routeId: string
  requestId: string
  workerId: string
  workerInstanceId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  computeImageDigest: string
  kvNamespaceId: string | null
  phaseCoLocationPolicy: PhaseCoLocationPolicy
  issuedAt: string
  expiresAt: string | null
  state: ExecutionPinState
}

// ── Phase Lifecycle ---------------------------------------------------------

export interface PhaseLifecycleState {
  executionId: string
  requestId: string
  prefillState: string
  decodeState: string
  kvNamespaceId: string | null
  prefillWorkerId: string
  decodeWorkerId: string
  prefillCompletedAt: string | null
  decodeStartedAt: string | null
}

// ── Phase Failure -----------------------------------------------------------

export type PhaseFailureClass =
  | "prefill_failed" | "prefill_cancelled" | "prefill_budget_exceeded" | "prefill_timeout"
  | "decode_failed" | "decode_cancelled" | "decode_budget_exceeded" | "decode_timeout"
  | "decode_kv_invalid" | "decode_worker_mismatch"

// ── Phase Receipt -----------------------------------------------------------

export interface PrismPhaseUsageReceipt {
  receiptId: string
  requestId: string
  routeId: string
  dharmaLeaseId: string | null
  sessionId: string | null
  workerId: string
  workerInstanceId: string
  prefillWorkerId: string
  decodeWorkerId: string
  phaseCoLocationPolicy: PhaseCoLocationPolicy
  modelArtifactDigest: string
  tokenizerDigest: string
  prefillComputeImageDigest: string
  decodeComputeImageDigest: string
  targetCapabilitySignature: string
  inputDigest: string
  outputDigest: string | null
  inputTokenCount: number | null
  outputTokenCount: number | null
  prefillDurationMs: number | null
  decodeDurationMs: number | null
  totalDurationMs: number
  prefillPeakMemoryBytes: number | null
  decodePeakMemoryBytes: number | null
  kvNamespaceDigest: string | null
  kvCacheStatus: string | null
  executionState: string
  failureClass: PhaseFailureClass | null
  emittedAt: string
  workerSignature: string
}

// ── Dharma Phase Budget -----------------------------------------------------

export interface DharmaPrismPhaseBudget {
  maximumPrefillRuntimeMs: number
  maximumDecodeRuntimeMs: number
  maximumPrefillMemoryBytes: number
  maximumDecodeMemoryBytes: number
  maximumInputTokens: number
  maximumOutputTokens: number
  requireSameWorkerExecution: boolean
  allowedWorkerRoles: PrismWorkerRole[]
  requiredLatencyClass: LatencyClass | null
}

// ── Deployment Profile ------------------------------------------------------

export interface PrismWorkerDeploymentProfile {
  profileName: string
  roles: PrismWorkerRole[]
  prefillEnabled: boolean
  decodeEnabled: boolean
  phaseCoLocationPolicy: PhaseCoLocationPolicy
  routableForEndToEndRequests: boolean
}

export const DEPLOYMENT_PROFILES: Record<string, PrismWorkerDeploymentProfile> = {
  unified: { profileName: "unified", roles: ["unified"], prefillEnabled: true, decodeEnabled: true, phaseCoLocationPolicy: "same_worker_required", routableForEndToEndRequests: true },
  prefill_optimized_unified: { profileName: "prefill_optimized_unified", roles: ["prefill_preferred", "unified"], prefillEnabled: true, decodeEnabled: true, phaseCoLocationPolicy: "same_worker_required", routableForEndToEndRequests: true },
  decode_optimized_unified: { profileName: "decode_optimized_unified", roles: ["decode_preferred", "unified"], prefillEnabled: true, decodeEnabled: true, phaseCoLocationPolicy: "same_worker_required", routableForEndToEndRequests: true },
  future_prefill_only: { profileName: "future_prefill_only", roles: ["prefill_only"], prefillEnabled: true, decodeEnabled: false, phaseCoLocationPolicy: "future_transfer_capable", routableForEndToEndRequests: false },
  future_decode_only: { profileName: "future_decode_only", roles: ["decode_only"], prefillEnabled: false, decodeEnabled: true, phaseCoLocationPolicy: "future_transfer_capable", routableForEndToEndRequests: false },
}

// ── Compatibility Report Extension ------------------------------------------

export interface LlmDPrismPhaseCompatibilityReport {
  llmdVersion: string
  prismWorkerProtocolVersion: number
  routerProtocolVersion: number
  kvEventSchemaVersion: number
  unifiedWorkerSupport: string
  phaseRoleAdvertisementSupport: string
  sameWorkerPhasePinningSupport: string
  phaseCapacityReportingSupport: string
  phaseMetricSupport: string
  phaseReceiptSupport: string
  phaseDrainSupport: string
  crossWorkerKvTransferSupport: string
  prefillDecodeDisaggregationSupport: string
  knownGaps: string[]
  deferredFeatures: string[]
  testEvidenceRefs: string[]
}
