/**
 * Track G — Failure Drills: Scenario Simulations
 *
 * Each function simulates the recovery standard for one drill kind,
 * returning the expected DrillResult that the system would produce.
 * All functions are pure: no side effects, no external state.
 */

import type { DrillResult, DrillKind } from "./drill-types"

// ── Helpers -----------------------------------------------------------------

const ISO = (date: Date): string => date.toISOString()

/** Fixed reference timestamp for all simulations: session start. */
const SESSION_START = "2026-07-01T12:00:00.000Z"

/** Now — the moment of failure detection. */
const NOW = "2026-07-01T12:05:00.000Z"

/** A short delay simulating recovery processing. */
const LATER = "2026-07-01T12:05:12.000Z"

function result(
  drill: DrillKind,
  passed: boolean | null,
  whatRemainsAuthoritative: string[],
  whatIsCancelled: string[],
  whatIsRetried: string[],
  whatIsPreserved: string[],
  whatIsRevoked: string[],
  userNextAction: string,
  recoveryProof: string,
  failureMode: string | null,
): DrillResult {
  return {
    drill,
    startedAt: NOW,
    completedAt: passed !== null ? LATER : null,
    passed,
    whatRemainsAuthoritative,
    whatIsCancelled,
    whatIsRetried,
    whatIsPreserved,
    whatIsRevoked,
    userNextAction,
    recoveryProof,
    failureMode,
  }
}

// ── Crash: Worker Crashes ───────────────────────────────────────────────────

export function simulateWorkerCrashPrefill(): DrillResult {
  return result(
    "worker_crash_prefill",
    true,
    [
      "Session state is authoritative — prefill didn't mutate it",
      "Lease request manifest is preserved for retry",
      "Artifact weight metadata remains authoritative",
    ],
    ["Lease in prefill phase is cancelled"],
    ["Prefill is retried on an eligible worker (round-robin)"],
    ["Original source manifest is preserved"],
    ["None — no grants or memberships affected"],
    "Verify the replacement worker has the required artifact cached; if not, trigger pre-warm.",
    "Lease retry key committed to KV. Replacement worker confirmed eligible via capability advertisement.",
    null,
  )
}

export function simulateWorkerCrashDecode(): DrillResult {
  return result(
    "worker_crash_decode",
    false,
    [
      "Session state is authoritative",
      "Completed prefill output is recoverable from checkpoint",
    ],
    [
      "Current decode lease is cancelled",
      "Partial token output is discarded",
    ],
    [
      "Decode is retried on a different worker with prefill state restored",
    ],
    ["Checkpointed KV-cache state (if available) is preserved"],
    ["None"],
    "Reconnect streaming consumers after new worker accepts the lease. Restore KV-cache from checkpoint if the backend supports it.",
    "Prefill checkpoint hash verified. Replacement worker confirmed to have matching artifact and sufficient VRAM.",
    "Partial output loss — end-user may need to re-prompt.",
  )
}

export function simulateWorkerCrashHandoff(): DrillResult {
  return result(
    "worker_crash_handoff",
    false,
    [
      "Session authority (membership + grants) is authoritative",
      "Lease record with handoff marker is preserved in event log",
    ],
    [
      "The in-flight handoff session is cancelled",
      "Pending token generation from the source worker is discarded",
    ],
    [
      "The lease handoff is retried: a fresh handshake from the destination worker",
    ],
    ["KV namespace state from before the handoff is preserved"],
    ["None"],
    "Verify the destination worker is still healthy; re-initiate handoff from the last confirmed checkpoint.",
    "Handoff event sequence audited. Checkpoint offset committed in KV before crash. Destination worker eligibility re-confirmed.",
    "Handoff protocol interrupted — lease may briefly appear in-transit.",
  )
}

// ── Crash: dGPU Reset -------------------------------------------------------

export function simulateDGPUResetActive(): DrillResult {
  return result(
    "dGPU_reset_active",
    false,
    [
      "Session and lease metadata remain authoritative",
      "GPU capability detection results from last successful probe are cached",
    ],
    [
      "Active compute lease on the affected GPU is failed",
      "Pending GPU memory allocations are invalidated",
    ],
    [
      "Lease is retried on a different GPU or worker after re-probe",
    ],
    [
      "Model weights already loaded on other GPUs on the same worker",
    ],
    ["None"],
    "Re-probe GPU availability and driver health before re-admitting leases that require dGPU. Check for memory-capable fallback GPUs.",
    "GPU health probe initiated. Driver recovery signature confirmed in system log. Fallback worker list refreshed.",
    "GPU TDR / driver recovery event — in-flight compute lost.",
  )
}

// ── Crash: Failed Source Cleanup --------------------------------------------

export function simulateFailedSourceCleanup(): DrillResult {
  return result(
    "failed_source_cleanup",
    true,
    [
      "Materialized source directory is authoritative for the session",
      "Session state is not affected",
    ],
    [
      "The stale workspace directory is quarantined",
    ],
    [
      "Source materialization is not re-run — the existing materialization is valid",
    ],
    [
      "The successful materialization result is preserved",
    ],
    ["The failed cleanup reference is revoked from the cleanup tracker"],
    "Manually delete the quarantined directory or schedule a deferred cleanup via an admin operation.",
    "Stale directory path recorded in quarantine log. Next materialization uses a fresh root path. Cleanup failure was non-critical.",
    "Cleanup failed — stale data may occupy disk space until manually purged.",
  )
}

// ── Network: Federation Partition -------------------------------------------

export function simulateFederationPartition(): DrillResult {
  return result(
    "federation_partition",
    null,
    [
      "Local session state remains authoritative within the partition",
      "Pending events are queued locally with causal ordering preserved",
    ],
    [
      "None — in-flight leases continue on their natural timeout",
    ],
    [
      "Event replication is retried automatically on reconnection",
      "Membership / capability sync is retried on reconnection",
    ],
    [
      "Queued outbound events are preserved in the local outbox",
      "Compute leases local to the partition continue unimpeded",
    ],
    ["None"],
    "Monitor the partition. On reconnect, replay the outbox and reconcile membership state. If partition exceeds the timeout window, escalate.",
    "Partition detected by heartbeat timeout. Outbox durable in KV store. Reconnect listener registered.",
    "Partition detected — no data loss, but federation events are delayed.",
  )
}

// ── Network: Transport Disconnect During Streaming ---------------------------

export function simulateTransportDisconnectStreaming(): DrillResult {
  return result(
    "transport_disconnect_streaming",
    null,
    [
      "Compute lease and output frame metadata remain authoritative",
      "Streaming session back-pressure state is authoritative",
    ],
    [
      "Partial / in-flight frames are discarded",
    ],
    [
      "Streaming is resumed from the last confirmed frame after reconnect",
    ],
    [
      "Last confirmed output frame before disconnect is preserved",
      "Back-pressure credit allocation is preserved",
    ],
    ["None"],
    "Reconnect the transport channel. Request resume from the last confirmed frame id. Notify consumer of the gap.",
    "Transport heartbeat sequence gap identified. Last confirmed frame hash committed. Resume token issued.",
    "Transient disconnect — partial frame loss during gap.",
  )
}

// ── Network: Containment Backend Unavailable ---------------------------------

export function simulateContainmentBackendUnavailable(): DrillResult {
  return result(
    "containment_backend_unavailable",
    true,
    [
      "All session state remains authoritative",
      "Containment capability cache from last successful probe is authoritative",
    ],
    [
      "New sandboxed execution requests are denied",
    ],
    [
      "Execution requests are queued for retry after backend recovery",
    ],
    [
      "Existing sandboxed processes continue on their current backend",
    ],
    ["None"],
    "Re-probe the OS containment backend (Seatbelt / namespaces). Once available, re-allow sandboxed execution and process the retry queue.",
    "Backend health probe failed — capability cache marks backend as unavailable. Retry timer set for next probe interval.",
    "OS containment backend unavailable — new sandboxed execution denied.",
  )
}

// ── Authority: Stale Capability Advertisement --------------------------------

export function simulateStaleCapabilityAd(): DrillResult {
  return result(
    "stale_capability_ad",
    true,
    [
      "Session capability policy remains authoritative",
      "Provider's active trust attestation remains authoritative (if still valid)",
    ],
    [
      "Lease admission referencing the stale ad is rejected",
    ],
    [
      "None — the provider must refresh its ad before being considered again",
    ],
    [
      "Other capabilities from the same provider remain valid",
    ],
    ["The stale capability entry is removed from the active rotation"],
    "Provider should re-publish a capability advertisement with current data. Manual override available via governance if mis-detection.",
    "Stale ad detected via version counter mismatch. Provider notified. Rotated out until fresh ad received.",
    null,
  )
}

// ── Authority: Artifact Revocation During Active Lease -----------------------

export function simulateArtifactRevocation(): DrillResult {
  return result(
    "artifact_revocation_active_lease",
    true,
    [
      "Session authority and grant state remain authoritative",
      "Artifact revocation record is authoritative",
    ],
    [
      "New lease requests referencing the revoked artifact are rejected",
    ],
    [
      "None — the existing lease is allowed to complete as an exception",
    ],
    [
      "The running lease's execution continues using the cached artifact",
      "Any completed outputs from the running lease are preserved",
    ],
    ["The artifact is marked revoked in the admission registry"],
    "Monitor the running lease for completion. After it finishes, remove the artifact from all worker caches.",
    "Artifact revocation committed to KV. Running lease tagged as grandfathered. New admission checks now reject this artifact.",
    null,
  )
}

// ── Authority: Session Membership Revocation ---------------------------------

export function simulateMembershipRevocation(): DrillResult {
  return result(
    "session_membership_revocation",
    true,
    [
      "Session authority and remaining members' state remain authoritative",
      "Revocation record is authoritative",
    ],
    [
      "All grants belonging to the revoked member are invalidated",
      "Active leases initiated by the revoked member are drained (graceful termination)",
    ],
    [
      "None — revocation is immediate and irreversible",
    ],
    [
      "Session's canonical outcomes are preserved",
      "Other members' leases and grants are preserved",
    ],
    ["The revoked member's membership is removed from the session roster"],
    "Verify the member's grants are no longer accepted by the command controller. Notify remaining members of the change.",
    "Membership revocation committed to event log. All grants in the revoked member's grant chain superseded by key epoch bump.",
    null,
  )
}

// ── Authority: Provider Trust Revocation -------------------------------------

export function simulateProviderTrustRevocation(): DrillResult {
  return result(
    "provider_trust_revocation",
    true,
    [
      "Session authority and remaining providers' trust state remain authoritative",
      "Trust revocation record is authoritative",
    ],
    [
      "All active leases on the revoked provider are cancelled",
      "Pending work offers assigned to the provider are invalidated",
    ],
    [
      "Cancelled leases are reassigned to eligible trusted providers",
    ],
    [
      "Completed outputs from the revoked provider are quarantined for review",
    ],
    ["The provider's trust attestation is revoked and removed from the rotation"],
    "Verify no new leases are routed to the revoked provider. Review quarantined outputs before releasing to consumers.",
    "Trust attestation chain invalidated. Provider removed from worker pool. Lease reassignment committed to KV.",
    null,
  )
}

// ── Data Integrity: KV Event Replay Gap -------------------------------------

export function simulateKVEventReplayGap(): DrillResult {
  return result(
    "kv_event_replay_gap",
    null,
    [
      "All events before the gap are authoritative",
      "All events after the gap with verifiable causal parents are authoritative",
    ],
    [
      "None — gaps are not cancelled, they are resolved",
    ],
    [
      "Missing events in the gap range are fetched from healthy peers",
    ],
    [
      "Events outside the gap range are preserved",
      "KV namespace metadata indices are preserved",
    ],
    ["None"],
    "Identify the gap range. Request the missing events from a peer federation node. On failure, mark the gap as unrecoverable and escalate.",
    "Gap range identified via sequence number discontinuity. Peer fetch request dispatched. Gap resolution timer active.",
    "Partial event loss — gap may be unrecoverable if no peer has the missing events.",
  )
}

// ── Data Integrity: Malformed Receipt ---------------------------------------

export function simulateMalformedReceipt(): DrillResult {
  return result(
    "malformed_receipt",
    true,
    [
      "The compute result that the receipt was supposed to describe remains authoritative in its execution record",
    ],
    [
      "The malformed receipt is quarantined — it is not processed or persisted",
    ],
    [
      "The producer may re-submit a corrected receipt referencing the same execution id",
    ],
    [
      "The original execution descriptor and output are preserved",
    ],
    ["None — the receipt was never accepted"],
    "Investigate the malformed receipt for patterns (common producer bug). Request re-submission with correct fields, or manually reconstruct if urgent.",
    "Receipt validation failed on structural check. Receipt quarantined to incident log. Original execution descriptor preserved.",
    "Receipt rejected — manual investigation needed of the producer.",
  )
}

// ── Data Integrity: Duplicate Receipt ----------------------------------------

export function simulateDuplicateReceipt(): DrillResult {
  return result(
    "duplicate_receipt",
    true,
    [
      "The original receipt remains authoritative",
    ],
    [
      "The duplicate submission is silently discarded",
    ],
    [
      "None — no retry is needed",
    ],
    [
      "The original receipt and its metadata are preserved intact",
    ],
    ["None"],
    "No action required. If duplicates are frequent, investigate the producer's idempotency logic.",
    "Idempotency key matched existing receipt. Duplicate suppressed. Original receipt unchanged.",
    null,
  )
}

// ── Data Integrity: Result Conflict ------------------------------------------

export function simulateResultConflict(): DrillResult {
  return result(
    "result_conflict",
    null,
    [
      "Prior committed canonical outcomes are authoritative",
    ],
    [
      "Neither conflicting result is accepted as canonical until resolved",
    ],
    [
      "Computation may be re-run on a third peer to produce a tie-breaking result",
    ],
    [
      "Both conflicting results are preserved for investigation",
    ],
    ["None until resolution"],
    "Compare the conflicting results. Apply the deterministic merge rule (lowest peer id wins by default). If ambiguity remains, escalate for manual review.",
    "Conflict detected. Both outcomes preserved. Deterministic merge rule selected candidate. Third-party execution requested as tie-breaker.",
    "Outcome conflict — manual review may be required.",
  )
}

// ── Data Integrity: Corrupted Source Package ---------------------------------

export function simulateCorruptedSourcePackage(): DrillResult {
  return result(
    "corrupted_source_package",
    true,
    [
      "The original source manifest (digests + URLs) remains authoritative",
      "Session state is not affected by the corrupted download",
    ],
    [
      "The corrupted download is discarded",
    ],
    [
      "Download is retried from an alternative mirror listed in the manifest",
    ],
    [
      "Previously verified source packages are preserved",
    ],
    ["None"],
    "Verify the manifest digest list is current. If the mirror list is exhausted, request the publisher to re-upload.",
    "Content hash mismatch detected. Downloaded payload discarded. Alternative mirror fetch initiated. Manifest unchanged.",
    null,
  )
}

// ── Resource: pglite Restart -------------------------------------------------

export function simulatePgliteRestart(): DrillResult {
  return result(
    "pglite_restart",
    true,
    [
      "All persisted tables (grants, memberships, leases) survive via WAL recovery",
      "Session identity and cryptographic key material remain authoritative",
    ],
    [
      "In-memory query cursors and uncommitted transactions are lost",
    ],
    [
      "Session state is re-established from persisted tables",
      "In-memory caches (capability lookups, lease routing) are rebuilt",
    ],
    [
      "All committed data in pglite tables is preserved",
      "External KV store state is preserved",
    ],
    ["None"],
    "Verify WAL recovery completed. Rebuild in-memory caches by scanning persisted session tables. Confirm lease state consistency.",
    "pglite WAL recovery log confirmed. Lease table integrity check passed. Capability cache rebuilt.",
    "Transient restart — in-memory state lost but durable tables survived.",
  )
}

// ── Resource: Valkey Loss ----------------------------------------------------

export function simulateValkeyLoss(): DrillResult {
  return result(
    "valkey_loss",
    true,
    [
      "Primary store (pglite / PostgreSQL) session data remains authoritative",
      "Persisted lease records, grant chains, and membership state survive",
    ],
    [
      "Cached capability decisions must be re-evaluated from the primary store",
    ],
    [
      "Cache entries are rebuilt on demand from the primary store as requests arrive",
    ],
    [
      "All data in the primary durable store is preserved",
    ],
    ["None"],
    "Flush the local Valkey cache on reconnect. Do not restore from expired snapshots — rebuild from the primary store to avoid serving stale data.",
    "Valkey connection lost. Cache declared invalid. On-demand rebuild from primary store active. No data loss in primary.",
    "Cache loss — performance may degrade until cache is repopulated.",
  )
}
