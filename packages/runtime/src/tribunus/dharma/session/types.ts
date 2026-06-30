/**
 * Dharma Session Authority — Core Types
 *
 * Defines every type from the Dharma Collaborative Engineering Fabric spec.
 * This module is a LEAF — it imports nothing from any other session module.
 */

// ── Session Lifecycle --------------------------------------------------------

export type SessionLifecycleState =
  | "draft"
  | "materializing"
  | "ready"
  | "active"
  | "draining"
  | "sealed"
  | "exported"
  | "archived"
  | "cancelled"
  | "failed"
  | "suspended"
  | "terminated"

export const VALID_SESSION_STATES: readonly SessionLifecycleState[] = [
  "draft", "materializing", "ready", "active", "draining",
  "sealed", "exported", "archived", "cancelled", "failed",
  "suspended", "terminated",
] as const

// ── Session Root -------------------------------------------------------------

export interface DharmaSession {
  sessionId: string
  federationId: string
  ownerIdentityPublicKey: string
  ownerDeviceId: string | null
  projectReference: string
  sourceRevision: string
  sourceTreeDigest: string
  sourceManifestDigest: string | null
  sandboxRuntimeKind: string
  sandboxImageDigest: string | null
  sandboxPolicyDigest: string | null
  collaborationPolicyDigest: string | null
  disclosurePolicyDigest: string | null
  lifecycleState: SessionLifecycleState
  visibility: SessionVisibility
  createdAt: string
  activatedAt: string | null
  sealedAt: string | null
  expiresAt: string | null
  sessionKeyEpoch: number
  predecessorSessionId: string | null
  successorSessionId: string | null
}

export type SessionVisibility = "private" | "federation" | "discoverable"

// ── Session Membership -------------------------------------------------------

export type MembershipStatus =
  | "invited"
  | "joining"
  | "active"
  | "suspended"
  | "removed"
  | "left"
  | "expired"

export interface SessionMember {
  membershipId: string
  sessionId: string
  peerIdentityPublicKey: string
  peerDeviceId: string | null
  invitedByIdentityPublicKey: string
  displayRole: string
  status: MembershipStatus
  joinedAt: string | null
  suspendedAt: string | null
  removedAt: string | null
  lastSeenAt: string | null
  currentKeyEpoch: number
}

// ── Session Invitations ------------------------------------------------------

export interface SessionInvitation {
  invitationId: string
  sessionId: string
  federationId: string
  inviterIdentityPublicKey: string
  inviteeIdentityPublicKey: string | null
  initialDisplayRole: string
  initialGrantTemplates: string[]
  sessionKeyEpoch: number
  expiresAt: string
  maxUses: number
  visibilitySummary: string
  encryptedJoinPayload: string | null
  signature: string
}

// ── Authority Grants ---------------------------------------------------------

export type Capability =
  | "session.inspect"
  | "session.view_members"
  | "session.view_activity"
  | "session.invite_peer"
  | "session.remove_peer"
  | "session.modify_grants"
  | "session.pause"
  | "session.resume"
  | "session.drain"
  | "session.seal"
  | "session.export_artifacts"
  | "session.transfer_ownership"
  | "workspace.read"
  | "workspace.create_file"
  | "workspace.write"
  | "workspace.delete_file"
  | "workspace.rename_file"
  | "workspace.stage_patch"
  | "workspace.apply_patch"
  | "workspace.revert_own_changes"
  | "workspace.revert_any_changes"
  | "workspace.merge_overlay"
  | "workspace.resolve_conflict"
  | "terminal.execute_safe"
  | "terminal.execute_networked"
  | "terminal.execute_privileged"
  | "terminal.install_dependency"
  | "terminal.run_tests"
  | "terminal.run_benchmarks"
  | "terminal.inspect_processes"
  | "terminal.read_logs"
  | "agent.propose_plan"
  | "agent.run_readonly"
  | "agent.run_workspace_limited"
  | "agent.run_command_limited"
  | "agent.request_escalation"
  | "agent.inspect_results"
  | "artifact.read"
  | "artifact.export_patch"
  | "artifact.export_logs"
  | "artifact.export_reports"
  | "artifact.share_evidence"
  | "compute.request_local"
  | "compute.request_trusted_lan"
  | "compute.request_federation"
  | "compute.request_external"
  | "compute.approve_lease"
  | "compute.cancel_lease"

export const ALL_CAPABILITIES: readonly Capability[] = [
  "session.inspect", "session.view_members", "session.view_activity",
  "session.invite_peer", "session.remove_peer", "session.modify_grants",
  "session.pause", "session.resume", "session.drain", "session.seal",
  "session.export_artifacts", "session.transfer_ownership",
  "workspace.read", "workspace.create_file", "workspace.write",
  "workspace.delete_file", "workspace.rename_file", "workspace.stage_patch",
  "workspace.apply_patch", "workspace.revert_own_changes", "workspace.revert_any_changes",
  "workspace.merge_overlay", "workspace.resolve_conflict",
  "terminal.execute_safe", "terminal.execute_networked", "terminal.execute_privileged",
  "terminal.install_dependency", "terminal.run_tests", "terminal.run_benchmarks",
  "terminal.inspect_processes", "terminal.read_logs",
  "agent.propose_plan", "agent.run_readonly", "agent.run_workspace_limited",
  "agent.run_command_limited", "agent.request_escalation", "agent.inspect_results",
  "artifact.read", "artifact.export_patch", "artifact.export_logs",
  "artifact.export_reports", "artifact.share_evidence",
  "compute.request_local", "compute.request_trusted_lan", "compute.request_federation",
  "compute.request_external", "compute.approve_lease", "compute.cancel_lease",
] as const

export const CAPABILITY_GROUPS = {
  session: [
    "session.inspect", "session.view_members", "session.view_activity",
    "session.invite_peer", "session.remove_peer", "session.modify_grants",
    "session.pause", "session.resume", "session.drain", "session.seal",
    "session.export_artifacts", "session.transfer_ownership",
  ] as Capability[],
  workspace: [
    "workspace.read", "workspace.create_file", "workspace.write",
    "workspace.delete_file", "workspace.rename_file", "workspace.stage_patch",
    "workspace.apply_patch", "workspace.revert_own_changes", "workspace.revert_any_changes",
    "workspace.merge_overlay", "workspace.resolve_conflict",
  ] as Capability[],
  terminal: [
    "terminal.execute_safe", "terminal.execute_networked", "terminal.execute_privileged",
    "terminal.install_dependency", "terminal.run_tests", "terminal.run_benchmarks",
    "terminal.inspect_processes", "terminal.read_logs",
  ] as Capability[],
  agent: [
    "agent.propose_plan", "agent.run_readonly", "agent.run_workspace_limited",
    "agent.run_command_limited", "agent.request_escalation", "agent.inspect_results",
  ] as Capability[],
  artifact: [
    "artifact.read", "artifact.export_patch", "artifact.export_logs",
    "artifact.export_reports", "artifact.share_evidence",
  ] as Capability[],
  compute: [
    "compute.request_local", "compute.request_trusted_lan", "compute.request_federation",
    "compute.request_external", "compute.approve_lease", "compute.cancel_lease",
  ] as Capability[],
} as const

// ── Authority Profiles -------------------------------------------------------

export type GrantProfile =
  | "observer"
  | "reviewer"
  | "contributor"
  | "test_runner"
  | "maintainer"
  | "session_coowner"

export const GRANT_PROFILES: Record<GrantProfile, Capability[]> = {
  observer: [
    "session.inspect", "session.view_members", "session.view_activity",
    "workspace.read", "artifact.read",
  ],
  reviewer: [
    "session.inspect", "session.view_members", "session.view_activity",
    "workspace.read", "workspace.stage_patch", "workspace.revert_own_changes",
    "terminal.run_tests", "terminal.read_logs",
    "agent.propose_plan",
    "artifact.read",
  ],
  contributor: [
    "session.inspect", "session.view_members", "session.view_activity",
    "workspace.read", "workspace.create_file", "workspace.write",
    "workspace.rename_file", "workspace.stage_patch", "workspace.apply_patch",
    "workspace.revert_own_changes",
    "terminal.execute_safe", "terminal.run_tests", "terminal.read_logs",
    "agent.propose_plan", "agent.run_workspace_limited",
    "artifact.read",
  ],
  test_runner: [
    "session.inspect", "session.view_members", "session.view_activity",
    "workspace.read",
    "terminal.run_tests", "terminal.run_benchmarks", "terminal.execute_safe",
    "artifact.read", "artifact.export_reports",
  ],
  maintainer: [
    "session.inspect", "session.view_members", "session.view_activity",
    "workspace.read", "workspace.create_file", "workspace.write",
    "workspace.delete_file", "workspace.rename_file",
    "workspace.stage_patch", "workspace.apply_patch",
    "workspace.revert_own_changes", "workspace.revert_any_changes",
    "workspace.merge_overlay", "workspace.resolve_conflict",
    "terminal.execute_safe", "terminal.execute_networked",
    "terminal.install_dependency", "terminal.run_tests", "terminal.run_benchmarks",
    "terminal.read_logs",
    "agent.propose_plan", "agent.run_workspace_limited", "agent.run_command_limited",
    "artifact.read", "artifact.export_patch", "artifact.export_logs", "artifact.export_reports",
    "compute.request_local",
  ],
  session_coowner: [
    "session.inspect", "session.view_members", "session.view_activity",
    "session.invite_peer", "session.modify_grants",
    "session.pause", "session.resume", "session.drain",
    "workspace.read", "workspace.create_file", "workspace.write",
    "workspace.delete_file", "workspace.rename_file",
    "workspace.stage_patch", "workspace.apply_patch",
    "workspace.revert_own_changes", "workspace.revert_any_changes",
    "workspace.merge_overlay", "workspace.resolve_conflict",
    "terminal.execute_safe", "terminal.execute_networked",
    "terminal.install_dependency", "terminal.run_tests", "terminal.run_benchmarks",
    "terminal.read_logs",
    "agent.propose_plan", "agent.run_workspace_limited", "agent.run_command_limited",
    "artifact.read", "artifact.export_patch", "artifact.export_logs", "artifact.export_reports",
    "compute.request_local", "compute.approve_lease",
  ],
}

// ── Resource Scope -----------------------------------------------------------

export interface ResourceScope {
  allowedPaths: string[]
  deniedPaths: string[]
  allowedFileExtensions: string[]
  deniedFileExtensions: string[]
  allowedCommands: string[]
  deniedCommands: string[]
  allowedNetworkDomains: string[]
  deniedNetworkDomains: string[]
  allowedEnvironmentVariables: string[]
  deniedEnvironmentVariables: string[]
  maximumRuntimeSeconds: number
  maximumCpuSeconds: number
  maximumMemoryBytes: number
  maximumDiskWriteBytes: number
  maximumProcessCount: number
  maximumOutputBytes: number
  maximumComputeTokens: number | null
  maximumComputeCost: number | null
}

export const DEFAULT_EMPTY_SCOPE: ResourceScope = {
  allowedPaths: [], deniedPaths: [],
  allowedFileExtensions: [], deniedFileExtensions: [],
  allowedCommands: [], deniedCommands: [],
  allowedNetworkDomains: [], deniedNetworkDomains: [],
  allowedEnvironmentVariables: [], deniedEnvironmentVariables: [],
  maximumRuntimeSeconds: 0, maximumCpuSeconds: 0,
  maximumMemoryBytes: 0, maximumDiskWriteBytes: 0,
  maximumProcessCount: 0, maximumOutputBytes: 0,
  maximumComputeTokens: null, maximumComputeCost: null,
}

// ── Authority Grant ----------------------------------------------------------

export interface SessionAuthorityGrant {
  grantId: string
  sessionId: string
  subjectIdentityPublicKey: string
  subjectMembershipId: string
  issuedByIdentityPublicKey: string
  issuedByGrantId: string | null
  capabilitySet: Capability[]
  resourceScope: ResourceScope
  executionConstraints: ExecutionConstraints | null
  disclosureScope: DisclosureScope | null
  approvalPolicy: ApprovalPolicy | null
  delegationPolicy: DelegationPolicy | null
  issuedAt: string
  expiresAt: string | null
  revokedAt: string | null
  revocationReason: string | null
  sessionKeyEpoch: number
  signature: string
}

export interface ExecutionConstraints {
  maximumRuntimeSeconds: number
  maximumCpuSeconds: number
  maximumMemoryBytes: number
  maximumProcessCount: number
}

export interface DisclosureScope {
  allowedEvidenceClasses: string[]
  deniedEvidenceClasses: string[]
  maximumOutputClassification: string
}

export interface ApprovalPolicy {
  requiresApprovalForActions: string[]
  requiredApproverRoles: string[]
  requiredApprovalCount: number
}

export interface DelegationPolicy {
  allowed: boolean
  maxDelegationDepth: number
  restrictedCapabilities: Capability[]
}

// ── Session Commands ---------------------------------------------------------

export type CommandKind =
  | "inspect_workspace"
  | "read_file"
  | "write_file"
  | "apply_patch"
  | "create_overlay"
  | "merge_overlay"
  | "discard_overlay"
  | "execute_command"
  | "terminate_command"
  | "request_compute_lease"
  | "approve_compute_lease"
  | "cancel_compute_lease"
  | "invite_participant"
  | "revoke_grant"
  | "request_escalation"
  | "approve_escalation"
  | "seal_session"
  | "export_artifact"

export type CommandDecision =
  | "accepted"
  | "rejected"
  | "pending_approval"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "revoked"

export interface SessionCommandRequest {
  requestId: string
  sessionId: string
  actorIdentityPublicKey: string
  actorMembershipId: string
  grantId: string
  sessionKeyEpoch: number
  commandKind: CommandKind
  targetScope: string
  payloadDigest: string
  payloadReference: string | null
  idempotencyKey: string
  requestedAt: string
  signature: string
}

export interface SessionCommandReceipt {
  receiptId: string
  requestId: string
  sessionId: string
  actorIdentityPublicKey: string
  decision: CommandDecision
  denialReason: string | null
  authorityEvaluationDigest: string | null
  executionId: string | null
  workspaceBeforeDigest: string | null
  workspaceAfterDigest: string | null
  outputDigest: string | null
  artifactDigest: string | null
  computeLeaseId: string | null
  createdAt: string
  finalizedAt: string | null
  controllerSignature: string
}

// ── Approval -----------------------------------------------------------------

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "executed"
  | "rejected"
  | "expired"
  | "revoked"

export interface ApprovalRequirement {
  approvalId: string
  sessionId: string
  requestId: string
  requestedByIdentity: string
  requiredApproverRoles: string[]
  requiredApprovalCount: number
  scope: string
  expiresAt: string
  status: ApprovalStatus
}

// ── Revocation ---------------------------------------------------------------

export type RevocationKind = "graceful" | "emergency"

export interface GrantRevocation {
  revocationId: string
  sessionId: string
  grantId: string
  subjectIdentityPublicKey: string
  revokedByIdentityPublicKey: string
  reason: string
  kind: RevocationKind
  effectiveAt: string
  previousKeyEpoch: number
  nextKeyEpoch: number
  signature: string
}

// ── Ownership Transfer -------------------------------------------------------

export interface SessionOwnershipTransfer {
  transferId: string
  sessionId: string
  previousOwnerIdentityPublicKey: string
  newOwnerIdentityPublicKey: string
  workspaceDigest: string
  activeGrantSummaryDigest: string
  transferReason: string
  initiatedAt: string
  acceptedAt: string | null
  previousOwnerSignature: string
  newOwnerSignature: string | null
}

// ── Workspace ----------------------------------------------------------------

export type MutationKind =
  | "file_create"
  | "file_update"
  | "file_delete"
  | "file_rename"
  | "patch_apply"
  | "patch_revert"
  | "overlay_merge"
  | "dependency_manifest_update"
  | "generated_artifact_write"

export type MutationApprovalState =
  | "pending"
  | "accepted"
  | "rejected"
  | "resolved"
  | "conflict"

export interface WorkspaceMutation {
  mutationId: string
  sessionId: string
  actorIdentityPublicKey: string
  overlayId: string | null
  grantId: string
  baseWorkspaceDigest: string
  targetWorkspaceDigest: string | null
  mutationKind: MutationKind
  pathScope: string
  beforeDigest: string | null
  afterDigest: string | null
  patchDigest: string | null
  approvalState: MutationApprovalState
  acceptedBy: string | null
  acceptedAt: string | null
  createdAt: string
}

export interface WorkspaceOverlay {
  overlayId: string
  sessionId: string
  ownerIdentityPublicKey: string
  baseWorkspaceDigest: string
  currentDigest: string
  mutationCount: number
  createdAt: string
}

// ── Sandbox ------------------------------------------------------------------

export interface SandboxAdapter {
  createSandbox(): Promise<string>
  materializeProject(): Promise<{ sourceTreeDigest: string }>
  verifySourceDigest(expected: string): Promise<boolean>
  startController(): Promise<void>
  stopController(): Promise<void>
  pauseSandbox(): Promise<void>
  resumeSandbox(): Promise<void>
  readPath(path: string): Promise<Uint8Array>
  writePath(path: string, data: Uint8Array): Promise<void>
  applyPatch(patch: Uint8Array): Promise<string>
  createOverlay(identity: string): Promise<string>
  mergeOverlay(overlayId: string): Promise<string>
  discardOverlay(overlayId: string): Promise<void>
  executeCommand(command: string, args: string[], scope: ResourceScope): Promise<CommandResult>
  terminateExecution(executionId: string): Promise<void>
  snapshotWorkspace(): Promise<string>
  exportArtifactBundle(): Promise<Uint8Array>
  destroySandbox(): Promise<void>
}

export interface CommandResult {
  executionId: string
  exitCode: number | null
  stdout: string
  stderr: string
  runtimeMs: number
  memoryBytes: number
}

// ── Compute Lease ------------------------------------------------------------

export type BackendKind =
  | "prism_local"
  | "prism_lan"
  | "prism_federated"
  | "exo"
  | "petals_experimental"
  | "llmd_prism"
  | "llmd_external"
  | "vllm_external"

export type ComputeTrustTier = 0 | 1 | 2 | 3

export type ComputeLeaseStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "draining"

export interface ComputeLease {
  leaseId: string
  sessionId: string
  requesterIdentityPublicKey: string
  requesterMembershipId: string
  providerIdentityPublicKey: string | null
  backendKind: BackendKind
  trustTier: ComputeTrustTier
  modelArtifactDigest: string
  workloadClass: string
  inputDisclosureClass: string
  inputDigest: string
  outputDisclosureClass: string
  maximumTokens: number | null
  maximumRuntimeSeconds: number
  maximumMemoryBytes: number
  maximumCost: number | null
  dharmaCreditAmount: number | null
  routingPolicy: string
  issuedAt: string
  expiresAt: string
  revocationEpoch: number
  status: ComputeLeaseStatus
  signatureChain: string
}

// ── Session Aggregate --------------------------------------------------------

export interface DharmaSessionAggregate {
  aggregateId: string
  sessionId: string
  federationId: string
  ownerIdentityPublicKey: string
  sourceRevisionDigest: string
  environmentDigest: string | null
  taskTaxonomy: string
  taskSummaryDigest: string
  authorityTopologyDigest: string
  participantRoleSummary: string
  collaborationTimelineSummary: string
  approvedActionSummaries: string
  verificationResults: string
  acceptedPatchDigests: string[]
  executionReceiptDigests: string[]
  computeUsageSummary: string
  outcomeClassification: string
  contributionReceiptIds: string[]
  disclosurePolicy: string
  redactionManifestDigest: string | null
  provenanceChainDigest: string
  emittedAt: string
  signatureChain: string[]
}

// ── Session Event Types ------------------------------------------------------

export type SessionEventType =
  | "session.created"
  | "session.materialization_started"
  | "session.materialized"
  | "session.materialization_failed"
  | "session.activated"
  | "session.suspended"
  | "session.resumed"
  | "session.draining"
  | "session.sealed"
  | "session.exported"
  | "session.archived"
  | "session.terminated"
  | "session.member_invited"
  | "session.member_joined"
  | "session.member_suspended"
  | "session.member_removed"
  | "session.member_left"
  | "session.grant_issued"
  | "session.grant_revoked"
  | "session.key_epoch_rotated"
  | "session.ownership_transfer_proposed"
  | "session.ownership_transfer_accepted"
  | "session.command_requested"
  | "session.command_approved"
  | "session.command_rejected"
  | "session.command_completed"
  | "session.command_failed"
  | "session.command_cancelled"
  | "session.workspace_mutation_proposed"
  | "session.workspace_mutation_accepted"
  | "session.workspace_mutation_rejected"
  | "session.workspace_conflict_detected"
  | "session.compute_lease_requested"
  | "session.compute_lease_issued"
  | "session.compute_lease_completed"
  | "session.compute_lease_failed"
  | "session.compute_lease_cancelled"
  | "session.aggregate_emitted"

export const SESSION_EVENT_TYPES: readonly SessionEventType[] = [
  "session.created", "session.materialization_started", "session.materialized",
  "session.materialization_failed", "session.activated", "session.suspended",
  "session.resumed", "session.draining", "session.sealed", "session.exported",
  "session.archived", "session.terminated",
  "session.member_invited", "session.member_joined", "session.member_suspended",
  "session.member_removed", "session.member_left",
  "session.grant_issued", "session.grant_revoked", "session.key_epoch_rotated",
  "session.ownership_transfer_proposed", "session.ownership_transfer_accepted",
  "session.command_requested", "session.command_approved", "session.command_rejected",
  "session.command_completed", "session.command_failed", "session.command_cancelled",
  "session.workspace_mutation_proposed", "session.workspace_mutation_accepted",
  "session.workspace_mutation_rejected", "session.workspace_conflict_detected",
  "session.compute_lease_requested", "session.compute_lease_issued",
  "session.compute_lease_completed", "session.compute_lease_failed",
  "session.compute_lease_cancelled",
  "session.aggregate_emitted",
] as const

// ── Audit Event Types --------------------------------------------------------

export type SessionAuditEventType =
  | "session.created"
  | "session.materialized"
  | "session.activated"
  | "session.member_joined"
  | "session.grant_issued"
  | "session.grant_revoked"
  | "session.command_requested"
  | "session.command_approved"
  | "session.command_rejected"
  | "session.command_completed"
  | "session.workspace_mutation_accepted"
  | "session.workspace_mutation_rejected"
  | "session.compute_lease_issued"
  | "session.compute_lease_completed"
  | "session.key_epoch_rotated"
  | "session.sealed"
  | "session.aggregate_emitted"
