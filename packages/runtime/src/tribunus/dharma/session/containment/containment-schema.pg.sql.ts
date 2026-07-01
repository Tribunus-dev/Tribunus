/**
 * Dharma OS-Enforced Sandbox — PGlite Schema
 *
 * 9 tables for containment instances, profiles, receipts, violations,
 * resource limits, process trees, secret policy, network policy versions,
 * and sandbox destruction records.
 */

import { pgTable, text, integer, real, boolean, jsonb, index } from "drizzle-orm/pg-core"
import { TimestampsPg } from "../../../../storage/schema.pg.sql"

// ── Containment Instances ----------------------------------------------------

export const DharmaContainmentInstanceTable = pgTable(
  "dharma_session_containment_instances",
  {
    instance_id: text().primaryKey(),
    session_id: text().notNull(),
    execution_id: text().notNull(),
    containment_backend: text().notNull(),
    profile_digest: text().notNull(),
    state: text().notNull().default("created"),
    started_at: text().notNull(),
    ended_at: text(),
    termination_reason: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_inst_sesh_idx").on(table.session_id),
    index("dharma_cont_inst_exec_idx").on(table.execution_id),
  ],
)

// ── Containment Profiles -----------------------------------------------------

export const DharmaContainmentProfileTable = pgTable(
  "dharma_session_containment_profiles",
  {
    profile_id: text().primaryKey(),
    session_id: text().notNull(),
    backend_kind: text().notNull(),
    filesystem_policy: jsonb().$type<Record<string, unknown>>().default({}),
    network_policy: jsonb().$type<Record<string, unknown>>().default({}),
    environment_policy: jsonb().$type<Record<string, unknown>>().default({}),
    resource_limits: jsonb().$type<Record<string, unknown>>().default({}),
    ipc_policy: jsonb().$type<Record<string, unknown>>().default({}),
    process_policy: jsonb().$type<Record<string, unknown>>().default({}),
    profile_digest: text().notNull(),
    created_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_prof_sesh_idx").on(table.session_id),
  ],
)

// ── Containment Receipts -----------------------------------------------------

export const DharmaContainmentReceiptTable = pgTable(
  "dharma_session_containment_receipts",
  {
    receipt_id: text().primaryKey(),
    execution_id: text().notNull(),
    session_id: text().notNull(),
    containment_backend: text().notNull(),
    containment_profile_digest: text().notNull(),
    filesystem_policy_digest: text(),
    network_policy_digest: text(),
    resource_policy_digest: text(),
    started_at: text().notNull(),
    ended_at: text(),
    exit_code: integer(),
    termination_reason: text(),
    violation_events: jsonb().$type<Array<Record<string, unknown>>>().default([]),
    stdout_digest: text(),
    stderr_digest: text(),
    process_tree_summary: text().notNull().default(""),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_rec_exec_idx").on(table.execution_id),
    index("dharma_cont_rec_sesh_idx").on(table.session_id),
  ],
)

// ── Containment Violations ---------------------------------------------------

export const DharmaContainmentViolationTable = pgTable(
  "dharma_session_containment_violations",
  {
    violation_id: text().primaryKey(),
    execution_id: text().notNull(),
    session_id: text().notNull(),
    timestamp: text().notNull(),
    kind: text().notNull(),
    severity: text().notNull().default("warning"),
    details: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_viol_exec_idx").on(table.execution_id),
    index("dharma_cont_viol_kind_idx").on(table.kind),
  ],
)

// ── Resource Limits ----------------------------------------------------------

export const DharmaContainmentResourceLimitTable = pgTable(
  "dharma_session_resource_limits",
  {
    limit_id: text().primaryKey(),
    session_id: text().notNull(),
    execution_id: text().notNull(),
    max_runtime_seconds: integer().notNull().default(300),
    max_cpu_seconds: integer().notNull().default(120),
    max_memory_bytes: integer().notNull().default(536870912),
    max_process_count: integer().notNull().default(16),
    max_open_files: integer().notNull().default(64),
    max_disk_write_bytes: integer().notNull().default(104857600),
    max_output_bytes: integer().notNull().default(1048576),
    max_temp_bytes: integer().notNull().default(52428800),
    max_network_bytes: integer().notNull().default(0),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_limit_exec_idx").on(table.execution_id),
  ],
)

// ── Process Trees -----------------------------------------------------------

export const DharmaContainmentProcessTreeTable = pgTable(
  "dharma_session_process_trees",
  {
    tree_id: text().primaryKey(),
    execution_id: text().notNull(),
    session_id: text().notNull(),
    root_pid: integer(),
    containment_id: text(),
    process_group_id: text(),
    child_count: integer().notNull().default(0),
    state: text().notNull().default("running"),
    leaf_pids: jsonb().$type<number[]>().default([]),
    started_at: text().notNull(),
    terminated_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_tree_exec_idx").on(table.execution_id),
  ],
)

// ── Secret Policy -----------------------------------------------------------

export const DharmaContainmentSecretPolicyTable = pgTable(
  "dharma_session_secret_policy",
  {
    policy_id: text().primaryKey(),
    session_id: text().notNull(),
    execution_id: text().notNull(),
    denied_variables: jsonb().$type<string[]>().default([]),
    allowed_variables: jsonb().$type<string[]>().default([]),
    sandbox_home: text().notNull(),
    sandbox_temp: text().notNull(),
    created_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_secret_exec_idx").on(table.execution_id),
  ],
)

// ── Network Policy Versions --------------------------------------------------

export const DharmaContainmentNetworkPolicyTable = pgTable(
  "dharma_session_network_policy_versions",
  {
    policy_id: text().primaryKey(),
    session_id: text().notNull(),
    execution_id: text().notNull(),
    network_mode: text().notNull().default("none"),
    allowed_domains: jsonb().$type<string[]>().default([]),
    allowed_ports: jsonb().$type<number[]>().default([]),
    version: integer().notNull().default(1),
    created_at: text().notNull(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_netpol_exec_idx").on(table.execution_id),
  ],
)

// ── Sandbox Destruction Receipts ---------------------------------------------

export const DharmaContainmentDestructionTable = pgTable(
  "dharma_session_sandbox_destruction_receipts",
  {
    receipt_id: text().primaryKey(),
    session_id: text().notNull(),
    destruction_reason: text().notNull(),
    process_count_terminated: integer().notNull().default(0),
    mutable_bytes_removed: integer().notNull().default(0),
    source_repository_unchanged: boolean().notNull().default(true),
    started_at: text().notNull(),
    completed_at: text(),
    ...TimestampsPg,
  },
  (table) => [
    index("dharma_cont_destroy_sesh_idx").on(table.session_id),
  ],
)

// ── Schema Registry ----------------------------------------------------------

export const DHARMA_CONTAINMENT_SCHEMA = [
  DharmaContainmentInstanceTable,
  DharmaContainmentProfileTable,
  DharmaContainmentReceiptTable,
  DharmaContainmentViolationTable,
  DharmaContainmentResourceLimitTable,
  DharmaContainmentProcessTreeTable,
  DharmaContainmentSecretPolicyTable,
  DharmaContainmentNetworkPolicyTable,
  DharmaContainmentDestructionTable,
] as const
