/**
 * Dharma Multi-Peer — PGlite Schema Additions
 */

import { pgTable, text, integer, real, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core"
import { TimestampsPg } from "../../../../storage/schema.pg.sql"

export const DharmaSessionTaskTable = pgTable("dharma_session_tasks", {
  task_id: text().primaryKey(),
  session_id: text().notNull(),
  created_by_identity: text().notNull(),
  title: text().notNull(),
  summary: text().notNull().default(""),
  task_kind: text().notNull(),
  parallelism: text().notNull().default("exclusive"),
  source_basis_digest: text().notNull(),
  source_disclosure_package_id: text(),
  allowed_path_scopes: jsonb().$type<string[]>().default([]),
  denied_path_scopes: jsonb().$type<string[]>().default([]),
  expected_artifact_classes: jsonb().$type<string[]>().default([]),
  verification_contract: text().notNull().default(""),
  acceptance_policy: text().notNull().default("reviewed"),
  required_capabilities: jsonb().$type<string[]>().default([]),
  assigned_membership_ids: jsonb().$type<string[]>().default([]),
  max_contributors: integer().notNull().default(1),
  max_result_bundles: integer().notNull().default(1),
  claim_deadline: text(),
  completion_deadline: text(),
  status: text().notNull().default("draft"),
  signature: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_task_sesh_idx").on(t.session_id), index("dharma_mp_task_status_idx").on(t.status)])

export const DharmaSessionTaskClaimTable = pgTable("dharma_session_task_claims", {
  claim_id: text().primaryKey(),
  task_id: text().notNull(),
  session_id: text().notNull(),
  claimant_identity: text().notNull(),
  claimant_membership_id: text().notNull(),
  claimed_source_basis_digest: text().notNull(),
  local_sandbox_attestation_digest: text().notNull().default(""),
  claimed_at: text().notNull(),
  expires_at: text(),
  status: text().notNull().default("claimed"),
  signature: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_claim_task_idx").on(t.task_id), index("dharma_mp_claim_status_idx").on(t.status)])

export const DharmaSessionSourcePackageTable = pgTable("dharma_session_source_packages", {
  package_id: text().primaryKey(),
  session_id: text().notNull(),
  source_basis_digest: text().notNull(),
  disclosure_class: text().notNull(),
  source_scope: text().notNull().default(""),
  package_manifest_digest: text().notNull(),
  encrypted_payload_reference: text(),
  artifact_references: jsonb().$type<string[]>().default([]),
  created_by_identity: text().notNull(),
  intended_membership_ids: jsonb().$type<string[]>().default([]),
  expires_at: text(),
  signature: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_pkg_sesh_idx").on(t.session_id)])

export const DharmaSessionSourcePackageRecipientTable = pgTable("dharma_session_source_package_recipients", {
  recipient_id: text().primaryKey(),
  package_id: text().notNull(),
  session_id: text().notNull(),
  membership_id: text().notNull(),
  authorized_at: text().notNull(),
  revoked_at: text(),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_pkg_recip_pkg_idx").on(t.package_id), index("dharma_mp_pkg_recip_member_idx").on(t.membership_id)])

export const DharmaSessionResultBundleTable = pgTable("dharma_session_result_bundles", {
  result_id: text().primaryKey(),
  session_id: text().notNull(),
  task_id: text().notNull(),
  actor_identity: text().notNull(),
  actor_membership_id: text().notNull(),
  claim_id: text().notNull(),
  source_basis_digest: text().notNull(),
  source_disclosure_package_id: text(),
  environment_digest: text().notNull().default(""),
  containment_profile_digest: text().notNull().default(""),
  local_sandbox_attestation: text().notNull().default(""),
  patch_digest: text(),
  changed_path_digests: jsonb().$type<string[]>().default([]),
  artifact_digests: jsonb().$type<string[]>().default([]),
  test_receipt_digests: jsonb().$type<string[]>().default([]),
  benchmark_receipt_digests: jsonb().$type<string[]>().default([]),
  verification_summary: text().notNull().default(""),
  final_local_workspace_digest: text().notNull().default(""),
  disclosure_class: text().notNull().default("full_snapshot"),
  validation_state: text().notNull().default("received"),
  signature: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_result_task_idx").on(t.task_id), index("dharma_mp_result_state_idx").on(t.validation_state)])

export const DharmaSessionCanonicalOutcomeTable = pgTable("dharma_session_canonical_outcomes", {
  outcome_id: text().primaryKey(),
  session_id: text().notNull(),
  accepted_result_id: text().notNull(),
  accepted_by_identity: text().notNull(),
  parent_outcome_digest: text(),
  source_basis_digest: text().notNull(),
  canonical_outcome_digest: text().notNull(),
  changed_path_digests: jsonb().$type<string[]>().default([]),
  verification_status: text().notNull().default("verified"),
  acceptance_reason: text(),
  accepted_at: text().notNull(),
  sequence: integer().notNull().default(0),
  signature: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_outcome_sesh_idx").on(t.session_id), index("dharma_mp_outcome_seq_idx").on(t.sequence)])

export const DharmaSessionResultConflictTable = pgTable("dharma_session_result_conflicts", {
  conflict_id: text().primaryKey(),
  session_id: text().notNull(),
  task_id: text().notNull(),
  proposed_result_id: text().notNull(),
  conflicting_result_id: text(),
  conflict_kind: text().notNull(),
  base_digest: text().notNull(),
  current_canonical_digest: text().notNull(),
  overlapping_paths: jsonb().$type<string[]>().default([]),
  detected_at: text().notNull(),
  resolution_state: text().notNull().default("open"),
  resolution_result_id: text(),
  resolved_by_identity: text(),
  resolved_at: text(),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_conflict_sesh_idx").on(t.session_id), index("dharma_mp_conflict_state_idx").on(t.resolution_state)])

export const DharmaSessionArtifactAccessRequestTable = pgTable("dharma_session_artifact_access_requests", {
  request_id: text().primaryKey(),
  session_id: text().notNull(),
  artifact_digest: text().notNull(),
  requester_membership_id: text().notNull(),
  requested_purpose: text().notNull().default(""),
  requested_at: text().notNull(),
  signature: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_artifact_req_sesh_idx").on(t.session_id)])

export const DharmaSessionArtifactAccessDecisionTable = pgTable("dharma_session_artifact_access_decisions", {
  decision_id: text().primaryKey(),
  request_id: text().notNull(),
  session_id: text().notNull(),
  decision: text().notNull(),
  allowed_scope: text().notNull().default(""),
  expires_at: text(),
  artifact_delivery_reference: text(),
  decided_by_identity: text().notNull(),
  signature: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_artifact_dec_sesh_idx").on(t.session_id)])

export const DharmaSessionParallelWorkPolicyTable = pgTable("dharma_session_parallel_work_policy", {
  policy_id: text().primaryKey(),
  session_id: text().notNull(),
  minimum_acceptance_level: text().notNull().default("reviewed"),
  require_local_reproduction: boolean().notNull().default(false),
  require_corroboration: boolean().notNull().default(false),
  corroboration_count: integer().notNull().default(2),
  require_benchmark: boolean().notNull().default(false),
  benchmark_threshold: text(),
  require_review: boolean().notNull().default(true),
  required_reviewers: jsonb().$type<string[]>().default([]),
  auto_accept_non_overlapping: boolean().notNull().default(false),
  ...TimestampsPg,
}, (t) => [index("dharma_mp_policy_sesh_idx").on(t.session_id)])

export const DHARMA_MULTI_PEER_SCHEMA = [
  DharmaSessionTaskTable, DharmaSessionTaskClaimTable,
  DharmaSessionSourcePackageTable, DharmaSessionSourcePackageRecipientTable,
  DharmaSessionResultBundleTable, DharmaSessionCanonicalOutcomeTable,
  DharmaSessionResultConflictTable,
  DharmaSessionArtifactAccessRequestTable, DharmaSessionArtifactAccessDecisionTable,
  DharmaSessionParallelWorkPolicyTable,
] as const
