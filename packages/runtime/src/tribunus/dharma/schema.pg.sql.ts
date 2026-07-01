/**
 * Dharma Federation Runtime — PGlite Drizzle Schema
 *
 * Follows the existing convention: pgTable definitions with TimestampsPg mixin.
 * Tables are named dharma_* and indexed for federation-scoped queries.
 */

import { pgTable, text, integer, real, boolean, jsonb, index, uniqueIndex, bigint, varchar } from "drizzle-orm/pg-core"
import { TimestampsPg } from "../../storage/schema.pg.sql"

// ── Identities ---------------------------------------------------------------

export const DharmaIdentityTable = pgTable(
  "dharma_identities",
  {
    identity_id: text().primaryKey(),
    public_key: text().notNull(),
    encrypted_private_key: text().notNull(),
    display_name: text().notNull(),
    profile_version: integer().notNull().default(1),
    status: text().notNull().default("active"),
    recovery_policy: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_identity_status_idx").on(table.status),
  ],
)

export const DharmaIdentityKeyTable = pgTable(
  "dharma_identity_keys",
  {
    key_id: text().primaryKey(),
    identity_id: text()
      .notNull()
      .references(() => DharmaIdentityTable.identity_id, { onDelete: "cascade" }),
    public_key: text().notNull(),
    encrypted_private_key: text().notNull(),
    purpose: text().notNull().default("signing"),
    status: text().notNull().default("active"),
    created_at: text().notNull(),
    revoked_at: text(),
  },
  (table) => [
    index("dharma_key_identity_idx").on(table.identity_id),
  ],
)

// ── Federations --------------------------------------------------------------

export const DharmaFederationTable = pgTable(
  "dharma_federations",
  {
    federation_id: text().primaryKey(),
    genesis_event_hash: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    visibility: text().notNull().default("private"),
    policy_version: integer().notNull().default(1),
    status: text().notNull().default("unaware"),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_federation_status_idx").on(table.status),
  ],
)

export const DharmaMembershipTable = pgTable(
  "dharma_memberships",
  {
    membership_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    identity_id: text()
      .notNull()
      .references(() => DharmaIdentityTable.identity_id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    joined_at: text().notNull(),
    expires_at: text(),
    status: text().notNull().default("pending"),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_membership_fed_idx").on(table.federation_id),
    index("dharma_membership_identity_idx").on(table.identity_id),
    index("dharma_membership_status_idx").on(table.status),
    uniqueIndex("dharma_membership_fed_identity_unique").on(table.federation_id, table.identity_id),
  ],
)

// ── Events -------------------------------------------------------------------

export const DharmaRawEventTable = pgTable(
  "dharma_raw_events",
  {
    event_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    event_type: text().notNull(),
    schema_version: integer().notNull().default(1),
    actor_public_key: text().notNull(),
    actor_device_id: text(),
    created_at: text().notNull(),
    logical_clock: integer().notNull().default(0),
    causal_parents: jsonb().notNull().$type<string[]>().default([]),
    payload_hash: text().notNull(),
    payload: jsonb().notNull().$type<Record<string, unknown>>().default({}),
    signature: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_event_federation_idx").on(table.federation_id),
    index("dharma_event_type_idx").on(table.event_type),
    index("dharma_event_actor_idx").on(table.actor_public_key),
    index("dharma_event_created_idx").on(table.created_at),
    index("dharma_event_fed_type_idx").on(table.federation_id, table.event_type),
  ],
)

// ── Event Validation ---------------------------------------------------------

export const DharmaEventValidationTable = pgTable(
  "dharma_event_validation",
  {
    validation_id: text().primaryKey(),
    event_id: text()
      .notNull()
      .references(() => DharmaRawEventTable.event_id, { onDelete: "cascade" }),
    validation_state: text().notNull().default("received"),
    validation_reason: text(),
    validated_at: text().notNull(),
    policy_digest: text(),
    validator_version: integer().notNull().default(1),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_validation_event_idx").on(table.event_id),
    index("dharma_validation_state_idx").on(table.validation_state),
  ],
)

// ── Event Quarantine ---------------------------------------------------------

export const DharmaEventQuarantineTable = pgTable(
  "dharma_event_quarantine",
  {
    entry_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    event_id: text()
      .notNull()
      .references(() => DharmaRawEventTable.event_id, { onDelete: "cascade" }),
    reason: text().notNull(),
    flagged_at: text().notNull(),
    resolved_at: text(),
    resolution: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_quarantine_fed_idx").on(table.federation_id),
    index("dharma_quarantine_event_idx").on(table.event_id),
  ],
)

// ── Work Offers --------------------------------------------------------------

export const DharmaWorkOfferTable = pgTable(
  "dharma_work_offers",
  {
    offer_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    creator_identity: text().notNull(),
    title: text().notNull(),
    summary: text().notNull(),
    category: text().notNull(),
    requested_outcome: text().notNull(),
    artifact_scope: text().notNull(),
    max_effort_band: text().notNull(),
    dharma_offer_amount: real().notNull().default(0),
    visibility: text().notNull().default("federation_only"),
    required_roles: jsonb().notNull().$type<string[]>().default([]),
    capability_class: text(),
    expires_at: text().notNull(),
    cancellation_policy: text().notNull().default(""),
    status: text().notNull().default("draft"),
    revision: integer().notNull().default(1),
    prior_event_id: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_offer_fed_idx").on(table.federation_id),
    index("dharma_offer_creator_idx").on(table.creator_identity),
    index("dharma_offer_status_idx").on(table.status),
    index("dharma_offer_fed_status_idx").on(table.federation_id, table.status),
  ],
)

export const DharmaWorkClaimTable = pgTable(
  "dharma_work_claims",
  {
    claim_id: text().primaryKey(),
    offer_id: text()
      .notNull()
      .references(() => DharmaWorkOfferTable.offer_id, { onDelete: "cascade" }),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    claimant_identity: text().notNull(),
    claimed_at: text().notNull(),
    status: text().notNull().default("active"),
    released_at: text(),
    expires_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_claim_offer_idx").on(table.offer_id),
    index("dharma_claim_claimant_idx").on(table.claimant_identity),
    index("dharma_claim_status_idx").on(table.status),
  ],
)

// ── Receipts -----------------------------------------------------------------

export const DharmaReceiptTable = pgTable(
  "dharma_receipts",
  {
    receipt_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    issuer_public_key: text().notNull(),
    beneficiary_public_key: text().notNull(),
    work_offer_id: text(),
    local_receipt_hash: text().notNull(),
    contribution_class: text().notNull(),
    dharma_amount: real().notNull(),
    evidence_digest: text().notNull(),
    issued_at: text().notNull(),
    expiration_at: text(),
    revocation_policy: text().notNull().default(""),
    disclosure_level: text().notNull().default("federation_only"),
    status: text().notNull().default("locally_durable"),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_receipt_fed_idx").on(table.federation_id),
    index("dharma_receipt_issuer_idx").on(table.issuer_public_key),
    index("dharma_receipt_beneficiary_idx").on(table.beneficiary_public_key),
    index("dharma_receipt_status_idx").on(table.status),
    index("dharma_receipt_class_idx").on(table.contribution_class),
  ],
)

export const DharmaReceiptAcceptanceTable = pgTable(
  "dharma_receipt_acceptance",
  {
    acceptance_id: text().primaryKey(),
    receipt_id: text()
      .notNull()
      .references(() => DharmaReceiptTable.receipt_id, { onDelete: "cascade" }),
    identity_id: text().notNull(),
    accepted: boolean().notNull(),
    reason: text(),
    decided_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_acceptance_receipt_idx").on(table.receipt_id),
    index("dharma_acceptance_identity_idx").on(table.identity_id),
  ],
)

// ── Trust ---------------------------------------------------------

export const DharmaTrustEdgeTable = pgTable(
  "dharma_trust_edges",
  {
    edge_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    issuer_public_key: text().notNull(),
    subject_public_key: text().notNull(),
    trust_scope: text().notNull(),
    confidence: real().notNull().default(0.5),
    expires_at: text(),
    reason_digest: text(),
    created_at: text().notNull(),
    revoked_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_trust_fed_idx").on(table.federation_id),
    index("dharma_trust_issuer_idx").on(table.issuer_public_key),
    index("dharma_trust_subject_idx").on(table.subject_public_key),
    index("dharma_trust_scope_idx").on(table.trust_scope),
  ],
)

// ── Moderation ---------------------------------------------------------------

export const DharmaModerationCaseTable = pgTable(
  "dharma_moderation_cases",
  {
    case_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    target_event_id: text().notNull(),
    category: text().notNull(),
    severity: text().notNull().default("minor"),
    evidence_digest: text(),
    reporter_public_key: text().notNull(),
    status: text().notNull().default("open"),
    decision: text(),
    moderator_public_key: text(),
    scope: text(),
    reason: text(),
    decision_expires_at: text(),
    supersedes_decision_id: text(),
    flagged_at: text().notNull(),
    decided_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_moderation_fed_idx").on(table.federation_id),
    index("dharma_moderation_target_idx").on(table.target_event_id),
    index("dharma_moderation_status_idx").on(table.status),
  ],
)

// ── Balances -----------------------------------------------------------------

export const DharmaBalanceTable = pgTable(
  "dharma_balances",
  {
    balance_id: text().primaryKey(),
    identity_id: text()
      .notNull()
      .references(() => DharmaIdentityTable.identity_id, { onDelete: "cascade" }),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    provisional_dharma: real().notNull().default(0),
    confirmed_dharma: real().notNull().default(0),
    disputed_dharma: real().notNull().default(0),
    last_updated: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_balance_identity_idx").on(table.identity_id),
    index("dharma_balance_fed_idx").on(table.federation_id),
    uniqueIndex("dharma_balance_identity_fed_unique").on(table.identity_id, table.federation_id),
  ],
)

export const DharmaBalanceEntryTable = pgTable(
  "dharma_balance_entries",
  {
    entry_id: text().primaryKey(),
    identity_id: text()
      .notNull()
      .references(() => DharmaIdentityTable.identity_id, { onDelete: "cascade" }),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    receipt_id: text(),
    amount: real().notNull(),
    category: text().notNull(),
    recorded_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_balance_entry_identity_idx").on(table.identity_id),
    index("dharma_balance_entry_fed_idx").on(table.federation_id),
    index("dharma_balance_entry_category_idx").on(table.category),
  ],
)

// ── Replication --------------------------------------------------------------

export const DharmaReplicationCursorTable = pgTable(
  "dharma_replication_cursors",
  {
    cursor_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    peer_id: text().notNull(),
    last_event_id: text(),
    last_event_timestamp: text(),
    bytes_received: integer().notNull().default(0),
    last_connected_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_cursor_fed_idx").on(table.federation_id),
    index("dharma_repl_cursor_peer_idx").on(table.peer_id),
  ],
)

// ── Checkpoints --------------------------------------------------------------

export const DharmaCheckpointTable = pgTable(
  "dharma_checkpoints",
  {
    checkpoint_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    event_id: text()
      .notNull()
      .references(() => DharmaRawEventTable.event_id, { onDelete: "cascade" }),
    snapshot_digest: text().notNull(),
    height: integer().notNull(),
    signed_by: jsonb().notNull().$type<string[]>().default([]),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_checkpoint_fed_idx").on(table.federation_id),
    index("dharma_checkpoint_height_idx").on(table.height),
  ],
)

// ── Outbox -------------------------------------------------------------------

export const DharmaOutboxTable = pgTable(
  "dharma_outbox",
  {
    entry_id: text().primaryKey(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    event_id: text().notNull(),
    status: text().notNull().default("pending"),
    created_at: text().notNull(),
    last_attempt_at: text(),
    attempt_count: integer().notNull().default(0),
    last_error: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_outbox_fed_idx").on(table.federation_id),
    index("dharma_outbox_status_idx").on(table.status),
    index("dharma_outbox_fed_status_idx").on(table.federation_id, table.status),
  ],
)

// ── Audit Log ----------------------------------------------------------------

export const DharmaAuditLogTable = pgTable(
  "dharma_audit_log",
  {
    audit_id: text().primaryKey(),
    event_type: text().notNull(),
    federation_id: text(),
    identity_id: text(),
    target_hash: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    occurred_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_audit_type_idx").on(table.event_type),
    index("dharma_audit_fed_idx").on(table.federation_id),
    index("dharma_audit_occurred_idx").on(table.occurred_at),
  ],
)

// ── Remote Peers -------------------------------------------------------------

export const DharmaRemotePeerTable = pgTable(
  "dharma_remote_peers",
  {
    peer_id: text().primaryKey(),
    public_key: text().notNull(),
    federation_id: text()
      .notNull()
      .references(() => DharmaFederationTable.federation_id, { onDelete: "cascade" }),
    display_name: text(),
    first_seen_at: text().notNull(),
    last_seen_at: text(),
    connection_count: integer().notNull().default(0),
    trust_score: real().notNull().default(0),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_peer_fed_idx").on(table.federation_id),
    index("dharma_peer_pubkey_idx").on(table.public_key),
  ],
)

// ── Schema registry for migration --------------------------------------------

import { DHARMA_REPLICATION_SCHEMA } from "./replication/schema.pg.sql"
import { DHARMA_SESSION_SCHEMA } from "./session/schema.pg.sql"

export const DHARMA_ALL_SCHEMA = [
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
  ...DHARMA_REPLICATION_SCHEMA,
  ...DHARMA_SESSION_SCHEMA,
] as const
