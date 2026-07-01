/**
 * Track G — Failure Drills: Types
 *
 * Defines the drill taxonomy, governance controls, and result structure
 * for failure-recovery scenario testing in the Dharma runtime.
 * All values are pure (functions + const data).
 */

// ── Drill Taxonomy ----------------------------------------------------------

export type DrillKind =
  | "worker_crash_prefill"
  | "worker_crash_decode"
  | "worker_crash_handoff"
  | "dGPU_reset_active"
  | "kv_event_replay_gap"
  | "stale_capability_ad"
  | "artifact_revocation_active_lease"
  | "session_membership_revocation"
  | "provider_trust_revocation"
  | "transport_disconnect_streaming"
  | "federation_partition"
  | "pglite_restart"
  | "valkey_loss"
  | "malformed_receipt"
  | "duplicate_receipt"
  | "result_conflict"
  | "corrupted_source_package"
  | "containment_backend_unavailable"
  | "failed_source_cleanup"

export type DrillCategory = "crash" | "network" | "authority" | "data_integrity" | "resource"

// ── Drill Definition --------------------------------------------------------

export interface DrillDefinition {
  kind: DrillKind
  name: string
  description: string
  category: DrillCategory
}

// ── All Drills --------------------------------------------------------------

export const ALL_DRILLS: readonly DrillDefinition[] = [
  // ── Crash category ──────────────────────────────────────────────────────
  {
    kind: "worker_crash_prefill",
    name: "Worker Crash During Prefill",
    description: "A worker process crashes while loading model weights (prefill phase). Leases in prefill must be retried on another worker; the session state remains authoritative.",
    category: "crash",
  },
  {
    kind: "worker_crash_decode",
    name: "Worker Crash During Decode",
    description: "A worker process crashes mid-decode (token generation). Streaming consumers must reconnect; partial output may be lost.",
    category: "crash",
  },
  {
    kind: "worker_crash_handoff",
    name: "Worker Crash During Handoff",
    description: "A worker crashes while handing off a compute lease between two workers. The handoff must be replayed or the lease reassigned.",
    category: "crash",
  },
  {
    kind: "dGPU_reset_active",
    name: "dGPU Reset During Active Lease",
    description: "A discrete GPU resets (driver recovery / TDR) while a compute lease is actively running. The lease fails; the GPU must be re-probed before re-admission.",
    category: "crash",
  },
  {
    kind: "failed_source_cleanup",
    name: "Failed Source Cleanup After Materialization",
    description: "Source materialization succeeded but cleanup fails. The stale workspace directory must be quarantined; next materialization creates a fresh root.",
    category: "crash",
  },

  // ── Network category ─────────────────────────────────────────────────────
  {
    kind: "federation_partition",
    name: "Federation Partition",
    description: "Network partition between two federation peers. Pending events queue locally; outstanding compute leases continue until their natural timeout.",
    category: "network",
  },
  {
    kind: "transport_disconnect_streaming",
    name: "Transport Disconnect During Streaming",
    description: "The transport layer disconnects while a streaming response is in flight. The consumer retries on reconnect; partial frames are discarded.",
    category: "network",
  },
  {
    kind: "containment_backend_unavailable",
    name: "Containment Backend Unavailable",
    description: "The OS containment backend (Seatbelt / Linux namespaces) is temporarily unavailable. Sandboxed execution is denied until the backend recovers.",
    category: "network",
  },

  // ── Authority category ───────────────────────────────────────────────────
  {
    kind: "stale_capability_ad",
    name: "Stale Capability Advertisement",
    description: "A provider's capability advertisement is stale — it offers a capability that was revoked. The lease admission check catches the staleness; the provider must re-advertise.",
    category: "authority",
  },
  {
    kind: "artifact_revocation_active_lease",
    name: "Artifact Revocation During Active Lease",
    description: "An artifact (model weights / image) is revoked while a lease referencing it is still running. The current lease is allowed to finish; new leases are rejected.",
    category: "authority",
  },
  {
    kind: "session_membership_revocation",
    name: "Session Membership Revocation",
    description: "A session member is revoked mid-session. Their active grants are invalidated; running leases are drained; remaining members continue.",
    category: "authority",
  },
  {
    kind: "provider_trust_revocation",
    name: "Provider Trust Revocation",
    description: "A provider's trust attestation is revoked. All leases on that provider are cancelled; queued work is reassigned to trusted providers.",
    category: "authority",
  },

  // ── Data-integrity category ──────────────────────────────────────────────
  {
    kind: "kv_event_replay_gap",
    name: "KV Event Replay Gap",
    description: "A gap is detected during KV event replay. The gap range is identified; missing events are fetched from peers or the range is treated as a partial loss.",
    category: "data_integrity",
  },
  {
    kind: "malformed_receipt",
    name: "Malformed Usage Receipt",
    description: "A usage receipt fails structural validation. The receipt is quarantined; the compute result is preserved but flagged for manual review.",
    category: "data_integrity",
  },
  {
    kind: "duplicate_receipt",
    name: "Duplicate Usage Receipt",
    description: "A usage receipt with the same idempotency key as an existing receipt is submitted. The duplicate is silently ignored; the original receipt is authoritative.",
    category: "data_integrity",
  },
  {
    kind: "result_conflict",
    name: "Result Conflict",
    description: "Two peers produce conflicting outcomes for the same computation. Both outcomes are preserved temporarily; a deterministic merge rule selects the canonical result.",
    category: "data_integrity",
  },
  {
    kind: "corrupted_source_package",
    name: "Corrupted Source Package",
    description: "A source package fails content-hash verification after download. The package is rejected; the requester retries with the original manifest to fetch uncorrupted data.",
    category: "data_integrity",
  },

  // ── Resource category ────────────────────────────────────────────────────
  {
    kind: "pglite_restart",
    name: "pglite Restart",
    description: "The embedded pglite instance restarts unexpectedly. In-memory query state is lost; persisted tables survive. Session leases and grants stored in memory are re-established.",
    category: "resource",
  },
  {
    kind: "valkey_loss",
    name: "Valkey Loss",
    description: "The Valkey (Redis-compatible) cache instance is lost. Cached capability decisions, lease lookups, and session metadata must be rebuilt from the primary store.",
    category: "resource",
  },
] as const

// ── Drill Result ------------------------------------------------------------

export interface DrillResult {
  drill: DrillKind
  startedAt: string
  completedAt: string | null
  passed: boolean | null
  whatRemainsAuthoritative: string[]
  whatIsCancelled: string[]
  whatIsRetried: string[]
  whatIsPreserved: string[]
  whatIsRevoked: string[]
  userNextAction: string
  recoveryProof: string
  failureMode: string | null
}

// ── Governance Controls -----------------------------------------------------

export type GovernanceAction =
  | "pause_session"
  | "revoke_member"
  | "revoke_grant"
  | "revoke_provider"
  | "cancel_lease"
  | "invalidate_artifact"
  | "drain_worker"
  | "quarantine_result"
  | "freeze_canonical_outcome"
  | "export_incident_evidence"

export interface GovernanceControl {
  action: GovernanceAction
  description: string
  appliesTo: string[]
  isReversible: boolean
}

export const GOVERNANCE_CONTROLS: Record<GovernanceAction, GovernanceControl> = {
  pause_session: {
    action: "pause_session",
    description: "Pause all session activity. New commands, leases, and grants are suspended; running operations complete or are drained.",
    appliesTo: ["session", "member", "lease"],
    isReversible: true,
  },
  revoke_member: {
    action: "revoke_member",
    description: "Revoke a session member's membership. Their grants are invalidated; active leases they initiated are drained.",
    appliesTo: ["session", "member"],
    isReversible: false,
  },
  revoke_grant: {
    action: "revoke_grant",
    description: "Revoke a specific capability grant. Affected leases complete if already admitted; new lease requests re-check grant validity.",
    appliesTo: ["grant", "member"],
    isReversible: false,
  },
  revoke_provider: {
    action: "revoke_provider",
    description: "Revoke a compute provider's trust attestation. All leases on that provider are cancelled; the provider is removed from the rotation.",
    appliesTo: ["provider", "lease", "trust"],
    isReversible: false,
  },
  cancel_lease: {
    action: "cancel_lease",
    description: "Cancel a specific compute lease. Running execution is terminated; partial results may be preserved.",
    appliesTo: ["lease", "execution"],
    isReversible: false,
  },
  invalidate_artifact: {
    action: "invalidate_artifact",
    description: "Invalidate a prism artifact (model weights / image). New leases referencing the artifact are rejected; existing leases continue.",
    appliesTo: ["artifact", "lease"],
    isReversible: true,
  },
  drain_worker: {
    action: "drain_worker",
    description: "Gracefully drain a worker. No new leases are assigned; running leases complete before the worker is removed.",
    appliesTo: ["worker", "lease"],
    isReversible: false,
  },
  quarantine_result: {
    action: "quarantine_result",
    description: "Quarantine a compute result for manual review. The result is excluded from canonical outcomes until released by an authority.",
    appliesTo: ["result", "receipt", "outcome"],
    isReversible: true,
  },
  freeze_canonical_outcome: {
    action: "freeze_canonical_outcome",
    description: "Freeze the canonical outcome for a specific computation. No further result may overwrite it; used during conflict investigation.",
    appliesTo: ["outcome", "result"],
    isReversible: true,
  },
  export_incident_evidence: {
    action: "export_incident_evidence",
    description: "Export all evidence related to a failure incident: receipts, logs, outcomes, and authority digests. Used for off-line analysis.",
    appliesTo: ["incident", "receipt", "log", "outcome"],
    isReversible: true,
  },
}
