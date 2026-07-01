/**
 * Dharma Local Prism Compute Lease — Types
 *
 * Compute leases, artifact admission, ComputeImage policy, budgets,
 * execution receipts, KV namespaces, and session aggregate summaries.
 */

// ── Compute Lease -----------------------------------------------------------

export type ComputeBackendKind = "prism_local"

export type ComputeWorkloadClass =
  | "chat_completion" | "code_completion" | "tool_planning"
  | "embedding" | "reranking" | "classification"
  | "summarization" | "agent_analysis" | "structured_extraction"
  | "benchmark_inference"

export type ComputeLeaseStatus =
  | "draft" | "requested" | "pending_approval" | "approved"
  | "admitted" | "running" | "streaming" | "completed"
  | "rejected" | "expired" | "failed" | "cancelled" | "revoked"

export type InputDisclosureClass = "local_private" | "session_scoped" | "sanitized_session" | "public"
export type OutputDisclosureClass = "local_private" | "task_visible" | "owner_reviewable" | "federation_summary"

export interface LocalPrismComputeLease {
  leaseId: string
  sessionId: string
  taskId: string | null
  requesterIdentityPublicKey: string
  requesterMembershipId: string
  approvingIdentityPublicKey: string | null
  grantId: string
  sessionKeyEpoch: number
  backendKind: ComputeBackendKind
  workloadClass: ComputeWorkloadClass
  modelArtifactDigest: string
  computeImagePolicyDigest: string
  inputDisclosureClass: InputDisclosureClass
  inputDigest: string
  inputReference: string | null
  outputDisclosureClass: OutputDisclosureClass
  requestedMaxTokens: number | null
  requestedMaxRuntimeSeconds: number
  requestedMaxMemoryBytes: number
  requestedMaxOutputBytes: number
  requestedMaxGpuTimeMs: number | null
  requiredContainmentLevel: string
  approvalPolicy: string
  status: ComputeLeaseStatus
  issuedAt: string
  expiresAt: string | null
  revokedAt: string | null
  cancellationReason: string | null
  signatureChain: string
}

// ── Artifact Admission ------------------------------------------------------

export type ArtifactAdmissionState =
  | "unknown" | "pending_validation" | "admitted"
  | "deprecated" | "revoked" | "unavailable"

export type WeightFormat = "fp32" | "fp16" | "bf16" | "int8" | "int4" | "q4_k_m" | "q8_0"
export type QuantizationScheme = "none" | "awq" | "gptq" | "squeezellm" | "gguf"

export interface PrismArtifactAdmission {
  artifactDigest: string
  artifactName: string
  modelFamily: string
  modelVersion: string
  tokenizerDigest: string
  weightFormat: WeightFormat
  quantizationScheme: QuantizationScheme
  supportedWorkloadClasses: ComputeWorkloadClass[]
  supportedComputeTargets: string[]
  requiredMemoryBytes: number
  artifactProvenance: string
  signatureStatus: string
  localAvailability: string
  admissionState: ArtifactAdmissionState
  admittedAt: string
  revokedAt: string | null
}

// ── ComputeImage Policy -----------------------------------------------------

export interface ComputeImagePolicy {
  policyDigest: string
  allowedTargets: string[]
  requiredDeterminismClass: string
  allowedPrecisionModes: string[]
  allowedMemoryTiers: string[]
  maxCompileTimeMs: number
  maxModelLoadTimeMs: number
  allowCacheReuse: boolean
  allowCompiledArtifactReuse: boolean
  requireArtifactSealing: boolean
  requireExecutionReceipts: boolean
}

// ── Compute Budget ----------------------------------------------------------

export interface ComputeBudget {
  maximumRuntimeSeconds: number
  maximumPrefillMs: number
  maximumDecodeMs: number
  maximumTokens: number
  maximumInputTokens: number
  maximumOutputTokens: number
  maximumMemoryBytes: number
  maximumGpuTimeMs: number | null
  maximumCpuTimeMs: number | null
  maximumOutputBytes: number
  maximumCompileTimeMs: number
}

// ── Prism Execution ---------------------------------------------------------

export interface PrismExecutionDescriptor {
  executionId: string
  leaseId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  computeImageDigest: string
  targetCapabilitySignature: string
  workloadClass: ComputeWorkloadClass
  inputReference: string
  maxTokens: number
  samplingPolicy: string
  outputSchema: string | null
  executionBudget: ComputeBudget
  containmentContextDigest: string
  sessionContextDigest: string
}

// ── Local KV Namespace ------------------------------------------------------

export type KvNamespaceState =
  | "allocated" | "primed" | "decoding"
  | "synchronized" | "invalidated" | "released"

export interface LocalKvNamespace {
  namespaceId: string
  sessionId: string
  leaseId: string
  modelArtifactDigest: string
  ownerIdentityPublicKey: string
  prefixDigest: string
  residencyTier: string
  createdAt: string
  expiresAt: string | null
  state: KvNamespaceState
}

// ── Usage Receipt -----------------------------------------------------------

export type FailureClass =
  | "artifact_unavailable" | "artifact_revoked" | "tokenizer_mismatch"
  | "compute_image_unavailable" | "target_incompatible"
  | "memory_budget_exceeded" | "containment_unavailable"
  | "lease_expired" | "execution_cancelled" | "execution_timeout"
  | "backend_failure" | "output_budget_exceeded"

export interface PrismUsageReceipt {
  receiptId: string
  leaseId: string
  sessionId: string
  taskId: string | null
  actorIdentityPublicKey: string
  modelArtifactDigest: string
  tokenizerDigest: string
  computeImageDigest: string
  targetCapabilitySignature: string
  containmentProfileDigest: string
  workloadClass: ComputeWorkloadClass
  inputDigest: string
  outputDigest: string | null
  inputTokenCount: number | null
  outputTokenCount: number | null
  prefillDurationMs: number | null
  decodeDurationMs: number | null
  totalDurationMs: number
  peakMemoryBytes: number | null
  cacheHitStatus: string | null
  kvNamespaceDigest: string | null
  executionState: ComputeLeaseStatus
  failureClass: FailureClass | null
  emittedAt: string
  signature: string
}

// ── Event Types -------------------------------------------------------------

export type ComputeEventType =
  | "session.compute_policy_updated"
  | "session.compute_lease_requested"
  | "session.compute_lease_approved"
  | "session.compute_lease_rejected"
  | "session.compute_lease_admitted"
  | "session.compute_lease_started"
  | "session.compute_lease_streaming"
  | "session.compute_lease_completed"
  | "session.compute_lease_failed"
  | "session.compute_lease_cancelled"
  | "session.compute_lease_revoked"
  | "session.prism_artifact_admitted"
  | "session.prism_artifact_revoked"
  | "session.prism_execution_receipt_emitted"

export const COMPUTE_EVENT_TYPES: readonly ComputeEventType[] = [
  "session.compute_policy_updated",
  "session.compute_lease_requested", "session.compute_lease_approved",
  "session.compute_lease_rejected", "session.compute_lease_admitted",
  "session.compute_lease_started", "session.compute_lease_streaming",
  "session.compute_lease_completed", "session.compute_lease_failed",
  "session.compute_lease_cancelled", "session.compute_lease_revoked",
  "session.prism_artifact_admitted", "session.prism_artifact_revoked",
  "session.prism_execution_receipt_emitted",
] as const

// ── Capabilities ------------------------------------------------------------

export type ComputeCapability =
  | "compute.request_local" | "compute.inspect_local_status"
  | "compute.cancel_own_lease" | "compute.read_own_receipts"
  | "compute.approve_local_lease" | "compute.cancel_any_lease"
  | "compute.inspect_all_receipts" | "compute.configure_local_model_policy"

export const COMPUTE_CAPABILITIES: readonly ComputeCapability[] = [
  "compute.request_local", "compute.inspect_local_status",
  "compute.cancel_own_lease", "compute.read_own_receipts",
  "compute.approve_local_lease", "compute.cancel_any_lease",
  "compute.inspect_all_receipts", "compute.configure_local_model_policy",
] as const

// ── Aggregate Compute Summary -----------------------------------------------

export interface SessionComputeSummary {
  leaseCount: number
  completedLeaseCount: number
  failedLeaseCount: number
  cancelledLeaseCount: number
  workloadClassSummary: string
  artifactDigestSummary: string
  computeTargetSummary: string
  containmentProfileSummary: string
  totalInputTokens: number | null
  totalOutputTokens: number | null
  totalRuntimeMs: number
  aggregateCacheHitSummary: string | null
  receiptDigestSummary: string
}
