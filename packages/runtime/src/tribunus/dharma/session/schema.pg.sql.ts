/**
 * Dharma Session Authority — PGlite Drizzle Schema
 *
 * 18 durable tables for session lifecycle, membership, grants, commands,
 * workspace mutations, compute leases, and aggregates.
 */

import { pgTable, text, integer, real, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core"
import { TimestampsPg } from "../../../storage/schema.pg.sql"

// ── Sessions -----------------------------------------------------------------

export const DharmaSessionTable = pgTable(
  "dharma_sessions",
  {
    session_id: text().primaryKey(),
    federation_id: text().notNull(),
    owner_identity_public_key: text().notNull(),
    owner_device_id: text(),
    project_reference: text().notNull(),
    source_revision: text().notNull(),
    source_tree_digest: text(),
    source_manifest_digest: text(),
    sandbox_runtime_kind: text().notNull().default("local"),
    sandbox_image_digest: text(),
    sandbox_policy_digest: text(),
    collaboration_policy_digest: text(),
    disclosure_policy_digest: text(),
    lifecycle_state: text().notNull().default("draft"),
    visibility: text().notNull().default("private"),
    created_at: text().notNull(),
    activated_at: text(),
    sealed_at: text(),
    expires_at: text(),
    session_key_epoch: integer().notNull().default(0),
    predecessor_session_id: text(),
    successor_session_id: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_owner_idx").on(table.owner_identity_public_key),
    index("dharma_sesh_state_idx").on(table.lifecycle_state),
    index("dharma_sesh_fed_idx").on(table.federation_id),
  ],
)

// ── Session Members ----------------------------------------------------------

export const DharmaSessionMemberTable = pgTable(
  "dharma_session_members",
  {
    membership_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    peer_identity_public_key: text().notNull(),
    peer_device_id: text(),
    invited_by_identity_public_key: text().notNull(),
    display_role: text().notNull().default("member"),
    status: text().notNull().default("invited"),
    joined_at: text(),
    suspended_at: text(),
    removed_at: text(),
    last_seen_at: text(),
    current_key_epoch: integer().notNull().default(0),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_member_sesh_idx").on(table.session_id),
    index("dharma_sesh_member_identity_idx").on(table.peer_identity_public_key),
    index("dharma_sesh_member_status_idx").on(table.status),
    uniqueIndex("dharma_sesh_member_sesh_identity_unique").on(table.session_id, table.peer_identity_public_key),
  ],
)

// ── Session Invitations ------------------------------------------------------

export const DharmaSessionInvitationTable = pgTable(
  "dharma_session_invitations",
  {
    invitation_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    federation_id: text().notNull(),
    inviter_identity_public_key: text().notNull(),
    invitee_identity_public_key: text(),
    initial_display_role: text().notNull(),
    initial_grant_templates: jsonb().$type<string[]>().default([]),
    session_key_epoch: integer().notNull().default(0),
    expires_at: text().notNull(),
    max_uses: integer().notNull().default(1),
    visibility_summary: text().notNull().default(""),
    encrypted_join_payload: text(),
    signature: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_invite_sesh_idx").on(table.session_id),
    index("dharma_sesh_invite_invitee_idx").on(table.invitee_identity_public_key),
  ],
)

// ── Session Grants -----------------------------------------------------------

export const DharmaSessionGrantTable = pgTable(
  "dharma_session_grants",
  {
    grant_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    subject_identity_public_key: text().notNull(),
    subject_membership_id: text().notNull(),
    issued_by_identity_public_key: text().notNull(),
    issued_by_grant_id: text(),
    capability_set: jsonb().notNull().$type<string[]>().default([]),
    resource_scope: jsonb().notNull().$type<Record<string, unknown>>().default({}),
    execution_constraints: jsonb().$type<Record<string, unknown>>(),
    disclosure_scope: jsonb().$type<Record<string, unknown>>(),
    approval_policy: jsonb().$type<Record<string, unknown>>(),
    delegation_policy: jsonb().$type<Record<string, unknown>>(),
    issued_at: text().notNull(),
    expires_at: text(),
    revoked_at: text(),
    revocation_reason: text(),
    session_key_epoch: integer().notNull().default(0),
    signature: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_grant_sesh_idx").on(table.session_id),
    index("dharma_sesh_grant_subject_idx").on(table.subject_identity_public_key),
    index("dharma_sesh_grant_status_idx").on(table.revoked_at),
  ],
)

// ── Grant Revocations --------------------------------------------------------

export const DharmaSessionGrantRevocationTable = pgTable(
  "dharma_session_grant_revocations",
  {
    revocation_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    grant_id: text().notNull(),
    subject_identity_public_key: text().notNull(),
    revoked_by_identity_public_key: text().notNull(),
    reason: text().notNull(),
    kind: text().notNull().default("graceful"),
    effective_at: text().notNull(),
    previous_key_epoch: integer().notNull(),
    next_key_epoch: integer().notNull(),
    signature: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_revocation_grant_idx").on(table.grant_id),
    index("dharma_sesh_revocation_sesh_idx").on(table.session_id),
  ],
)

// ── Key Epochs ---------------------------------------------------------------

export const DharmaSessionKeyEpochTable = pgTable(
  "dharma_session_key_epochs",
  {
    epoch_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    epoch_number: integer().notNull(),
    previous_epoch_number: integer().notNull().default(-1),
    reason: text().notNull(),
    rotated_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_epoch_sesh_idx").on(table.session_id),
    index("dharma_sesh_epoch_number_idx").on(table.epoch_number),
  ],
)

// ── Session Commands ---------------------------------------------------------

export const DharmaSessionCommandTable = pgTable(
  "dharma_session_commands",
  {
    request_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    actor_identity_public_key: text().notNull(),
    actor_membership_id: text().notNull(),
    grant_id: text().notNull(),
    session_key_epoch: integer().notNull(),
    command_kind: text().notNull(),
    target_scope: text().notNull().default(""),
    payload_digest: text().notNull(),
    payload_reference: text(),
    idempotency_key: text().notNull(),
    requested_at: text().notNull(),
    signature: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_cmd_sesh_idx").on(table.session_id),
    index("dharma_sesh_cmd_actor_idx").on(table.actor_identity_public_key),
    index("dharma_sesh_cmd_kind_idx").on(table.command_kind),
    uniqueIndex("dharma_sesh_cmd_idempotent_unique").on(table.session_id, table.idempotency_key),
  ],
)

// ── Command Receipts ---------------------------------------------------------

export const DharmaSessionCommandReceiptTable = pgTable(
  "dharma_session_command_receipts",
  {
    receipt_id: text().primaryKey(),
    request_id: text().notNull().references(() => DharmaSessionCommandTable.request_id, { onDelete: "cascade" }),
    session_id: text().notNull(),
    actor_identity_public_key: text().notNull(),
    decision: text().notNull(),
    denial_reason: text(),
    authority_evaluation_digest: text(),
    execution_id: text(),
    workspace_before_digest: text(),
    workspace_after_digest: text(),
    output_digest: text(),
    artifact_digest: text(),
    compute_lease_id: text(),
    created_at: text().notNull(),
    finalized_at: text(),
    controller_signature: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_receipt_sesh_idx").on(table.session_id),
    index("dharma_sesh_receipt_request_idx").on(table.request_id),
  ],
)

// ── Approvals ----------------------------------------------------------------

export const DharmaSessionApprovalTable = pgTable(
  "dharma_session_approvals",
  {
    approval_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    request_id: text().notNull(),
    requested_by_identity: text().notNull(),
    required_approver_roles: jsonb().$type<string[]>().default([]),
    required_approval_count: integer().notNull().default(1),
    scope: text().notNull(),
    expires_at: text().notNull(),
    status: text().notNull().default("pending"),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_approval_sesh_idx").on(table.session_id),
    index("dharma_sesh_approval_request_idx").on(table.request_id),
    index("dharma_sesh_approval_status_idx").on(table.status),
  ],
)

// ── Overlays -----------------------------------------------------------------

export const DharmaSessionOverlayTable = pgTable(
  "dharma_session_overlays",
  {
    overlay_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    owner_identity_public_key: text().notNull(),
    base_workspace_digest: text().notNull(),
    current_digest: text().notNull(),
    mutation_count: integer().notNull().default(0),
    created_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_overlay_sesh_idx").on(table.session_id),
    index("dharma_sesh_overlay_owner_idx").on(table.owner_identity_public_key),
  ],
)

// ── Workspace Mutations ------------------------------------------------------

export const DharmaSessionWorkspaceMutationTable = pgTable(
  "dharma_session_workspace_mutations",
  {
    mutation_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    actor_identity_public_key: text().notNull(),
    overlay_id: text(),
    grant_id: text().notNull(),
    base_workspace_digest: text().notNull(),
    target_workspace_digest: text(),
    mutation_kind: text().notNull(),
    path_scope: text().notNull(),
    before_digest: text(),
    after_digest: text(),
    patch_digest: text(),
    approval_state: text().notNull().default("pending"),
    accepted_by: text(),
    accepted_at: text(),
    created_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_mutation_sesh_idx").on(table.session_id),
    index("dharma_sesh_mutation_actor_idx").on(table.actor_identity_public_key),
    index("dharma_sesh_mutation_state_idx").on(table.approval_state),
    index("dharma_sesh_mutation_kind_idx").on(table.mutation_kind),
  ],
)

// ── Workspace Snapshots ------------------------------------------------------

export const DharmaSessionWorkspaceSnapshotTable = pgTable(
  "dharma_session_workspace_snapshots",
  {
    snapshot_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    digest: text().notNull(),
    mutation_count: integer().notNull().default(0),
    parent_digest: text(),
    recorded_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_snapshot_sesh_idx").on(table.session_id),
  ],
)

// ── Artifacts -----------------------------------------------------------------

export const DharmaSessionArtifactTable = pgTable(
  "dharma_session_artifacts",
  {
    artifact_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    kind: text().notNull(),
    digest: text().notNull(),
    size_bytes: integer().notNull().default(0),
    disclosure_class: text().notNull().default("session"),
    created_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_artifact_sesh_idx").on(table.session_id),
    index("dharma_sesh_artifact_kind_idx").on(table.kind),
  ],
)

// ── Compute Leases -----------------------------------------------------------

export const DharmaSessionComputeLeaseTable = pgTable(
  "dharma_session_compute_leases",
  {
    lease_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    requester_identity_public_key: text().notNull(),
    requester_membership_id: text().notNull(),
    provider_identity_public_key: text(),
    backend_kind: text().notNull(),
    trust_tier: integer().notNull().default(0),
    model_artifact_digest: text().notNull(),
    workload_class: text().notNull(),
    input_disclosure_class: text().notNull().default("session"),
    input_digest: text().notNull(),
    output_disclosure_class: text().notNull().default("session"),
    maximum_tokens: integer(),
    maximum_runtime_seconds: integer().notNull().default(60),
    maximum_memory_bytes: integer().notNull().default(0),
    maximum_cost: real(),
    dharma_credit_amount: real(),
    routing_policy: text().notNull().default("local"),
    issued_at: text().notNull(),
    expires_at: text().notNull(),
    revocation_epoch: integer().notNull().default(0),
    status: text().notNull().default("pending"),
    signature_chain: text().notNull().default(""),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_lease_sesh_idx").on(table.session_id),
    index("dharma_sesh_lease_requester_idx").on(table.requester_identity_public_key),
    index("dharma_sesh_lease_status_idx").on(table.status),
    index("dharma_sesh_lease_backend_idx").on(table.backend_kind),
  ],
)

// ── Compute Receipts ---------------------------------------------------------

export const DharmaSessionComputeReceiptTable = pgTable(
  "dharma_session_compute_receipts",
  {
    receipt_id: text().primaryKey(),
    lease_id: text().notNull().references(() => DharmaSessionComputeLeaseTable.lease_id, { onDelete: "cascade" }),
    session_id: text().notNull(),
    backend_kind: text().notNull(),
    provider_identity: text(),
    tokens_used: integer().notNull().default(0),
    runtime_ms: integer().notNull().default(0),
    memory_bytes: integer().notNull().default(0),
    cost: real(),
    result_digest: text().notNull(),
    completed_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_comp_receipt_lease_idx").on(table.lease_id),
    index("dharma_sesh_comp_receipt_sesh_idx").on(table.session_id),
  ],
)

// ── Session Aggregates -------------------------------------------------------

export const DharmaSessionAggregateTable = pgTable(
  "dharma_session_aggregates",
  {
    aggregate_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    federation_id: text().notNull(),
    owner_identity_public_key: text().notNull(),
    source_revision_digest: text().notNull(),
    environment_digest: text(),
    task_taxonomy: text().notNull().default(""),
    task_summary_digest: text().notNull(),
    authority_topology_digest: text().notNull(),
    participant_role_summary: text().notNull().default(""),
    collaboration_timeline_summary: text().notNull().default(""),
    approved_action_summaries: text().notNull().default(""),
    verification_results: text().notNull().default(""),
    accepted_patch_digests: jsonb().$type<string[]>().default([]),
    execution_receipt_digests: jsonb().$type<string[]>().default([]),
    compute_usage_summary: text().notNull().default(""),
    outcome_classification: text().notNull().default(""),
    contribution_receipt_ids: jsonb().$type<string[]>().default([]),
    disclosure_policy: text().notNull().default(""),
    redaction_manifest_digest: text(),
    provenance_chain_digest: text().notNull(),
    emitted_at: text().notNull(),
    signature_chain: jsonb().$type<string[]>().default([]),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_aggregate_sesh_idx").on(table.session_id),
    index("dharma_sesh_aggregate_fed_idx").on(table.federation_id),
  ],
)

// ── Live Channels ------------------------------------------------------------

export const DharmaSessionLiveChannelTable = pgTable(
  "dharma_session_live_channels",
  {
    channel_id: text().primaryKey(),
    session_id: text().notNull().references(() => DharmaSessionTable.session_id, { onDelete: "cascade" }),
    channel_kind: text().notNull(),
    encrypted_endpoint: text().notNull(),
    active_participants: jsonb().$type<string[]>().default([]),
    session_key_epoch: integer().notNull().default(0),
    created_at: text().notNull(),
    closed_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_channel_sesh_idx").on(table.session_id),
  ],
)

// ── Session Audit Log --------------------------------------------------------

export const DharmaSessionAuditLogTable = pgTable(
  "dharma_session_audit_log",
  {
    audit_id: text().primaryKey(),
    session_id: text().notNull(),
    event_type: text().notNull(),
    actor_identity: text(),
    target_id: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    occurred_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_sesh_audit_sesh_idx").on(table.session_id),
    index("dharma_sesh_audit_type_idx").on(table.event_type),
    index("dharma_sesh_audit_occurred_idx").on(table.occurred_at),
  ],
)

// ── Schema Registry ----------------------------------------------------------

import { DHARMA_LIVE_SANDBOX_SCHEMA } from "./live/live-schema.pg.sql"
import { DHARMA_CONTAINMENT_SCHEMA } from "./containment/containment-schema.pg.sql"
import { DHARMA_MULTI_PEER_SCHEMA } from "./multi-peer/multi-peer-schema.pg.sql"
import { DHARMA_COMPUTE_SCHEMA } from "../compute/compute-schema.pg.sql"
import { DHARMA_TRUSTED_LAN_SCHEMA } from "../compute/trusted-lan/trusted-lan-schema.pg.sql"

export const DHARMA_SESSION_SCHEMA = [
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
  ...DHARMA_LIVE_SANDBOX_SCHEMA,
  ...DHARMA_CONTAINMENT_SCHEMA,
  ...DHARMA_MULTI_PEER_SCHEMA,
  ...DHARMA_COMPUTE_SCHEMA,
  ...DHARMA_TRUSTED_LAN_SCHEMA,
] as const
