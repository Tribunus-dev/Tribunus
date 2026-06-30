/**
 * Dharma Trusted-LAN Prism Compute — PGlite Schema
 */

import { pgTable, text, integer, real, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core"
import { TimestampsPg } from "../../../../storage/schema.pg.sql"

export const DharmaLanProviderTable = pgTable("dharma_compute_lan_providers", {
  provider_id: text().primaryKey(), identity_public_key: text().notNull(),
  device_public_key: text().notNull(), federation_id: text().notNull(),
  display_name: text(), transport_public_key: text().notNull(),
  enrollment_state: text().notNull().default("draft"), status: text().notNull().default("offline"),
  capability_advertisement_id: text(), containment_capability_digest: text().notNull().default(""),
  last_seen_at: text(), revoked_at: text(), ...TimestampsPg,
}, (t) => [index("dharma_lan_prov_identity_idx").on(t.identity_public_key)])

export const DharmaLanProviderCapabilityTable = pgTable("dharma_compute_lan_provider_capabilities", {
  capability_id: text().primaryKey(), provider_id: text().notNull(),
  protocol_version: integer().notNull().default(1),
  supported_workload_classes: jsonb().$type<string[]>().default([]),
  artifact_summaries: jsonb().$type<Array<Record<string, unknown>>>().default([]),
  compute_target_summaries: jsonb().$type<string[]>().default([]),
  containment_capability_digest: text().notNull().default(""),
  max_concurrent_leases: integer().notNull().default(1),
  max_input_tokens: integer().notNull().default(4096),
  max_output_tokens: integer().notNull().default(4096),
  max_runtime_seconds: integer().notNull().default(120),
  max_memory_bytes: integer().notNull().default(536870912),
  supported_output_modes: jsonb().$type<string[]>().default([]),
  supported_disclosure_classes: jsonb().$type<string[]>().default([]),
  health_summary: text().notNull().default("available"),
  expires_at: text().notNull(), signature: text().notNull().default(""), ...TimestampsPg,
}, (t) => [index("dharma_lan_cap_prov_idx").on(t.provider_id)])

export const DharmaLanProviderTrustTable = pgTable("dharma_compute_lan_provider_trust", {
  trust_id: text().primaryKey(), federation_id: text().notNull(),
  provider_identity_public_key: text().notNull(),
  granted_by_identity_public_key: text().notNull(),
  allowed_session_ids: jsonb().$type<string[] | null>(),
  allowed_workload_classes: jsonb().$type<string[]>().default([]),
  allowed_disclosure_classes: jsonb().$type<string[]>().default([]),
  allowed_artifact_digests: jsonb().$type<string[]>().default([]),
  allowed_target_classes: jsonb().$type<string[]>().default([]),
  max_runtime_seconds: integer().notNull().default(60),
  max_tokens: integer().notNull().default(4096),
  max_memory_bytes: integer().notNull().default(536870912),
  max_concurrent_leases: integer().notNull().default(1),
  allow_streaming: boolean().notNull().default(false),
  allow_result_artifact_return: boolean().notNull().default(false),
  expires_at: text().notNull(), revoked_at: text(), reason_digest: text(),
  signature: text().notNull().default(""), ...TimestampsPg,
}, (t) => [index("dharma_lan_trust_prov_idx").on(t.provider_identity_public_key)])

export const DharmaLanPairingTable = pgTable("dharma_compute_lan_pairings", {
  pairing_id: text().primaryKey(), requester_identity: text().notNull(),
  provider_identity: text().notNull(), transport_public_key: text().notNull(),
  pairing_method: text().notNull().default("manual"),
  status: text().notNull().default("pending"), expires_at: text(), ...TimestampsPg,
}, (t) => [index("dharma_lan_pair_req_idx").on(t.requester_identity), index("dharma_lan_pair_prov_idx").on(t.provider_identity)])

export const DharmaLanDiscoverySessionTable = pgTable("dharma_compute_lan_discovery_sessions", {
  session_id: text().primaryKey(), node_identity: text().notNull(),
  discovery_kind: text().notNull().default("lan"),
  started_at: text().notNull(), ended_at: text(), ...TimestampsPg,
})

export const DharmaLanTransportSessionTable = pgTable("dharma_compute_lan_transport_sessions", {
  transport_id: text().primaryKey(), lease_id: text().notNull(),
  provider_id: text().notNull(), requester_identity: text().notNull(),
  handshake_protocol_version: integer().notNull().default(1),
  state: text().notNull().default("pending"),
  started_at: text().notNull(), ended_at: text(), ...TimestampsPg,
}, (t) => [index("dharma_lan_trans_lease_idx").on(t.lease_id)])

export const DharmaLanLeaseTable = pgTable("dharma_compute_lan_leases", {
  lease_id: text().primaryKey(), session_id: text().notNull(), task_id: text(),
  requester_identity: text().notNull(), requester_membership_id: text().notNull(),
  requester_device_public_key: text().notNull().default(""),
  provider_id: text().notNull(), provider_identity: text().notNull(),
  backend_kind: text().notNull().default("prism_trusted_lan"),
  workload_class: text().notNull(), model_artifact_digest: text().notNull(),
  tokenizer_digest: text(), artifact_parity_mode: text().notNull().default("strict_artifact_parity"),
  compute_image_policy_digest: text(), requested_target_constraints: text().notNull().default(""),
  input_disclosure_class: text().notNull().default("local_private"),
  input_digest: text().notNull(), input_reference: text(),
  output_disclosure_class: text().notNull().default("local_private"),
  requested_max_input_tokens: integer().notNull().default(4096),
  requested_max_output_tokens: integer().notNull().default(4096),
  requested_max_runtime_seconds: integer().notNull().default(60),
  requested_max_memory_bytes: integer().notNull().default(536870912),
  requested_max_output_bytes: integer().notNull().default(1048576),
  requested_max_gpu_time_ms: integer(),
  required_containment_level: text().notNull().default("contained"),
  provider_trust_scope_digest: text().notNull().default(""),
  disconnect_policy: text().notNull().default("fail_closed"),
  status: text().notNull().default("draft"),
  issued_at: text().notNull(), expires_at: text(),
  signature_chain: text().notNull().default(""), ...TimestampsPg,
}, (t) => [index("dharma_lan_lease_sesh_idx").on(t.session_id), index("dharma_lan_lease_status_idx").on(t.status)])

export const DharmaLanLeaseAdmissionTable = pgTable("dharma_compute_lan_lease_admissions", {
  admission_id: text().primaryKey(), lease_id: text().notNull(),
  provider_id: text().notNull(), admission_state: text().notNull().default("pending"),
  rejection_class: text(), rejection_reason: text(),
  evaluated_at: text().notNull(), ...TimestampsPg,
}, (t) => [index("dharma_lan_adm_lease_idx").on(t.lease_id)])

export const DharmaLanExecutionTable = pgTable("dharma_compute_lan_executions", {
  execution_id: text().primaryKey(), lease_id: text().notNull(),
  provider_id: text().notNull(), model_artifact_digest: text().notNull(),
  compute_image_digest: text(), target_capability_signature: text(),
  workload_class: text().notNull(),
  status: text().notNull().default("pending"), ...TimestampsPg,
}, (t) => [index("dharma_lan_exec_lease_idx").on(t.lease_id)])

export const DharmaLanUsageReceiptTable = pgTable("dharma_compute_lan_usage_receipts", {
  receipt_id: text().primaryKey(), lease_id: text().notNull(), session_id: text().notNull(),
  requester_identity: text().notNull(), provider_identity: text().notNull(),
  provider_id: text().notNull(), model_artifact_digest: text().notNull(),
  tokenizer_digest: text(), compute_image_digest: text(),
  target_capability_signature: text(), containment_profile_digest: text().notNull().default(""),
  workload_class: text().notNull(), input_digest: text().notNull(), output_digest: text(),
  input_token_count: integer(), output_token_count: integer(),
  prefill_duration_ms: integer(), decode_duration_ms: integer(),
  total_duration_ms: integer().notNull().default(0), peak_memory_bytes: integer(),
  cache_status: text(), execution_state: text().notNull(),
  failure_class: text(), emitted_at: text().notNull(),
  provider_signature: text().notNull(), ...TimestampsPg,
}, (t) => [index("dharma_lan_rec_lease_idx").on(t.lease_id)])

export const DharmaLanKvNamespaceTable = pgTable("dharma_compute_lan_kv_namespaces", {
  namespace_id: text().primaryKey(), provider_id: text().notNull(),
  session_id: text().notNull(), lease_id: text().notNull(),
  model_artifact_digest: text().notNull(), prefix_digest: text(),
  residency_tier: text().notNull().default("device"),
  state: text().notNull().default("allocated"), expires_at: text(), ...TimestampsPg,
}, (t) => [index("dharma_lan_kv_lease_idx").on(t.lease_id), index("dharma_lan_kv_state_idx").on(t.state)])

export const DharmaLanCancellationTable = pgTable("dharma_compute_lan_cancellations", {
  cancellation_id: text().primaryKey(), lease_id: text().notNull(),
  initiated_by_identity: text().notNull(), reason: text().notNull(),
  cancelled_at: text().notNull(), ...TimestampsPg,
}, (t) => [index("dharma_lan_cancel_lease_idx").on(t.lease_id)])

export const DharmaLanProviderHealthTable = pgTable("dharma_compute_lan_provider_health", {
  health_id: text().primaryKey(), provider_id: text().notNull(),
  health_state: text().notNull().default("offline"),
  active_lease_count: integer().notNull().default(0),
  reported_at: text().notNull(), ...TimestampsPg,
}, (t) => [index("dharma_lan_health_prov_idx").on(t.provider_id)])

export const DharmaLanRecoveryStateTable = pgTable("dharma_compute_lan_recovery_state", {
  recovery_id: text().primaryKey(), provider_id: text().notNull(), lease_id: text().notNull(),
  recovery_kind: text().notNull(), state: text().notNull().default("pending"),
  detail: jsonb().$type<Record<string, unknown>>(), ...TimestampsPg,
}, (t) => [index("dharma_lan_recov_lease_idx").on(t.lease_id)])

export const DHARMA_TRUSTED_LAN_SCHEMA = [
  DharmaLanProviderTable, DharmaLanProviderCapabilityTable, DharmaLanProviderTrustTable,
  DharmaLanPairingTable, DharmaLanDiscoverySessionTable, DharmaLanTransportSessionTable,
  DharmaLanLeaseTable, DharmaLanLeaseAdmissionTable, DharmaLanExecutionTable,
  DharmaLanUsageReceiptTable, DharmaLanKvNamespaceTable, DharmaLanCancellationTable,
  DharmaLanProviderHealthTable, DharmaLanRecoveryStateTable,
] as const
