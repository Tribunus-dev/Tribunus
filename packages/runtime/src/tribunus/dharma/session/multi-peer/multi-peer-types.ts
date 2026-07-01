/**
 * Dharma Multi-Peer Result Convergence — Domain Types
 *
 * Task contracts, claims, source disclosure packages, result bundles,
 * canonical outcomes, conflict records, and artifact access.
 */

// ── Task Contract -----------------------------------------------------------

export type TaskKind =
  | "bug_fix" | "feature_implementation" | "code_review" | "test_authoring"
  | "benchmark" | "documentation" | "refactor" | "investigation"
  | "reproduction" | "performance_analysis" | "security_review"

export type TaskParallelism = "exclusive" | "parallel_non_overlapping" | "parallel_competing" | "review_only"

export type TaskStatus =
  | "draft" | "published" | "available" | "claimed" | "in_progress"
  | "result_submitted" | "accepted" | "completed" | "cancelled"

export interface DharmaTaskContract {
  taskId: string
  sessionId: string
  createdByIdentityPublicKey: string
  title: string
  summary: string
  taskKind: TaskKind
  parallelism: TaskParallelism
  sourceBasisDigest: string
  sourceDisclosurePackageId: string | null
  allowedPathScopes: string[]
  deniedPathScopes: string[]
  expectedArtifactClasses: string[]
  verificationContract: string
  acceptancePolicy: AcceptancePolicyLevel
  requiredCapabilities: string[]
  assignedMembershipIds: string[]
  maxContributors: number
  maxResultBundles: number
  claimDeadline: string | null
  completionDeadline: string | null
  status: TaskStatus
  createdAt: string
  updatedAt: string
  signature: string
}

export type AcceptancePolicyLevel = "attested" | "reviewed" | "reproduced" | "corroborated"

// ── Task Claim --------------------------------------------------------------

export type ClaimStatus =
  | "available" | "claimed" | "in_progress" | "result_submitted"
  | "completed" | "released" | "expired" | "abandoned"
  | "accepted" | "rejected" | "conflicted" | "superseded"

export interface DharmaTaskClaim {
  claimId: string
  taskId: string
  sessionId: string
  claimantIdentityPublicKey: string
  claimantMembershipId: string
  claimedSourceBasisDigest: string
  localSandboxAttestationDigest: string
  claimedAt: string
  expiresAt: string | null
  status: ClaimStatus
  signature: string
}

// ── Source Disclosure Package -----------------------------------------------

export type DisclosureClass =
  | "full_snapshot"
  | "subtree_snapshot"
  | "task_fixture_bundle"
  | "patch_context_only"
  | "generated_reproduction_bundle"
  | "opaque_artifact_reference"

export interface SourceDisclosurePackage {
  packageId: string
  sessionId: string
  sourceBasisDigest: string
  disclosureClass: DisclosureClass
  sourceScope: string
  packageManifestDigest: string
  encryptedPayloadReference: string | null
  artifactReferences: string[]
  createdByIdentityPublicKey: string
  intendedMembershipIds: string[]
  expiresAt: string | null
  signature: string
}

// ── Session Result Bundle ---------------------------------------------------

export interface SessionResultBundle {
  resultId: string
  sessionId: string
  taskId: string
  actorIdentityPublicKey: string
  actorMembershipId: string
  claimId: string
  sourceBasisDigest: string
  sourceDisclosurePackageId: string
  environmentDigest: string
  containmentProfileDigest: string
  localSandboxAttestation: string
  patchDigest: string | null
  changedPathDigests: string[]
  artifactDigests: string[]
  testReceiptDigests: string[]
  benchmarkReceiptDigests: string[]
  verificationSummary: string
  finalLocalWorkspaceDigest: string
  disclosureClass: DisclosureClass
  createdAt: string
  signature: string
}

export type ResultValidationState =
  | "received" | "verified" | "pending_artifact" | "pending_verification"
  | "ready_for_review" | "accepted" | "rejected" | "conflicted" | "superseded"

export interface ResultValidation {
  resultId: string
  validationState: ResultValidationState
  validationReason: string | null
  policyDigest: string | null
  validatorVersion: number
  validatedAt: string
}

// ── Canonical Outcome -------------------------------------------------------

export interface CanonicalSessionOutcome {
  outcomeId: string
  sessionId: string
  acceptedResultId: string
  acceptedByIdentityPublicKey: string
  parentOutcomeDigest: string | null
  sourceBasisDigest: string
  canonicalOutcomeDigest: string
  changedPathDigests: string[]
  verificationStatus: string
  acceptanceReason: string | null
  acceptedAt: string
  signature: string
}

// ── Conflict -----------------------------------------------------------------

export type ConflictKind =
  | "stale_source_basis"
  | "path_overlap"
  | "hunk_overlap"
  | "artifact_collision"
  | "verification_divergence"
  | "policy_incompatibility"
  | "duplicate_result"
  | "task_claim_violation"

export type ConflictResolutionState =
  | "open" | "rebase_requested" | "manual_merge_requested"
  | "superseded" | "rejected" | "resolved"

export interface SessionResultConflict {
  conflictId: string
  sessionId: string
  taskId: string
  proposedResultId: string
  conflictingResultId: string | null
  conflictKind: ConflictKind
  baseDigest: string
  currentCanonicalDigest: string
  overlappingPaths: string[]
  detectedAt: string
  resolutionState: ConflictResolutionState
  resolutionResultId: string | null
  resolvedByIdentityPublicKey: string | null
  resolvedAt: string | null
}

// ── Artifact Access ---------------------------------------------------------

export interface ArtifactAccessRequest {
  requestId: string
  sessionId: string
  artifactDigest: string
  requesterMembershipId: string
  requestedPurpose: string
  requestedAt: string
  signature: string
}

export interface ArtifactAccessDecision {
  requestId: string
  decision: "granted" | "denied"
  allowedScope: string
  expiresAt: string | null
  artifactDeliveryReference: string | null
  decidedByIdentityPublicKey: string
  signature: string
}

// ── Verification Policy ------------------------------------------------------

export interface VerificationPolicy {
  policyId: string
  sessionId: string
  minimumLevel: AcceptancePolicyLevel
  requireLocalReproduction: boolean
  requireCorroboration: boolean
  corroborationCount: number
  requireBenchmark: boolean
  benchmarkThreshold: string | null
  requireReview: boolean
  requiredReviewers: string[]
  autoAcceptNonOverlapping: boolean
}

// ── Event Types --------------------------------------------------------------

export type MultiPeerEventType =
  | "session.task_created"
  | "session.task_published"
  | "session.task_cancelled"
  | "session.task_claimed"
  | "session.task_released"
  | "session.task_expired"
  | "session.source_package_created"
  | "session.source_package_authorized"
  | "session.source_package_revoked"
  | "session.result_submitted"
  | "session.result_verified"
  | "session.result_accepted"
  | "session.result_rejected"
  | "session.result_conflicted"
  | "session.result_superseded"
  | "session.conflict_detected"
  | "session.conflict_rebase_requested"
  | "session.conflict_resolved"
  | "session.artifact_access_requested"
  | "session.artifact_access_granted"
  | "session.artifact_access_denied"
  | "session.canonical_outcome_advanced"

export const MULTI_PEER_EVENT_TYPES: readonly MultiPeerEventType[] = [
  "session.task_created", "session.task_published", "session.task_cancelled",
  "session.task_claimed", "session.task_released", "session.task_expired",
  "session.source_package_created", "session.source_package_authorized",
  "session.source_package_revoked",
  "session.result_submitted", "session.result_verified",
  "session.result_accepted", "session.result_rejected",
  "session.result_conflicted", "session.result_superseded",
  "session.conflict_detected", "session.conflict_rebase_requested",
  "session.conflict_resolved",
  "session.artifact_access_requested", "session.artifact_access_granted",
  "session.artifact_access_denied",
  "session.canonical_outcome_advanced",
] as const

// ── Extended Capabilities ---------------------------------------------------

export type MultiPeerCapability =
  | "task.create" | "task.publish" | "task.cancel"
  | "task.claim" | "task.release"
  | "source_package.create" | "source_package.authorize"
  | "source_package.revoke" | "source_package.request_access"
  | "result.submit" | "result.review" | "result.accept"
  | "result.reject" | "result.request_rebase"
  | "conflict.inspect" | "conflict.resolve"
  | "artifact.request" | "artifact.authorize" | "artifact.deliver"
  | "workspace.accept_result" | "workspace.reject_result"
  | "workspace.request_rebase" | "workspace.resolve_conflict"

export const MULTI_PEER_CAPABILITIES: readonly MultiPeerCapability[] = [
  "task.create", "task.publish", "task.cancel",
  "task.claim", "task.release",
  "source_package.create", "source_package.authorize",
  "source_package.revoke", "source_package.request_access",
  "result.submit", "result.review", "result.accept",
  "result.reject", "result.request_rebase",
  "conflict.inspect", "conflict.resolve",
  "artifact.request", "artifact.authorize", "artifact.deliver",
  "workspace.accept_result", "workspace.reject_result",
  "workspace.request_rebase", "workspace.resolve_conflict",
] as const
