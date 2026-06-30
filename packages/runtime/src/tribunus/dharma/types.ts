/**
 * Dharma Federation Runtime — Core Types
 *
 * Defines every type and enum from the Dharma v1 specification.
 * This module is a LEAF — it imports nothing from any other dharma module.
 */

import { createHash } from "node:crypto"

// ── Identity -----------------------------------------------------------------

export const DHARMA_EVENT_SCHEMA_VERSION = 1

export type IdentityStatus = "active" | "rotated" | "revoked" | "compromised"

export interface DeviceIdentity {
  deviceId: string
  devicePublicKey: Uint8Array
  encryptedDevicePrivateKey: Uint8Array
  createdAt: string
  revokedAt: string | null
}

export interface DharmaIdentity {
  identityId: string
  publicKey: Uint8Array
  encryptedPrivateKey: Uint8Array
  displayName: string
  profileVersion: number
  createdAt: string
  status: IdentityStatus
  recoveryPolicy: string | null
}

// ── Federation ---------------------------------------------------------------

export type FederationVisibility = "private" | "invite_only" | "discoverable"

export type FederationStatus = "unaware" | "discovered" | "invited" | "joining" | "active" | "limited" | "suspended" | "left" | "revoked"

export interface Federation {
  federationId: string
  genesisEventHash: string
  name: string
  description: string
  visibility: FederationVisibility
  createdAt: string
  policyVersion: number
  status: FederationStatus
}

export interface FederationMembership {
  federationId: string
  identityId: string
  role: FederationRole
  joinedAt: string
  expiresAt: string | null
  status: MembershipStatus
}

export type MembershipStatus = "pending" | "active" | "suspended" | "left" | "revoked"

// ── Roles --------------------------------------------------------------------

export type FederationRole =
  | "member"
  | "contributor"
  | "reviewer"
  | "moderator"
  | "steward"
  | "observer"

export const FEDERATION_ROLES: readonly FederationRole[] = [
  "member",
  "contributor",
  "reviewer",
  "moderator",
  "steward",
  "observer",
] as const

export interface RoleClaim {
  claimId: string
  issuerPublicKey: string
  subjectPublicKey: string
  role: FederationRole
  scope: string
  issuedAt: string
  expiresAt: string | null
  signatureChain: string[]
}

// ── Events -------------------------------------------------------------------

export type EventType =
  | "federation.genesis"
  | "federation.policy_proposed"
  | "federation.policy_accepted"
  | "federation.member_invited"
  | "federation.member_joined"
  | "federation.member_left"
  | "federation.role_granted"
  | "federation.role_revoked"
  | "identity.rotate"
  | "identity.profile_updated"
  | "work.offer_created"
  | "work.offer_updated"
  | "work.offer_cancelled"
  | "work.claim_created"
  | "work.claim_released"
  | "work.claim_expired"
  | "work.completion_attested"
  | "receipt.issued"
  | "receipt.accepted"
  | "receipt.rejected"
  | "receipt.voided"
  | "trust.attested"
  | "trust.revoked"
  | "moderation.flagged"
  | "moderation.decision"
  | "moderation.appeal_created"
  | "moderation.appeal_decided"
  | "replication.checkpoint"

export const EVENT_TYPES: readonly EventType[] = [
  "federation.genesis",
  "federation.policy_proposed",
  "federation.policy_accepted",
  "federation.member_invited",
  "federation.member_joined",
  "federation.member_left",
  "federation.role_granted",
  "federation.role_revoked",
  "identity.rotate",
  "identity.profile_updated",
  "work.offer_created",
  "work.offer_updated",
  "work.offer_cancelled",
  "work.claim_created",
  "work.claim_released",
  "work.claim_expired",
  "work.completion_attested",
  "receipt.issued",
  "receipt.accepted",
  "receipt.rejected",
  "receipt.voided",
  "trust.attested",
  "trust.revoked",
  "moderation.flagged",
  "moderation.decision",
  "moderation.appeal_created",
  "moderation.appeal_decided",
  "replication.checkpoint",
] as const

export const GOVERNANCE_EVENT_TYPES: readonly EventType[] = [
  "federation.genesis",
  "federation.policy_proposed",
  "federation.policy_accepted",
  "federation.member_invited",
  "federation.member_joined",
  "federation.member_left",
  "federation.role_granted",
  "federation.role_revoked",
  "moderation.decision",
  "moderation.appeal_decided",
] as const

export const MUTABLE_ENTITY_EVENT_TYPES: readonly EventType[] = [
  "identity.rotate",
  "identity.profile_updated",
  "work.offer_updated",
  "work.offer_cancelled",
  "work.claim_released",
  "replication.checkpoint",
] as const

export interface DharmaEventEnvelope {
  eventId: string
  federationId: string
  eventType: EventType
  schemaVersion: number
  actorPublicKey: string
  actorDeviceId: string | null
  createdAt: string
  logicalClock: number
  causalParents: string[]
  payloadHash: string
  payload: Record<string, unknown>
  signature: string
}

// ── Event Validation ---------------------------------------------------------

export type EventValidationState =
  | "received"
  | "schema_verified"
  | "signature_verified"
  | "dependency_verified"
  | "policy_evaluated"
  | "accepted"
  | "pending_dependencies"
  | "quarantined"
  | "rejected"
  | "superseded"

export interface EventValidation {
  eventId: string
  validationState: EventValidationState
  validationReason: string | null
  validatedAt: string
  policyDigest: string | null
  validatorVersion: number
}

// ── Work Offers --------------------------------------------------------------

export type WorkOfferVisibility = "federation_only" | "public_summary"

export type WorkOfferStatus =
  | "draft"
  | "published"
  | "claimed"
  | "in_progress"
  | "completion_attested"
  | "receipt_issued"
  | "settled"
  | "cancelled"
  | "expired"
  | "released"

export type CapabilityClass =
  | "analysis"
  | "code_review"
  | "benchmark_reproduction"
  | "documentation"
  | "controlled_patch_preparation"
  | "research"
  | "triage"

export type EffortBand = "xs" | "s" | "m" | "l" | "xl"

export interface WorkOffer {
  offerId: string
  federationId: string
  creatorIdentity: string
  title: string
  summary: string
  category: string
  requestedOutcome: string
  artifactScope: string
  maxEffortBand: EffortBand
  dharmaOfferAmount: number
  visibility: WorkOfferVisibility
  requiredRoles: FederationRole[]
  capabilityClass: CapabilityClass
  expiresAt: string
  cancellationPolicy: string
  status: WorkOfferStatus
  revision: number
  priorEventId: string | null
}

export interface WorkClaim {
  claimId: string
  offerId: string
  federationId: string
  claimantIdentity: string
  claimedAt: string
  status: WorkClaimStatus
  releasedAt: string | null
  expiresAt: string | null
}

export type WorkClaimStatus = "active" | "released" | "expired" | "completed"

// ── Contribution Receipts ----------------------------------------------------

export type ContributionClass =
  | "implementation"
  | "review"
  | "triage"
  | "documentation"
  | "benchmark"
  | "research"
  | "moderation"
  | "infrastructure"
  | "mentorship"
  | "community_support"

export const CONTRIBUTION_CLASSES: readonly ContributionClass[] = [
  "implementation",
  "review",
  "triage",
  "documentation",
  "benchmark",
  "research",
  "moderation",
  "infrastructure",
  "mentorship",
  "community_support",
] as const

export type DisclosureLevel = "private" | "federation_only" | "public_summary" | "public_evidence"

export type ReceiptStatus =
  | "draft"
  | "locally_durable"
  | "exported"
  | "replicated"
  | "recipient_pending"
  | "accepted"
  | "rejected"
  | "confirmed"
  | "disputed"
  | "voided"

export interface ContributionReceipt {
  receiptId: string
  federationId: string
  issuerPublicKey: string
  beneficiaryPublicKey: string
  workOfferId: string | null
  localReceiptHash: string
  contributionClass: ContributionClass
  dharmaAmount: number
  evidenceDigest: string
  issuedAt: string
  expirationAt: string | null
  revocationPolicy: string
  disclosureLevel: DisclosureLevel
  status: ReceiptStatus
}

export interface ReceiptAcceptance {
  receiptId: string
  identityId: string
  accepted: boolean
  reason: string | null
  decidedAt: string
}

// ── Balance ------------------------------------------------------------------

export interface DharmaBalance {
  identityId: string
  federationId: string
  provisionalDharma: number
  confirmedDharma: number
  disputedDharma: number
  lastUpdated: string
}

export interface BalanceEntry {
  entryId: string
  identityId: string
  federationId: string
  receiptId: string
  amount: number
  category: BalanceCategory
  recordedAt: string
}

export type BalanceCategory = "provisional" | "confirmed" | "disputed" | "decayed" | "voided"

// ── Trust --------------------------------------------------------------------

export type TrustScope =
  | "receipt_issuer"
  | "work_reviewer"
  | "moderator"
  | "steward"
  | "replication_peer"
  | "general_member"

export const TRUST_SCOPES: readonly TrustScope[] = [
  "receipt_issuer",
  "work_reviewer",
  "moderator",
  "steward",
  "replication_peer",
  "general_member",
] as const

export type TrustDecisionType = "accepted" | "pending" | "rejected" | "quarantined"

export interface TrustAttestation {
  attestationId: string
  issuerPublicKey: string
  subjectPublicKey: string
  trustScope: TrustScope
  confidence: number
  expiresAt: string | null
  reasonDigest: string | null
  createdAt: string
  revokedAt: string | null
}

export interface TrustDecision {
  trustDecisionId: string
  targetId: string
  targetType: TrustTargetType
  decision: TrustDecisionType
  reason: string | null
  decidedAt: string
  policyDigest: string | null
}

export type TrustTargetType = "identity" | "receipt" | "attestation" | "event" | "work_offer"

// ── Moderation ---------------------------------------------------------------

export type ModerationSeverity = "minor" | "moderate" | "severe" | "critical"

export type ModerationStatus =
  | "open"
  | "under_review"
  | "decided"
  | "appealed"
  | "resolved"

export type ModerationDecisionType =
  | "allowed"
  | "limited"
  | "hidden"
  | "quarantined"
  | "rejected"
  | "revoked"

export interface ModerationFlag {
  flagId: string
  federationId: string
  targetEventId: string
  category: string
  severity: ModerationSeverity
  evidenceDigest: string | null
  reporterPublicKey: string
  createdAt: string
  status: ModerationStatus
}

export interface ModerationDecision {
  decisionId: string
  flagId: string
  federationId: string
  moderatorPublicKey: string
  decision: ModerationDecisionType
  scope: string
  reason: string | null
  expiresAt: string | null
  supersedesDecisionId: string | null
  createdAt: string
}

export interface ModerationAppeal {
  appealId: string
  decisionId: string
  appellantPublicKey: string
  reason: string
  evidenceDigest: string | null
  createdAt: string
  status: AppealStatus
}

export type AppealStatus = "pending" | "upheld" | "overturned" | "dismissed"

// ── Federation Policy --------------------------------------------------------

export interface FederationPolicy {
  policyId: string
  federationId: string
  version: number
  activationEventId: string
  minimumStewardSignatures: number
  maximumReceiptAmount: number
  receiptExpirationDays: number
  allowedContributionClasses: ContributionClass[]
  maximumEventsPerHour: number
  maximumAttachmentBytes: number
  defaultDisclosureLevel: DisclosureLevel
  moderatorScopeRules: string
  memberInvitationRules: string
  workOfferExpirationLimit: number
  membershipRules: string
  roleRules: string
  balanceRules: string
  disclosureRules: string
  replicationRules: string
  quotaRules: string
  governanceThresholds: string
  compatibilityRange: string
  createdAt: string
}

// ── Replication --------------------------------------------------------------

export interface ReplicationCursor {
  cursorId: string
  federationId: string
  peerId: string
  lastEventId: string | null
  lastEventTimestamp: string | null
  bytesReceived: number
  lastConnectedAt: string | null
}

export interface ReplicationStatus {
  federationId: string
  isConnected: boolean
  connectedPeers: number
  eventsReplicated: number
  bytesTransferred: number
  lastSyncAt: string | null
  outboxSize: number
}

// ── Audit --------------------------------------------------------------------

export type AuditEventType =
  | "dharma.identity.created"
  | "dharma.identity.rotated"
  | "dharma.federation.joined"
  | "dharma.federation.left"
  | "dharma.event.received"
  | "dharma.event.accepted"
  | "dharma.event.rejected"
  | "dharma.event.quarantined"
  | "dharma.receipt.issued"
  | "dharma.receipt.accepted"
  | "dharma.receipt.rejected"
  | "dharma.receipt.voided"
  | "dharma.replication.connected"
  | "dharma.replication.disconnected"
  | "dharma.policy.activated"
  | "dharma.moderation.decided"
  | "dharma.identity.created.failed"
  | "dharma.identity.rotated.failed"
  | "dharma.federation.joined.failed"
  | "dharma.event.validation.failed"
  | "dharma.receipt.issuance.failed"
  | "dharma.replication.failed"
  | "dharma.moderation.failed"

export interface AuditEvent {
  auditId: string
  eventType: AuditEventType
  federationId: string | null
  identityId: string | null
  targetHash: string | null
  metadata: Record<string, unknown> | null
  occurredAt: string
}

// ── Quarantine ---------------------------------------------------------------

export interface QuarantineEntry {
  entryId: string
  federationId: string
  eventId: string
  reason: string
  flaggedAt: string
  resolvedAt: string | null
  resolution: string | null
}

// ── Outbox -------------------------------------------------------------------

export interface OutboxEntry {
  entryId: string
  federationId: string
  eventId: string
  status: OutboxStatus
  createdAt: string
  lastAttemptAt: string | null
  attemptCount: number
  lastError: string | null
}

export type OutboxStatus = "pending" | "in_flight" | "delivered" | "failed" | "expired"

// ── API Context --------------------------------------------------------------

export interface DharmaMutationContext {
  localUserApproval: boolean
  federationId: string
  identityId: string
  capabilityGovernanceReceipt: string | null
  idempotencyKey: string
  disclosureConfirmation: boolean | null
}

// ─── Remote Peer -------------------------------------------------------------

export interface RemotePeer {
  peerId: string
  publicKey: string
  federationId: string
  displayName: string | null
  firstSeenAt: string
  lastSeenAt: string | null
  connectionCount: number
  trustScore: number
}

// ── Checkpoint ---------------------------------------------------------------

export interface Checkpoint {
  checkpointId: string
  federationId: string
  eventId: string
  snapshotDigest: string
  height: number
  createdAt: string
  signedBy: string[]
}

// ── Helpers ------------------------------------------------------------------

/** Deterministic canonical JSON serialization for content-addressed IDs and signing. */
export function canonicalJson(obj: unknown): string {
  // Stable stringify: sorted keys, no whitespace
  if (obj === null || obj === undefined) return "null"
  if (typeof obj === "string") return JSON.stringify(obj)
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj)
  if (obj instanceof Uint8Array) {
    // Base64url encode without padding for deterministic representation
    return `"${Buffer.from(obj).toString("base64url")}"`
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJson).join(",")}]`
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>).sort()
    return `{${keys.map((k) => `${canonicalJson(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`).join(",")}}`
  }
  return String(obj)
}

/** Create a content-addressed event ID from payload. */
export function deriveEventId(
  federationId: string,
  eventType: EventType,
  actorPublicKey: string,
  logicalClock: number,
  causalParents: string[],
  createdAt: string,
  payloadHash: string,
): string {
  const seed = canonicalJson({
    federationId,
    eventType,
    actorPublicKey,
    logicalClock,
    causalParents: [...causalParents].sort(),
    createdAt,
    payloadHash,
  })
  return sha256Hex(seed)
}

/** SHA-256 hex digest. */
export function sha256Hex(data: string | Uint8Array): string {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data
  return createHash("sha256").update(buf).digest("hex")
}
