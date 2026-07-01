/**
 * Dharma Multi-Peer Result Convergence — Barrel
 *
 * Re-exports all public APIs from the multi-peer result convergence module.
 */

// Types
export type {
  TaskKind,
  TaskParallelism,
  TaskStatus,
  DharmaTaskContract,
  AcceptancePolicyLevel,
  ClaimStatus,
  DharmaTaskClaim,
  DisclosureClass,
  SourceDisclosurePackage,
  SessionResultBundle,
  ResultValidationState,
  ResultValidation,
  CanonicalSessionOutcome,
  ConflictKind,
  ConflictResolutionState,
  SessionResultConflict,
  ArtifactAccessRequest,
  ArtifactAccessDecision,
  VerificationPolicy,
  MultiPeerEventType,
  MultiPeerCapability,
} from "./multi-peer-types"
export {
  MULTI_PEER_EVENT_TYPES,
  MULTI_PEER_CAPABILITIES,
} from "./multi-peer-types"

// Errors
export {
  MultiPeerError,
  TaskError,
  ClaimError,
  SourcePackageError,
  ResultValidationError,
  ConflictError,
  ArtifactAccessError,
  CanonicalOutcomeError,
} from "./multi-peer-errors"

// Tasks
export type {
  ExtendedTaskStatus,
  TaskAction,
  CreateTaskConfig,
} from "./multi-peer-tasks"
export {
  VALID_TASK_TRANSITIONS,
  applyTaskAction,
  createTask,
  isTaskClaimable,
  isTaskCompleted,
} from "./multi-peer-tasks"

// Claims
export type {
  ClaimAction,
  CreateClaimConfig,
} from "./multi-peer-claims"
export {
  VALID_CLAIM_TRANSITIONS,
  applyClaimAction,
  createClaim,
  isClaimActive,
  canClaimTask,
} from "./multi-peer-claims"

// Validation
export {
  validateResultBundle,
  checkSourceBasis,
  checkPathScope,
  checkContainmentProfile,
  checkVerificationPolicy,
} from "./multi-peer-validation"

// Source Disclosure
export {
  createSourcePackage,
  isPackageAuthorizedForMember,
  getPackageScope,
  isPackageExpired,
} from "./multi-peer-source"

// Artifact Access
export {
  createAccessRequest,
  createAccessDecision,
  isAccessGranted,
  isAccessExpired,
} from "./multi-peer-artifact"

// Canonical Outcomes
export {
  createFirstOutcome,
  createNextOutcome,
  getOutcomeChain,
  verifyOutcomeChain,
} from "./multi-peer-outcome"

// Conflict Detection
export {
  detectConflict,
  checkStaleBasis,
  checkPathOverlap,
  checkClaimViolation,
  createConflictRecord,
} from "./multi-peer-conflict"
export { resolveConflict } from "./multi-peer-conflict"

// API
export { MultiPeerApi } from "./multi-peer-api"

// Schema
export {
  DharmaSessionTaskTable,
  DharmaSessionTaskClaimTable,
  DharmaSessionSourcePackageTable,
  DharmaSessionSourcePackageRecipientTable,
  DharmaSessionResultBundleTable,
  DharmaSessionCanonicalOutcomeTable,
  DharmaSessionResultConflictTable,
  DharmaSessionArtifactAccessRequestTable,
  DharmaSessionArtifactAccessDecisionTable,
  DharmaSessionParallelWorkPolicyTable,
  DHARMA_MULTI_PEER_SCHEMA,
} from "./multi-peer-schema.pg.sql"
