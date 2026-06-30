/**
 * Dharma Federation Runtime — Barrel
 *
 * Re-exports every public API from the Dharma subsystem.
 * Import from `@tribunus/runtime/tribunus/dharma`.
 */

// Types
export type {
  IdentityStatus,
  DeviceIdentity,
  DharmaIdentity,
  FederationVisibility,
  FederationStatus,
  Federation,
  FederationMembership,
  MembershipStatus,
  FederationRole,
  RoleClaim,
  EventType,
  DharmaEventEnvelope,
  EventValidationState,
  EventValidation,
  WorkOfferVisibility,
  WorkOfferStatus,
  CapabilityClass,
  EffortBand,
  WorkOffer,
  WorkClaim,
  WorkClaimStatus,
  ContributionClass,
  DisclosureLevel,
  ReceiptStatus,
  ContributionReceipt,
  ReceiptAcceptance,
  DharmaBalance,
  BalanceEntry,
  BalanceCategory,
  TrustScope,
  TrustDecisionType,
  TrustAttestation,
  TrustDecision,
  TrustTargetType,
  ModerationSeverity,
  ModerationStatus,
  ModerationDecisionType,
  ModerationFlag,
  ModerationDecision,
  ModerationAppeal,
  AppealStatus,
  FederationPolicy,
  ReplicationCursor,
  ReplicationStatus,
  AuditEventType,
  AuditEvent,
  QuarantineEntry,
  OutboxEntry,
  OutboxStatus,
  DharmaMutationContext,
  RemotePeer,
  Checkpoint,
} from "./types"

// Constants and helpers from types
export {
  DHARMA_EVENT_SCHEMA_VERSION,
  FEDERATION_ROLES,
  EVENT_TYPES,
  GOVERNANCE_EVENT_TYPES,
  MUTABLE_ENTITY_EVENT_TYPES,
  CONTRIBUTION_CLASSES,
  TRUST_SCOPES,
  canonicalJson,
  deriveEventId,
  sha256Hex,
} from "./types"

// Crypto
export type { KeyPair, EncryptedKeyBundle } from "./crypto"
export {
  generateKeyPair,
  sign,
  verify,
  sha256,
  serializeEncryptedBundle,
  deserializeEncryptedBundle,
  encryptPrivateKey,
  decryptPrivateKey,
} from "./crypto"

// Identity
export { IdentityVault } from "./identity"

// Event codec
export type { UnsignedEvent } from "./event-codec"
export {
  computePayloadHash,
  buildSigningPayload,
  createSignedEvent,
  verifyEventSignature,
  serializeEvent,
  deserializeEvent,
} from "./event-codec"

// Event validator
export type { ValidationResult } from "./event-validator"
export {
  validateEvent,
  validateEventType,
  validateSchemaVersion,
  validateSignature,
  validateCausalParents,
  createValidationRecord,
} from "./event-validator"

// Event store
export type { QueryFilters as EventStoreQueryFilters, Interface as EventStore } from "./event-store"
export { Service as EventStoreService, use as useEventStore, layer as eventStoreLayer, encodeForDb as encodeEventForDb, decodeFromDb as decodeEventFromDb } from "./event-store"

// Audit
export type { AuditQueryFilters, Interface as AuditService } from "./audit"
export { Service as AuditServiceTag, use as useAudit, layer as auditLayer } from "./audit"

// Federation
export type { FederationAction, MembershipAction } from "./federation"
export {
  VALID_FEDERATION_TRANSITIONS,
  isValidTransition,
  getNextStatus,
  createFederationConfig,
  isValidRole,
  VALID_MEMBERSHIP_TRANSITIONS,
  getInitialMembershipStatus,
  createMembership,
  getNextMembershipStatus,
} from "./federation"

// Work
export {
  VALID_WORK_OFFER_TRANSITIONS,
  isValidWorkOfferTransition,
  VALID_WORK_CLAIM_TRANSITIONS,
  isValidWorkClaimTransition,
  createWorkOffer,
  createWorkClaim,
} from "./work"

// Receipt
export {
  VALID_RECEIPT_TRANSITIONS,
  isValidReceiptTransition,
  createReceipt,
  getDefaultDisclosureLevel,
} from "./receipt"

// Balance
export {
  computeBalance,
  createEmptyBalance,
  applyReceiptToBalance,
  createBalanceEntry,
} from "./balance"

// API
export type { DharmaApi } from "./api"
export { Service as DharmaApiService, use as useDharmaApi, layer as dharmaApiLayer } from "./api"

// Schema
export {
  DharmaIdentityTable,
  DharmaIdentityKeyTable,
  DharmaFederationTable,
  DharmaMembershipTable,
  DharmaRawEventTable,
  DharmaEventValidationTable,
  DharmaEventQuarantineTable,
  DharmaWorkOfferTable,
  DharmaWorkClaimTable,
  DharmaReceiptTable,
  DharmaReceiptAcceptanceTable,
  DharmaTrustEdgeTable,
  DharmaModerationCaseTable,
  DharmaBalanceTable,
  DharmaBalanceEntryTable,
  DharmaReplicationCursorTable,
  DharmaCheckpointTable,
  DharmaOutboxTable,
  DharmaAuditLogTable,
  DharmaRemotePeerTable,
  DHARMA_ALL_SCHEMA,
} from "./schema.pg.sql"
