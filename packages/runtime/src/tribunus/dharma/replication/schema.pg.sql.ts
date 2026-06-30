/**
 * Dharma Replication — PGlite Schema Additions (Phase 2)
 *
 * New tables for the Phase 2 replication layer: federation bootstrap,
 * writer admission, peer sessions, import cursors, pending dependencies,
 * quota violations, and diagnostics.
 */

import { pgTable, text, integer, real, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core"
import { TimestampsPg } from "../../../storage/schema.pg.sql"

// ── Replication Federations (local bootstrap metadata) -----------------------

export const DharmaReplicationFederationTable = pgTable(
  "dharma_replication_federations",
  {
    federation_id: text().primaryKey(),
    genesis_event_id: text().notNull(),
    federation_root_public_key: text().notNull(),
    autobase_key: text().notNull(),
    autobase_discovery_key: text().notNull(),
    initial_policy_digest: text().notNull(),
    genesis_writer_key: text().notNull(),
    bootstrap_signature: text().notNull(),
    lifecycle_state: text().notNull().default("unaware"),
    protocol_version: integer().notNull().default(1),
    swarm_topic: text(),
    created_at: text().notNull(),
    last_state_change_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_fed_state_idx").on(table.lifecycle_state),
  ],
)

// ── Replication Writers (writer admission + key binding) ---------------------

export const DharmaReplicationWriterTable = pgTable(
  "dharma_replication_writers",
  {
    writer_id: text().primaryKey(),
    federation_id: text().notNull(),
    writer_core_public_key: text().notNull(),
    dharma_identity_public_key: text().notNull(),
    membership_event_id: text(),
    admitted_by: text(),
    admitted_at: text().notNull(),
    admission_signature: text(),
    status: text().notNull().default("active"),
    last_sequence: integer().notNull().default(0),
    events_appended: integer().notNull().default(0),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_writer_fed_idx").on(table.federation_id),
    index("dharma_repl_writer_core_idx").on(table.writer_core_public_key),
    uniqueIndex("dharma_repl_writer_fed_core_unique").on(table.federation_id, table.writer_core_public_key),
  ],
)

// ── Replication Peers (pseudonymous diagnostics) -----------------------------

export const DharmaReplicationPeerTable = pgTable(
  "dharma_replication_peers",
  {
    peer_id: text().primaryKey(),
    federation_id: text().notNull(),
    node_instance_id: text(),
    identity_public_key: text(),
    device_public_key: text(),
    first_seen_at: text().notNull(),
    last_seen_at: text(),
    successful_handshakes: integer().notNull().default(0),
    failed_handshakes: integer().notNull().default(0),
    events_received: integer().notNull().default(0),
    bytes_received: integer().notNull().default(0),
    status: text().notNull().default("discovered"),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_peer_fed_idx").on(table.federation_id),
    index("dharma_repl_peer_status_idx").on(table.status),
  ],
)

// ── Replication Sessions (short-lived handshake outcomes) --------------------

export const DharmaReplicationSessionTable = pgTable(
  "dharma_replication_sessions",
  {
    session_id: text().primaryKey(),
    federation_id: text().notNull(),
    peer_id: text().notNull(),
    protocol_version: integer().notNull(),
    handshake_result: text().notNull(),
    handshake_duration_ms: integer(),
    accepted_federations: jsonb().$type<string[]>().default([]),
    rejected_federations: jsonb().$type<string[]>().default([]),
    started_at: text().notNull(),
    ended_at: text(),
    error_message: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_session_fed_idx").on(table.federation_id),
    index("dharma_repl_session_peer_idx").on(table.peer_id),
  ],
)

// ── Replication Outbox (durable publish retries) -----------------------------

export const DharmaReplicationOutboxTable = pgTable(
  "dharma_replication_outbox",
  {
    outbox_id: text().primaryKey(),
    federation_id: text().notNull(),
    event_id: text().notNull(),
    event_envelope: jsonb().notNull().$type<Record<string, unknown>>(),
    state: text().notNull().default("created"),
    attempt_count: integer().notNull().default(0),
    next_attempt_at: text(),
    writer_core_key: text(),
    appended_sequence: integer(),
    last_error: text(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_outbox_fed_idx").on(table.federation_id),
    index("dharma_repl_outbox_state_idx").on(table.state),
    index("dharma_repl_outbox_next_attempt_idx").on(table.next_attempt_at),
    index("dharma_repl_outbox_event_idx").on(table.event_id),
    uniqueIndex("dharma_repl_outbox_fed_event_unique").on(table.federation_id, table.event_id),
  ],
)

// ── Import Cursor (last imported position) -----------------------------------

export const DharmaReplicationImportCursorTable = pgTable(
  "dharma_replication_import_cursors",
  {
    cursor_id: text().primaryKey(),
    federation_id: text().notNull(),
    cursor_type: text().notNull(), // "provisional" | "finalized"
    autobase_length: integer().notNull().default(0),
    last_event_id: text(),
    last_event_timestamp: text(),
    imported_count: integer().notNull().default(0),
    updated_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_cursor_fed_idx").on(table.federation_id),
    uniqueIndex("dharma_repl_cursor_fed_type_unique").on(table.federation_id, table.cursor_type),
  ],
)

// ── Pending Dependencies (unresolved dependency references) ------------------

export const DharmaReplicationPendingDependencyTable = pgTable(
  "dharma_replication_pending_dependencies",
  {
    dependency_id: text().primaryKey(),
    federation_id: text().notNull(),
    event_id: text().notNull(),
    missing_parent_ids: jsonb().notNull().$type<string[]>().default([]),
    depth: integer().notNull().default(1),
    discovered_at: text().notNull(),
    last_retry_at: text(),
    retry_count: integer().notNull().default(0),
    status: text().notNull().default("pending"),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_dep_fed_idx").on(table.federation_id),
    index("dharma_repl_dep_event_idx").on(table.event_id),
    index("dharma_repl_dep_status_idx").on(table.status),
  ],
)

// ── Replication Checkpoints (recovery acceleration) --------------------------

export const DharmaReplicationCheckpointTable = pgTable(
  "dharma_replication_checkpoints",
  {
    checkpoint_id: text().primaryKey(),
    federation_id: text().notNull(),
    autobase_signed_length: integer().notNull(),
    autobase_hash: text().notNull(),
    view_root_hash: text().notNull(),
    created_by_writer: text().notNull(),
    created_at: text().notNull(),
    signature: text().notNull(),
    local_adopted: boolean().notNull().default(false),
    local_adopted_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_ckpt_fed_idx").on(table.federation_id),
    index("dharma_repl_ckpt_length_idx").on(table.autobase_signed_length),
  ],
)

// ── Quota Violations ---------------------------------------------------------

export const DharmaReplicationQuotaViolationTable = pgTable(
  "dharma_replication_quota_violations",
  {
    violation_id: text().primaryKey(),
    federation_id: text().notNull(),
    peer_id: text(),
    violation_type: text().notNull(),
    severity: text().notNull(),
    description: text().notNull(),
    detected_at: text().notNull(),
    resolved_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_quota_fed_idx").on(table.federation_id),
    index("dharma_repl_quota_peer_idx").on(table.peer_id),
    index("dharma_repl_quota_type_idx").on(table.violation_type),
  ],
)

// ── Replication Diagnostics Store --------------------------------------------

export const DharmaReplicationDiagnosticsTable = pgTable(
  "dharma_replication_diagnostics",
  {
    diagnostics_id: text().primaryKey(),
    federation_id: text().notNull(),
    lifecycle_state: text().notNull(),
    swarm_joined: boolean().notNull().default(false),
    active_peer_count: integer().notNull().default(0),
    successful_handshakes: integer().notNull().default(0),
    failed_handshakes: integer().notNull().default(0),
    writer_count: integer().notNull().default(0),
    autobase_length: integer().notNull().default(0),
    autobase_signed_length: integer().notNull().default(0),
    importer_provisional_cursor: integer().notNull().default(0),
    importer_finalized_cursor: integer().notNull().default(0),
    pending_outbox_count: integer().notNull().default(0),
    pending_dependency_count: integer().notNull().default(0),
    quarantine_count: integer().notNull().default(0),
    last_successful_replication_at: text(),
    last_error: text(),
    recorded_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_repl_diag_fed_idx").on(table.federation_id),
  ],
)

// ── Schema registry ----------------------------------------------------------

export const DHARMA_REPLICATION_SCHEMA = [
  DharmaReplicationFederationTable,
  DharmaReplicationWriterTable,
  DharmaReplicationPeerTable,
  DharmaReplicationSessionTable,
  DharmaReplicationOutboxTable,
  DharmaReplicationImportCursorTable,
  DharmaReplicationPendingDependencyTable,
  DharmaReplicationCheckpointTable,
  DharmaReplicationQuotaViolationTable,
  DharmaReplicationDiagnosticsTable,
] as const
