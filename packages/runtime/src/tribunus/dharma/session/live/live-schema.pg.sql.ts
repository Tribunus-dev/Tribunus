/**
 * Dharma Live Sandbox — PGlite Schema Additions
 *
 * 13 tables for the concrete sandbox implementation: source manifests,
 * workspace digests, overlays, patch proposals, process execution,
 * network policy, live transport, event links, and recovery state.
 */

import { pgTable, text, integer, real, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core"
import { TimestampsPg } from "../../../../storage/schema.pg.sql"

// ── Sandbox Instances -------------------------------------------------------

export const DharmaSessionSandboxInstanceTable = pgTable(
  "dharma_session_sandbox_instances",
  {
    instance_id: text().primaryKey(),
    session_id: text().notNull(),
    sandbox_root: text().notNull(),
    backend_kind: text().notNull().default("local_fs"),
    lifecycle_state: text().notNull().default("created"),
    source_tree_digest: text(),
    canonical_digest: text(),
    sealed_digest: text(),
    created_at: text().notNull(),
    destroyed_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_sandbox_sesh_idx").on(table.session_id),
  ],
)

// ── Source Manifests --------------------------------------------------------

export const DharmaSessionSourceManifestTable = pgTable(
  "dharma_session_source_manifests",
  {
    manifest_id: text().primaryKey(),
    session_id: text().notNull(),
    source_revision: text().notNull(),
    resolved_commit_hash: text().notNull(),
    repository_identity_digest: text(),
    files: jsonb().$type<Array<{ path: string; mode: string; digest: string }>>().default([]),
    total_file_count: integer().notNull().default(0),
    total_bytes: integer().notNull().default(0),
    manifest_digest: text().notNull(),
    created_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_manifest_sesh_idx").on(table.session_id),
  ],
)

// ── Workspace Digests -------------------------------------------------------

export const DharmaSessionWorkspaceDigestTable = pgTable(
  "dharma_session_workspace_digests",
  {
    digest_id: text().primaryKey(),
    session_id: text().notNull(),
    digest_kind: text().notNull(), // base, canonical, overlay, pre_mutation, post_mutation, sealed
    digest: text().notNull(),
    mutation_id: text(),
    overlay_id: text(),
    file_count: integer().notNull().default(0),
    recorded_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_digest_sesh_idx").on(table.session_id),
    index("dharma_live_digest_kind_idx").on(table.digest_kind),
    uniqueIndex("dharma_live_digest_sesh_kind_unique").on(table.session_id, table.digest_kind),
  ],
)

// ── Overlay Filesystems -----------------------------------------------------

export const DharmaSessionOverlayFilesystemTable = pgTable(
  "dharma_session_overlay_filesystems",
  {
    overlay_id: text().primaryKey(),
    session_id: text().notNull(),
    membership_id: text().notNull(),
    owner_identity_public_key: text().notNull(),
    overlay_root: text().notNull(),
    allowed_path_scope: jsonb().$type<string[]>().default([]),
    base_workspace_digest: text().notNull(),
    current_digest: text().notNull(),
    state: text().notNull().default("created"),
    created_at: text().notNull(),
    updated_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_overlay_sesh_idx").on(table.session_id),
    index("dharma_live_overlay_member_idx").on(table.membership_id),
  ],
)

// ── Patch Proposals ---------------------------------------------------------

export const DharmaSessionPatchProposalTable = pgTable(
  "dharma_session_patch_proposals",
  {
    proposal_id: text().primaryKey(),
    session_id: text().notNull(),
    membership_id: text().notNull(),
    grant_id: text().notNull(),
    overlay_id: text().notNull(),
    base_workspace_digest: text().notNull(),
    patch_digest: text().notNull(),
    changed_paths: jsonb().$type<string[]>().default([]),
    patch_reference: text(),
    state: text().notNull().default("pending"),
    created_at: text().notNull(),
    signature: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_proposal_sesh_idx").on(table.session_id),
    index("dharma_live_proposal_state_idx").on(table.state),
  ],
)

// ── Patch Reviews -----------------------------------------------------------

export const DharmaSessionPatchReviewTable = pgTable(
  "dharma_session_patch_reviews",
  {
    review_id: text().primaryKey(),
    proposal_id: text().notNull(),
    session_id: text().notNull(),
    decision: text().notNull(),
    reviewed_by_identity_public_key: text().notNull(),
    review_reason: text(),
    expected_canonical_digest: text(),
    accepted_at: text(),
    signature: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_review_proposal_idx").on(table.proposal_id),
  ],
)

// ── Sandbox Executions ------------------------------------------------------

export const DharmaSessionSandboxExecutionTable = pgTable(
  "dharma_session_sandbox_executions",
  {
    execution_id: text().primaryKey(),
    session_id: text().notNull(),
    membership_id: text().notNull(),
    grant_id: text().notNull(),
    command: text().notNull(),
    arguments: jsonb().$type<string[]>().default([]),
    working_directory: text(),
    timeout_seconds: integer().notNull().default(30),
    output_limit_bytes: integer().notNull().default(65536),
    process_group_id: text(),
    state: text().notNull().default("pending"),
    exit_code: integer(),
    runtime_ms: integer(),
    started_at: text(),
    completed_at: text(),
    termination_deadline: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_exec_sesh_idx").on(table.session_id),
    index("dharma_live_exec_state_idx").on(table.state),
    index("dharma_live_exec_process_group_idx").on(table.process_group_id),
  ],
)

// ── Execution Outputs -------------------------------------------------------

export const DharmaSessionExecutionOutputTable = pgTable(
  "dharma_session_execution_outputs",
  {
    output_id: text().primaryKey(),
    execution_id: text().notNull(),
    stream: text().notNull(), // stdout, stderr
    digest: text().notNull(),
    size_bytes: integer().notNull().default(0),
    reference: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_output_exec_idx").on(table.execution_id),
  ],
)

// ── Process Groups ----------------------------------------------------------

export const DharmaSessionProcessGroupTable = pgTable(
  "dharma_session_process_groups",
  {
    group_id: text().primaryKey(),
    session_id: text().notNull(),
    membership_id: text().notNull(),
    grant_id: text().notNull(),
    state: text().notNull().default("active"),
    process_count: integer().notNull().default(0),
    created_at: text().notNull(),
    terminated_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_pgroup_sesh_idx").on(table.session_id),
    index("dharma_live_pgroup_member_idx").on(table.membership_id),
  ],
)

// ── Network Policy ----------------------------------------------------------

export const DharmaSessionNetworkPolicyTable = pgTable(
  "dharma_session_network_policy",
  {
    policy_id: text().primaryKey(),
    session_id: text().notNull(),
    grant_id: text().notNull(),
    network_access: boolean().notNull().default(false),
    allowed_domains: jsonb().$type<string[]>().default([]),
    denied_domains: jsonb().$type<string[]>().default([]),
    allowed_ports: jsonb().$type<number[]>().default([]),
    enforced: boolean().notNull().default(true),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_netpol_sesh_idx").on(table.session_id),
  ],
)

// ── Live Transport Sessions -------------------------------------------------

export const DharmaSessionLiveTransportTable = pgTable(
  "dharma_session_live_transports",
  {
    transport_id: text().primaryKey(),
    session_id: text().notNull(),
    peer_identity_public_key: text().notNull(),
    transport_kind: text().notNull().default("direct"),
    endpoint: text(),
    session_key_epoch: integer().notNull().default(0),
    state: text().notNull().default("pending"),
    last_activity_at: text(),
    message_count: integer().notNull().default(0),
    created_at: text().notNull(),
    closed_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_transport_sesh_idx").on(table.session_id),
    index("dharma_live_transport_peer_idx").on(table.peer_identity_public_key),
  ],
)

// ── Event Links -------------------------------------------------------------

export const DharmaSessionEventLinkTable = pgTable(
  "dharma_session_event_links",
  {
    link_id: text().primaryKey(),
    session_id: text().notNull(),
    local_record_type: text().notNull(),
    local_record_id: text().notNull(),
    dharma_event_id: text(),
    replication_state: text().notNull().default("pending"),
    outbox_entry_id: text(),
    published_at: text(),
    confirmed_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_link_sesh_idx").on(table.session_id),
    index("dharma_live_link_local_idx").on(table.local_record_type, table.local_record_id),
    index("dharma_live_link_repl_state_idx").on(table.replication_state),
  ],
)

// ── Recovery State ----------------------------------------------------------

export const DharmaSessionRecoveryStateTable = pgTable(
  "dharma_session_recovery_state",
  {
    recovery_id: text().primaryKey(),
    session_id: text().notNull(),
    recovery_kind: text().notNull(), // materialization, process_cleanup, patch_application, seal
    state: text().notNull().default("pending"),
    detail: jsonb().$type<Record<string, unknown>>(),
    last_verified_digest: text(),
    created_at: text().notNull(),
    resolved_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_live_recovery_sesh_idx").on(table.session_id),
    index("dharma_live_recovery_kind_idx").on(table.recovery_kind),
  ],
)

// ── Schema Registry ----------------------------------------------------------

export const DHARMA_LIVE_SANDBOX_SCHEMA = [
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
] as const
