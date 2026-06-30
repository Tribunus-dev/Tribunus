/**
 * Dharma Trusted-LAN Prism Compute — Types
 *
 * Provider enrollment, capability advertisement, trust scopes,
 * handshake protocol, remote lease, streaming, and usage receipts.
 */

// ── Provider Enrollment -----------------------------------------------------

export type EnrollmentState = "draft" | "pending_attestation" | "enrolled" | "active" | "draining" | "suspended" | "revoked"
export type ProviderHealthState = "available" | "busy" | "degraded" | "draining" | "offline"

export interface PrismLanProvider {
  providerId: string
  identityPublicKey: string
  devicePublicKey: string
  federationId: string
  displayName: string | null
  transportPublicKey: string
  enrollmentState: EnrollmentState
  status: ProviderHealthState
  capabilityAdvertisementId: string | null
  containmentCapabilityDigest: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

// ── Capability Advertisement ------------------------------------------------

export interface ArtifactSummary {
  artifactDigest: string
  modelFamily: string
  modelVersion: string
  tokenizerDigest: string
  quantizationScheme: string
  maximumContextLength: number
  supportedWorkloadClasses: string[]
  supportedComputeTargets: string[]
  admissionState: string
}

export interface PrismLanCapabilityAdvertisement {
  advertisementId: string
  providerId: string
  providerIdentityPublicKey: string
  protocolVersion: number
  supportedWorkloadClasses: string[]
  artifactSummaries: ArtifactSummary[]
  computeTargetSummaries: string[]
  containmentCapabilityDigest: string
  maximumConcurrentLeases: number
  maximumInputTokens: number
  maximumOutputTokens: number
  maximumRuntimeSeconds: number
  maximumMemoryBytes: number
  supportedOutputModes: string[]
  supportedDisclosureClasses: string[]
  healthSummary: string
  issuedAt: string
  expiresAt: string
  signature: string
}

// ── Trust Scope -------------------------------------------------------------

export interface PrismLanProviderTrust {
  trustId: string
  federationId: string
  providerIdentityPublicKey: string
  grantedByIdentityPublicKey: string
  allowedSessionIds: string[] | null
  allowedWorkloadClasses: string[]
  allowedDisclosureClasses: string[]
  allowedArtifactDigests: string[]
  allowedTargetClasses: string[]
  maximumRuntimeSeconds: number
  maximumTokens: number
  maximumMemoryBytes: number
  maximumConcurrentLeases: number
  allowStreaming: boolean
  allowResultArtifactReturn: boolean
  expiresAt: string
  revokedAt: string | null
  reasonDigest: string | null
  signature: string
}

export type TrustScopeKind = "personal_cluster" | "private_team_provider" | "benchmark_provider" | "restricted_provider"

// ── Pairing -----------------------------------------------------------------

export interface LanPairing {
  pairingId: string
  requesterIdentityPublicKey: string
  providerIdentityPublicKey: string
  transportPublicKey: string
  pairingMethod: string
  pairedAt: string
  expiresAt: string | null
  status: PairingStatus
}

export type PairingStatus = "pending" | "active" | "expired" | "revoked"

// ── Handshake ---------------------------------------------------------------

export interface LanComputeHandshake {
  protocolVersion: number
  requesterIdentityPublicKey: string
  requesterDevicePublicKey: string
  providerIdentityPublicKey: string
  providerDevicePublicKey: string | null
  sessionId: string
  membershipId: string
  sessionKeyEpoch: number
  leaseRequestDigest: string
  nonce: string
  timestamp: string
  signature: string
}

export interface LanComputeHandshakeAcceptance {
  protocolVersion: number
  providerIdentityPublicKey: string
  providerDevicePublicKey: string
  providerAdvertisementDigest: string
  containmentCapabilityDigest: string
  negotiatedTransportLimits: string
  nonceEcho: string
  nonce: string
  timestamp: string
  signature: string
}

export type LeaseBackendKind = "prism_local" | "prism_trusted_lan"

// ── Remote Lease ------------------------------------------------------------

export type RemoteLeaseStatus =
  | "draft" | "requested" | "provider_evaluating" | "approved" | "admitted"
  | "transferring_input" | "running" | "streaming" | "transferring_output" | "completed"
  | "rejected" | "expired" | "failed" | "cancelled" | "revoked"

export type ArtifactParityMode = "strict_artifact_parity" | "family_compatible" | "evaluation_only"

export interface PrismLanComputeLease {
  leaseId: string
  sessionId: string
  taskId: string | null
  requesterIdentityPublicKey: string
  requesterMembershipId: string
  requesterDevicePublicKey: string
  providerId: string
  providerIdentityPublicKey: string
  backendKind: LeaseBackendKind
  workloadClass: string
  modelArtifactDigest: string
  tokenizerDigest: string
  artifactParityMode: ArtifactParityMode
  computeImagePolicyDigest: string
  requestedTargetConstraints: string
  inputDisclosureClass: string
  inputDigest: string
  inputReference: string | null
  outputDisclosureClass: string
  requestedMaxInputTokens: number
  requestedMaxOutputTokens: number
  requestedMaxRuntimeSeconds: number
  requestedMaxMemoryBytes: number
  requestedMaxOutputBytes: number
  requestedMaxGpuTimeMs: number | null
  requiredContainmentLevel: string
  providerTrustScopeDigest: string
  disconnectPolicy: string
  status: RemoteLeaseStatus
  issuedAt: string
  expiresAt: string | null
  signatureChain: string
}

// ── Rejection Classes -------------------------------------------------------

export type ProviderRejectionClass =
  | "protocol_incompatible" | "requester_not_authorized" | "session_membership_invalid"
  | "stale_session_epoch" | "provider_trust_missing" | "provider_trust_expired"
  | "artifact_unavailable" | "artifact_revoked" | "tokenizer_mismatch"
  | "workload_unsupported" | "target_incompatible" | "containment_insufficient"
  | "disclosure_class_forbidden" | "budget_exceeded"
  | "provider_busy" | "provider_draining" | "lease_expired" | "replay_detected"

// ── Output Frames -----------------------------------------------------------

export type FrameKind = "token_delta" | "structured_chunk" | "embedding_chunk" | "status" | "error" | "final_receipt_reference"

export interface LanComputeOutputFrame {
  leaseId: string
  sequenceNumber: number
  frameKind: FrameKind
  payloadDigest: string
  payload: string | null
  bytes: number
  final: boolean
  signature: string
}

// ── Provider KV Namespace ---------------------------------------------------

export type ProviderKvState = "allocated" | "primed" | "decoding" | "released" | "invalidated"

export interface ProviderKvNamespace {
  namespaceId: string
  providerId: string
  sessionId: string
  leaseId: string
  modelArtifactDigest: string
  prefixDigest: string | null
  residencyTier: string
  createdAt: string
  expiresAt: string | null
  state: ProviderKvState
}

// ── Usage Receipt -----------------------------------------------------------

export interface PrismLanUsageReceipt {
  receiptId: string
  leaseId: string
  sessionId: string
  requesterIdentityPublicKey: string
  providerIdentityPublicKey: string
  providerId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  computeImageDigest: string
  targetCapabilitySignature: string
  containmentProfileDigest: string
  workloadClass: string
  inputDigest: string
  outputDigest: string | null
  inputTokenCount: number | null
  outputTokenCount: number | null
  prefillDurationMs: number | null
  decodeDurationMs: number | null
  totalDurationMs: number
  peakMemoryBytes: number | null
  cacheStatus: string | null
  executionState: RemoteLeaseStatus
  failureClass: ProviderRejectionClass | null
  emittedAt: string
  providerSignature: string
}

// ── Event Types -------------------------------------------------------------

export type LanComputeEventType =
  | "compute.provider_advertised" | "compute.provider_withdrawn"
  | "compute.provider_status_changed" | "compute.provider_trust_granted"
  | "compute.provider_trust_revoked"
  | "session.compute_lease_requested" | "session.compute_lease_provider_selected"
  | "session.compute_lease_provider_rejected" | "session.compute_lease_admitted"
  | "session.compute_lease_started" | "session.compute_lease_completed"
  | "session.compute_lease_failed" | "session.compute_lease_cancelled"
  | "session.compute_lease_revoked" | "session.compute_usage_receipt_emitted"

export const LAN_COMPUTE_EVENT_TYPES: readonly LanComputeEventType[] = [
  "compute.provider_advertised", "compute.provider_withdrawn",
  "compute.provider_status_changed", "compute.provider_trust_granted",
  "compute.provider_trust_revoked",
  "session.compute_lease_requested", "session.compute_lease_provider_selected",
  "session.compute_lease_provider_rejected", "session.compute_lease_admitted",
  "session.compute_lease_started", "session.compute_lease_completed",
  "session.compute_lease_failed", "session.compute_lease_cancelled",
  "session.compute_lease_revoked", "session.compute_usage_receipt_emitted",
] as const
