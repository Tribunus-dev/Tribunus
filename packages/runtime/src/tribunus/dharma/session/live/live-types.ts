/**
 * Dharma Live Sandbox — Live-layer Types
 *
 * Types for source materialization, workspace digests, overlays, patches,
 * process execution, and session transport that extend the base session types.
 */

// ── Source Materialization ---------------------------------------------------

export interface SourceMaterializationRequest {
  sessionId: string
  sourceRepositoryPath: string
  sourceRevision: string
  includeSubmodules: boolean
  sourcePolicy: string
}

export interface SourceManifest {
  sourceRevision: string
  resolvedCommitHash: string
  repositoryIdentityDigest: string
  files: SourceFileEntry[]
  totalFileCount: number
  totalBytes: number
  manifestDigest: string
  createdAt: string
}

export interface SourceFileEntry {
  path: string
  mode: string
  digest: string
}

// ── Workspace Digests -------------------------------------------------------

export type DigestKind = "base" | "canonical" | "overlay" | "pre_mutation" | "post_mutation" | "sealed"

export interface WorkspaceDigestRecord {
  digestId: string
  sessionId: string
  digestKind: DigestKind
  digest: string
  fileCount: number
  recordedAt: string
}

// ── Overlay Filesystem ------------------------------------------------------

export type OverlayState = "created" | "active" | "submitted" | "merged" | "discarded" | "rejected" | "conflicted"

export interface OverlayFilesystem {
  overlayId: string
  sessionId: string
  membershipId: string
  ownerIdentityPublicKey: string
  overlayRoot: string
  allowedPathScope: string[]
  baseWorkspaceDigest: string
  currentDigest: string
  state: OverlayState
  createdAt: string
  updatedAt: string
}

// ── Patch Proposal ----------------------------------------------------------

export interface PatchProposal {
  proposalId: string
  sessionId: string
  membershipId: string
  grantId: string
  overlayId: string
  baseWorkspaceDigest: string
  patchDigest: string
  changedPaths: string[]
  patchReference: string | null
  state: PatchProposalState
  createdAt: string
  signature: string
}

export type PatchProposalState = "pending" | "accepted" | "rejected" | "conflicted"

export interface PatchReviewDecision {
  proposalId: string
  decision: "accepted" | "rejected"
  reviewedByIdentityPublicKey: string
  reviewReason: string | null
  expectedCanonicalDigest: string
  acceptedAt: string | null
  signature: string
}

// ── Sandbox Execution -------------------------------------------------------

export interface SandboxExecutionRequest {
  executionId: string
  sessionId: string
  membershipId: string
  grantId: string
  command: string
  arguments: string[]
  workingDirectory: string | null
  environmentAllowlist: string[]
  timeoutSeconds: number
  outputLimitBytes: number
  requestedAt: string
}

export interface ActiveSandboxExecution {
  executionId: string
  sessionId: string
  membershipId: string
  grantId: string
  processGroupId: string | null
  startedAt: string
  state: ExecutionState
  terminationDeadline: string | null
}

export type ExecutionState = "pending" | "running" | "completed" | "failed" | "cancelled" | "terminated"

// ── Session Transport -------------------------------------------------------

export interface TransportMessage {
  messageId: string
  sessionId: string
  membershipId: string
  sessionKeyEpoch: number
  messageKind: TransportMessageKind
  payload: Record<string, unknown>
  identitySignature: string
  idempotencyKey: string
  sequenceNumber: number
  createdAt: string
}

export type TransportMessageKind =
  | "join_acknowledgment"
  | "grant_projection"
  | "command_request"
  | "command_receipt"
  | "patch_proposal"
  | "patch_review_result"
  | "revocation_notification"
  | "session_lifecycle_notification"
  | "artifact_retrieval"

// ── Peer Session Projection -------------------------------------------------

export interface PeerSessionProjection {
  sessionId: string
  lifecycleState: string
  ownMembershipStatus: string
  activeGrants: string[]
  permittedPathScopes: string[]
  commandReceiptSummaries: string[]
  ownOverlayState: string | null
  ownPatchProposals: string[]
  acceptedMutationSummaries: string[]
  visibleTestResultSummaries: string[]
  revocationStatus: string | null
  allowedArtifactReferences: string[]
}

// ── Session Event Link ------------------------------------------------------

export interface SessionEventLink {
  linkId: string
  sessionId: string
  localRecordType: string
  localRecordId: string
  dharmaEventId: string | null
  replicationState: "pending" | "published" | "confirmed" | "failed"
  outboxEntryId: string | null
  publishedAt: string | null
  confirmedAt: string | null
}

// ── Recovery State ----------------------------------------------------------

export interface RecoveryState {
  recoveryId: string
  sessionId: string
  recoveryKind: "materialization" | "process_cleanup" | "patch_application" | "seal"
  state: "pending" | "resolved" | "failed"
  detail: Record<string, unknown> | null
  lastVerifiedDigest: string | null
  createdAt: string
  resolvedAt: string | null
}

// ── Sandbox Instance --------------------------------------------------------

export interface SandboxInstance {
  instanceId: string
  sessionId: string
  sandboxRoot: string
  backendKind: string
  lifecycleState: "created" | "materializing" | "ready" | "active" | "sealed" | "destroyed"
  sourceTreeDigest: string | null
  canonicalDigest: string | null
  sealedDigest: string | null
  createdAt: string
  destroyedAt: string | null
}

// ── Session Host Config -----------------------------------------------------

export interface SessionHostConfig {
  profileDataRoot: string
  sessionId: string
  ownerIdentityPublicKey: string
}

// ── Session Host State ------------------------------------------------------

export interface SessionHostState {
  sessionId: string
  sandbox: SandboxInstance | null
  lifecycleState: string
  currentKeyEpoch: number
  overlayCount: number
  pendingProposals: number
  activeExecutions: number
}
