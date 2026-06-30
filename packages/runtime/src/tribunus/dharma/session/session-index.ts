/**
 * Dharma Session Authority — Barrel
 *
 * Re-exports all public APIs from the session authority module.
 */

// Types
export type {
  SessionLifecycleState,
  SessionVisibility,
  DharmaSession,
  MembershipStatus,
  SessionMember,
  SessionInvitation,
  Capability,
  GrantProfile,
  ResourceScope,
  SessionAuthorityGrant,
  ExecutionConstraints,
  DisclosureScope,
  ApprovalPolicy,
  DelegationPolicy,
  CommandKind,
  CommandDecision,
  SessionCommandRequest,
  SessionCommandReceipt,
  ApprovalStatus,
  ApprovalRequirement,
  RevocationKind,
  GrantRevocation,
  SessionOwnershipTransfer,
  MutationKind,
  MutationApprovalState,
  WorkspaceMutation,
  WorkspaceOverlay,
  SandboxAdapter,
  CommandResult,
  BackendKind,
  ComputeTrustTier,
  ComputeLeaseStatus,
  ComputeLease,
  DharmaSessionAggregate,
  SessionEventType,
  SessionAuditEventType,
} from "./types"
export {
  ALL_CAPABILITIES,
  CAPABILITY_GROUPS,
  GRANT_PROFILES,
  DEFAULT_EMPTY_SCOPE,
  VALID_SESSION_STATES,
  SESSION_EVENT_TYPES,
} from "./types"

// Errors
export {
  SessionError,
  SessionNotFoundError,
  InvalidStateTransitionError,
  MemberNotFoundError,
  GrantNotFoundError,
  CapabilityDeniedError,
  ScopeDeniedError,
  GrantExpiredError,
  GrantRevokedError,
  KeyEpochMismatchError,
  InvitationExpiredError,
  InvitationInvalidError,
  ApprovalRequiredError,
  SandboxError,
  WorkspaceConflictError,
  OwnershipError,
  ComputeLeaseError,
  AggregateError,
} from "./session-errors"

// Lifecycle
export type { SessionAction } from "./session-lifecycle"
export {
  VALID_SESSION_TRANSITIONS,
  SESSION_ACTION_MAP,
  isValidTransition,
  applyAction,
  isTerminalState,
  isCollaborativeState,
  isMutableState,
  acceptsCommands,
  allowsCompute,
} from "./session-lifecycle"

// Grants
export {
  hasCapability,
  hasAllCapabilities,
  isPathAllowed,
  isCommandAllowed,
  isNetworkDomainAllowed,
  isEnvironmentVariableAllowed,
  isFileExtensionAllowed,
  isGrantValid,
  getProfileCapabilities,
  createGrantFromProfile,
  mergeScope,
  isWithinBudget,
} from "./session-grants"

// Membership
export type { MembershipAction } from "./session-membership"
export {
  VALID_MEMBERSHIP_TRANSITIONS,
  isValidMembershipTransition,
  applyMembershipAction,
  isInvitationValid,
  createMembershipFromInvitation,
  createMember,
  touchMember,
  isMemberActive,
} from "./session-membership"

// Commands
export {
  COMMAND_TO_REQUIRED_CAPABILITY,
  VALID_COMMAND_KINDS,
  APPROVAL_STATUS_TRANSITIONS,
  createCommandRequest,
  createCommandReceipt,
  createApprovalRequirement,
  isApprovalRequired,
  transitionApprovalStatus,
  getIdempotencyKey,
  isFinalDecision,
} from "./session-commands"

// Revocation
export {
  VALID_REVOCATION_TRANSITIONS,
  createRevocation,
  isEmergencyRevocation,
  getNextKeyEpoch,
  isGrantSupersededByEpoch,
  createOwnershipTransfer,
  isValidOwnershipTransfer,
  getDrainDeadline,
} from "./session-revocation"

// Sandbox
export {
  hasPathTraversal,
  resolveSandboxPath,
  isPathWithinSandbox,
  computeDigest,
  validateCommandSafety,
  createNoopSandboxAdapter,
  createLocalSandboxAdapter,
} from "./sandbox-adapter"

// Workspace
export type { MutationAction } from "./workspace-model"
export {
  VALID_MUTATION_TRANSITIONS,
  isValidMutationTransition,
  applyMutationAction,
  createMutation,
  createOverlay,
  updateOverlayAfterMutation,
  hasWorkspaceConflict,
  isDestructiveMutation,
  mutationRequiresApproval,
} from "./workspace-model"

// Controller
export type { SessionContext } from "./session-controller"
export {
  getScopeKind,
  evaluateCommandAuthority,
  checkSessionState,
  checkGrant,
  checkMembership,
  checkKeyEpoch,
  checkScope,
  createRejectionReceipt,
  createAcceptanceReceipt,
  computeAuthorityDigest,
  getEffectiveGrantsForMember,
} from "./session-controller"

// Aggregate
export {
  createSessionAggregate,
  computeAuthorityTopologyDigest,
  computeCollaborationTimelineSummary,
  computeParticipantRoleSummary,
  verifyAggregateDisclosure,
  isAggregateReadyForIngestion,
} from "./session-aggregate"

// API
export type { SessionApi } from "./session-api"
export { Service as SessionApiService, use as useSessionApi, layer as sessionApiLayer } from "./session-api"

// Schema
// Live Sandbox Types
export type {
  SourceManifest,
  SourceFileEntry,
  DigestKind,
  WorkspaceDigestRecord,
  OverlayState,
  OverlayFilesystem,
  PatchProposalState,
  PatchProposal,
  PatchReviewDecision,
  ExecutionState,
  ActiveSandboxExecution,
  TransportMessageKind,
  TransportMessage,
  PeerSessionProjection,
  SessionEventLink,
  RecoveryState,
  SandboxInstance,
  SandboxExecutionRequest,
  SessionHostConfig,
  SessionHostState,
} from "./live/live-types"

// Live Sandbox Errors
export {
  LiveSandboxError,
  MaterializationError,
  DigestMismatchError,
  PathEscapeError,
  ScopeViolationError,
  PatchValidationError,
  PatchConflictError,
  ProcessExecutionError,
  NetworkDeniedError,
  OutputLimitError,
  TransportError,
  RecoveryError,
  ArtifactError,
} from "./live/live-errors"

// Sandbox Layout
export { buildSandboxLayout, getSandboxRoot, getOverlayDir } from "./live/sandbox-layout"

// Source Materializer
export type { MaterializationResult } from "./live/source-materializer"
export {
  materializeSource,
  resolveCommitHash,
  getRepoIdentityDigest,
  computeSourceDigest,
  fileDigest,
  buildSourceManifest,
  scanSourceFiles,
  validatePathInRoot,
} from "./live/source-materializer"
export {
  createEmptyManifest,
  computeManifestDigest,
  manifestContainsPath,
  getManifestTotalSize,
} from "./live/source-manifest"

// Workspace Digest
export type { FileDigestEntry } from "./live/workspace-digest"
export {
  computeWorkspaceDigest,
  digestFromEntries,
  hashBytes,
  shouldExcludeFromDigest,
  collectFileEntries,
} from "./live/workspace-digest"

// Local Filesystem Sandbox
export type { LocalSandboxConfig } from "./live/local-filesystem-sandbox"
export { LocalFilesystemSandboxAdapter } from "./live/local-filesystem-sandbox"

// Overlay Filesystem
export type { OverlayAction } from "./live/overlay-filesystem"
export {
  VALID_OVERLAY_TRANSITIONS,
  isOverlayPathAllowed,
  transitionOverlayState,
  createOverlayFilesystem,
  initOverlayFromCanonical,
  readOverlayFile,
  writeOverlayFile,
  getChangedFiles,
} from "./live/overlay-filesystem"

// Canonical Workspace
export type { CanonicalWorkspace } from "./live/canonical-workspace"
export {
  computeWorkspaceDigest as computeCanonicalDigest,
  initCanonicalWorkspace,
  applyChangesToCanonical,
  verifyCanonicalDigest,
  getCanonicalState,
} from "./live/canonical-workspace"

// Patch
export type { PatchChange } from "./live/patch-builder"
export type { PatchValidationResult } from "./live/patch-validator"
export {
  buildPatchProposal,
  extractChangedPaths,
  computePatchDigest,
  createReviewDecision,
} from "./live/patch-builder"
export {
  validatePatchProposal,
  validateChangedPaths,
  validatePatchSize,
  validateFileCount,
  validateNoProtectedFiles,
  validateBinaryPolicy,
} from "./live/patch-validator"

// Process
export type { ExecutionAction } from "./live/process-runner"
export type { CommandPolicyResult } from "./live/process-policy"
export {
  transitionExecutionState,
  executeBoundedCommand,
  buildSanitizedEnvironment,
  resolveExecutable,
} from "./live/process-runner"
export {
  requiresShell,
  hasUnsafeShellChars,
  isWorkingDirAllowed,
  checkCommandPolicy,
} from "./live/process-policy"

// Network Isolation
export {
  isNetworkCapable,
  getDeniedNetworkCommands,
  checkNetworkAccess,
} from "./live/network-isolation"

// Artifact Bundle
export {
  createArtifactBundle,
  getAllowedExportPaths,
  verifyBundleIntegrity,
} from "./live/artifact-bundle"

// Session Host
export { DharmaSessionHost } from "./live/session-host"
export { DharmaSessionPeerClient } from "./live/session-peer-client"

// Transport
export type { TransportConfig } from "./live/session-transport"
export { createTransportMessage, verifyTransportMessage, isDuplicateMessage } from "./live/session-transport"

// Event Bridge
export { SESSION_LIFECYCLE_EVENTS, SESSION_REQUIRED_EVENTS, createEventLink, markEventPublished, markEventConfirmed } from "./live/session-event-bridge"

// Recovery
export { VALID_RECOVERY_TRANSITIONS, createRecoveryState, markRecoveryResolved, isRecoveryNeeded, getRecoverySummary } from "./live/restart-recovery"

// Live Schema
export {
  DharmaSessionSandboxInstanceTable,
  DharmaSessionSourceManifestTable,
  DharmaSessionWorkspaceDigestTable,
  DharmaSessionOverlayFilesystemTable,
  DharmaSessionPatchProposalTable,
  DharmaSessionPatchReviewTable,
  DharmaSessionSandboxExecutionTable,
  DharmaSessionExecutionOutputTable,
  DharmaSessionProcessGroupTable,
  DharmaSessionNetworkPolicyTable,
  DharmaSessionLiveTransportTable,
  DharmaSessionEventLinkTable,
  DharmaSessionRecoveryStateTable,
  DHARMA_LIVE_SANDBOX_SCHEMA,
} from "./live/live-schema.pg.sql"
export {
  DharmaSessionTable,
  DharmaSessionMemberTable,
  DharmaSessionInvitationTable,
  DharmaSessionGrantTable,
  DharmaSessionGrantRevocationTable,
  DharmaSessionKeyEpochTable,
  DharmaSessionCommandTable,
  DharmaSessionCommandReceiptTable,
  DharmaSessionApprovalTable,
  DharmaSessionOverlayTable,
  DharmaSessionWorkspaceMutationTable,
  DharmaSessionWorkspaceSnapshotTable,
  DharmaSessionArtifactTable,
  DharmaSessionComputeLeaseTable,
  DharmaSessionComputeReceiptTable,
  DharmaSessionAggregateTable,
  DharmaSessionLiveChannelTable,
  DharmaSessionAuditLogTable,
  DHARMA_SESSION_SCHEMA,
} from "./schema.pg.sql"

// Containment
export type {
  ContainmentBackendKind,
  NetworkPolicyMode,
  NetworkPolicy,
  FilesystemPolicy,
  EnvironmentPolicy,
  ResourceLimits,
  ProcessPolicy,
  IpcPolicy,
  ContainedExecutionRequest,
  ContainmentViolationEvent,
  ContainedExecutionReceipt,
  ContainmentProfile,
  ContainedProcessTree,
  ProcessTreeState,
  ContainmentCapability,
  ContainmentViolation,
  ViolationKind,
  ViolationSeverity,
} from "./containment/containment-types"
export {
  ContainmentError,
  FilesystemEscapeError,
  NetworkDeniedError as ContainmentNetworkDenied,
  SecretExposureError,
  ResourceLimitExceededError,
  ProcessSpawnDeniedError,
  IpcDeniedError,
  BackendUnavailableError,
  TerminationError,
  CapabilityDetectionError,
} from "./containment/containment-errors"
export {
  computePolicyDigest,
  compileFilesystemPolicy,
  compileNetworkPolicy,
  compileEnvironmentPolicy,
  compileResourceLimits,
  compileIpcPolicy,
  compileProcessPolicy,
  compileContainmentProfile,
  backendCanSatisfy,
  getDefaultResourceLimits,
} from "./containment/containment-policy"
export {
  DharmaContainmentInstanceTable,
  DharmaContainmentProfileTable,
  DharmaContainmentReceiptTable,
  DharmaContainmentViolationTable,
  DharmaContainmentResourceLimitTable,
  DharmaContainmentProcessTreeTable,
  DharmaContainmentSecretPolicyTable,
  DharmaContainmentNetworkPolicyTable,
  DharmaContainmentDestructionTable,
  DHARMA_CONTAINMENT_SCHEMA,
} from "./containment/containment-schema.pg.sql"
export { MacOSSeatbeltCompatibilityBackend } from "./containment/macos/macos-seatbelt-backend"
export { LinuxNamespaceBackend } from "./containment/linux/linux-backend"
