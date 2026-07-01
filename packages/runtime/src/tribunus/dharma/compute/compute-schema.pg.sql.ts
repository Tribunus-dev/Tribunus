/**
 * Dharma Prism Compute Lease — PGlite Schema
 */

import { pgTable, text, integer, real, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core"
import { TimestampsPg } from "../../../storage/schema.pg.sql"

export const DharmaComputePolicyTable = pgTable("dharma_session_compute_policies", {
  policy_id: text().primaryKey(), session_id: text().notNull(), policy_digest: text().notNull(),
  allowed_targets: jsonb().$type<string[]>().default([]),
  required_determinism_class: text().notNull().default(""),
  allowed_precision_modes: jsonb().$type<string[]>().default([]),
  allowed_memory_tiers: jsonb().$type<string[]>().default([]),
  max_compile_time_ms: integer().notNull().default(30000),
  max_model_load_time_ms: integer().notNull().default(30000),
  allow_cache_reuse: boolean().notNull().default(true),
  allow_compiled_artifact_reuse: boolean().notNull().default(true),
  require_artifact_sealing: boolean().notNull().default(true),
  require_execution_receipts: boolean().notNull().default(true),
  ...TimestampsPg,
}, (t) => [index("dharma_comp_pol_sesh_idx").on(t.session_id)])

export const DharmaComputeLeaseTable = pgTable("dharma_session_compute_leases", {
  lease_id: text().primaryKey(), session_id: text().notNull(), task_id: text(),
  requester_identity: text().notNull(), requester_membership_id: text().notNull(),
  approving_identity: text(), grant_id: text().notNull(), session_key_epoch: integer().notNull(),
  backend_kind: text().notNull().default("prism_local"),
  workload_class: text().notNull(), model_artifact_digest: text().notNull(),
  compute_image_policy_digest: text(),
  input_disclosure_class: text().notNull().default("local_private"),
  input_digest: text().notNull(), input_reference: text(),
  output_disclosure_class: text().notNull().default("local_private"),
  requested_max_tokens: integer(), requested_max_runtime_seconds: integer().notNull().default(60),
  requested_max_memory_bytes: integer().notNull().default(536870912),
  requested_max_output_bytes: integer().notNull().default(1048576),
  requested_max_gpu_time_ms: integer(),
  required_containment_level: text().notNull().default("contained"),
  approval_policy: text().notNull().default(""),
  status: text().notNull().default("draft"), issued_at: text().notNull(),
  expires_at: text(), revoked_at: text(), cancellation_reason: text(),
  signature_chain: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_comp_lease_sesh_idx").on(t.session_id), index("dharma_comp_lease_status_idx").on(t.status)])

export const DharmaComputeExecutionTable = pgTable("dharma_session_compute_executions", {
  execution_id: text().primaryKey(), lease_id: text().notNull(), session_id: text().notNull(),
  model_artifact_digest: text().notNull(), tokenizer_digest: text(),
  compute_image_digest: text(), target_capability_signature: text(),
  workload_class: text().notNull(), input_reference: text().notNull().default(""),
  max_tokens: integer().notNull().default(0), sampling_policy: text().notNull().default(""),
  output_schema: text(), execution_budget: jsonb().$type<Record<string, unknown>>(),
  containment_context_digest: text(), session_context_digest: text(),
  status: text().notNull().default("pending"),
  ...TimestampsPg,
}, (t) => [index("dharma_comp_exec_lease_idx").on(t.lease_id)])

export const DharmaPrismArtifactTable = pgTable("dharma_session_prism_artifacts", {
  artifact_digest: text().primaryKey(), artifact_name: text().notNull(),
  model_family: text().notNull(), model_version: text().notNull(),
  tokenizer_digest: text().notNull(), weight_format: text().notNull(),
  quantization_scheme: text().notNull().default("none"),
  supported_workload_classes: jsonb().$type<string[]>().default([]),
  supported_compute_targets: jsonb().$type<string[]>().default([]),
  required_memory_bytes: integer().notNull().default(0),
  artifact_provenance: text().notNull().default(""),
  signature_status: text().notNull().default(""),
  local_availability: text().notNull().default(""),
  admission_state: text().notNull().default("unknown"),
  admitted_at: text(), revoked_at: text(),
  ...TimestampsPg,
}, (t) => [index("dharma_comp_artifact_state_idx").on(t.admission_state)])

export const DharmaPrismComputeImageTable = pgTable("dharma_session_prism_compute_images", {
  image_id: text().primaryKey(), artifact_digest: text().notNull(),
  compute_image_digest: text().notNull(), target_signature: text().notNull(),
  determinism_class: text().notNull().default(""),
  selected_target: text().notNull(), compiled_at: text().notNull(),
  ...TimestampsPg,
}, (t) => [uniqueIndex("dharma_comp_img_artifact_target_unique").on(t.artifact_digest, t.target_signature)])

export const DharmaPrismUsageReceiptTable = pgTable("dharma_session_prism_usage_receipts", {
  receipt_id: text().primaryKey(), lease_id: text().notNull(), session_id: text().notNull(),
  task_id: text(), actor_identity: text().notNull(),
  model_artifact_digest: text().notNull(), tokenizer_digest: text(),
  compute_image_digest: text(), target_capability_signature: text(),
  containment_profile_digest: text().notNull().default(""),
  workload_class: text().notNull(), input_digest: text().notNull(),
  output_digest: text(), input_token_count: integer(), output_token_count: integer(),
  prefill_duration_ms: integer(), decode_duration_ms: integer(),
  total_duration_ms: integer().notNull().default(0),
  peak_memory_bytes: integer(), cache_hit_status: text(),
  kv_namespace_digest: text(), execution_state: text().notNull(),
  failure_class: text(), emitted_at: text().notNull(), signature: text().notNull(),
  ...TimestampsPg,
}, (t) => [index("dharma_comp_rec_lease_idx").on(t.lease_id), index("dharma_comp_rec_sesh_idx").on(t.session_id)])

export const DharmaPrismKvNamespaceTable = pgTable("dharma_session_prism_kv_namespaces", {
  namespace_id: text().primaryKey(), session_id: text().notNull(), lease_id: text().notNull(),
  model_artifact_digest: text().notNull(), owner_identity: text().notNull(),
  prefix_digest: text().notNull(), residency_tier: text().notNull().default("device"),
  created_at: text().notNull(), expires_at: text(), state: text().notNull().default("allocated"),
  ...TimestampsPg,
}, (t) => [index("dharma_comp_kv_lease_idx").on(t.lease_id), index("dharma_comp_kv_state_idx").on(t.state)])

export const DharmaComputeBudgetViolationTable = pgTable("dharma_session_compute_budget_violations", {
  violation_id: text().primaryKey(), lease_id: text().notNull(), session_id: text().notNull(),
  budget_kind: text().notNull(), limit_value: real().notNull(), actual_value: real().notNull(),
  detected_at: text().notNull(), termination_cause: text().notNull().default(""),
  ...TimestampsPg,
}, (t) => [index("dharma_comp_bv_lease_idx").on(t.lease_id)])

export const DharmaComputeCancellationTable = pgTable("dharma_session_compute_cancellations", {
  cancellation_id: text().primaryKey(), lease_id: text().notNull(), session_id: text().notNull(),
  cancelled_by_identity: text().notNull(), reason: text().notNull(),
  kind: text().notNull().default("user_cancelled"), cancelled_at: text().notNull(),
  ...TimestampsPg,
}, (t) => [index("dharma_comp_cancel_lease_idx").on(t.lease_id)])

export const DharmaComputeRecoveryStateTable = pgTable("dharma_session_compute_recovery_state", {
  recovery_id: text().primaryKey(), session_id: text().notNull(), lease_id: text().notNull(),
  recovery_kind: text().notNull(), state: text().notNull().default("pending"),
  detail: jsonb().$type<Record<string, unknown>>(), created_at: text().notNull(),
  resolved_at: text(), ...TimestampsPg,
}, (t) => [index("dharma_comp_recov_lease_idx").on(t.lease_id)])

export const DHARMA_COMPUTE_SCHEMA = [
  DharmaComputePolicyTable, DharmaComputeLeaseTable, DharmaComputeExecutionTable,
  DharmaPrismArtifactTable, DharmaPrismComputeImageTable, DharmaPrismUsageReceiptTable,
  DharmaPrismKvNamespaceTable, DharmaComputeBudgetViolationTable,
  DharmaComputeCancellationTable, DharmaComputeRecoveryStateTable,
] as const
