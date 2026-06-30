/**
 * Prism KV Handoff — Source Disposition (Retention Policy Resolution)
 *
 * Pure functions governing what happens to the source (prefill) worker's KV
 * cache after a handoff completes, fails, or is rolled back.
 */

import type {
  SourceDispositionRecord,
  SourceDispositionState,
  SourceRetentionPolicy,
} from "./handoff-types"

// ── Factory ─────────────────────────────────────────────────────────────────

export function createDispositionRecord(
  handoffId: string,
  sourceWorkerId: string,
  nsId: string,
  policy: SourceRetentionPolicy,
): SourceDispositionRecord {
  return {
    handoffId,
    sourceWorkerId,
    sourceWorkerInstanceId: "",
    sourceKvNamespaceId: nsId,
    policy,
    state: "pending",
    deadlineAt: policy.startsWith("retain_")
      ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
      : null,
    resolvedAt: null,
  }
}

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve the source disposition based on handoff outcome and policy.
 *
 * @param record        Current disposition record.
 * @param commitSuccess Whether the handoff commit phase succeeded.
 * @param decodeComplete Whether the decode worker finished its generation.
 * @returns Updated record with resolved state.
 */
export function resolveDisposition(
  record: SourceDispositionRecord,
  commitSuccess: boolean,
  decodeComplete: boolean,
): SourceDispositionRecord {
  if (record.state !== "pending") {
    return record // already resolved — idempotent
  }

  let newState: SourceDispositionState
  const now = new Date().toISOString()

  switch (record.policy) {
    case "retain_until_destination_commit":
      newState = commitSuccess ? "retained" : "pending"
      break
    case "retain_until_decode_completion":
      newState = decodeComplete ? "retained" : "pending"
      break
    case "release_after_destination_commit":
      newState = commitSuccess ? "released" : "pending"
      break
    case "invalidate_after_destination_commit":
      newState = commitSuccess ? "invalidated" : "pending"
      break
  }

  return {
    ...record,
    state: newState,
    resolvedAt: newState !== "pending" ? now : null,
  }
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function isDispositionResolved(
  record: SourceDispositionRecord,
): boolean {
  return record.state !== "pending"
}
