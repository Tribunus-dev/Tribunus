/**
 * Phase-specific KV events — extends generic KV events with prefill/decode
 * phase attribution and decode attach validation.
 */

import { ForeignKvError } from "./phase-role-errors"
import type { PhaseCoLocationPolicy } from "./phase-role-types"

/**
 * Create a KV event record annotated with the originating phase.
 */
export function createPhaseKvEvent(
  workerId: string,
  instanceId: string,
  modelDigest: string,
  prefixDigest: string,
  nsId: string,
  phase: string,
  state: string,
): Record<string, unknown> {
  return {
    eventId: `${workerId}:${instanceId}:${prefixDigest}:${phase}:${Date.now()}`,
    eventVersion: 2,
    workerId,
    workerInstanceId: instanceId,
    modelArtifactDigest: modelDigest,
    prefixDigest,
    kvNamespaceId: `${nsId}::${prefixDigest}`,
    phase,
    state,
    emittedAt: new Date().toISOString(),
  }
}

/**
 * Extract the phase from a KV event record.
 * Returns null when the record has no phase field or it is not a string.
 */
export function getKvEventPhase(event: Record<string, unknown>): string | null {
  const p = event.phase
  return typeof p === "string" && p.length > 0 ? p : null
}

/**
 * Determine whether a decode worker may attach to a KV namespace based on
 * the phase that produced the event and the co-location policy.
 *
 * - "same_worker_required": decode may ONLY attach when the event came from
 *   a prefill phase (i.e. the same worker produced the KV during prefill).
 * - "future_transfer_capable": decode may attach regardless of source phase.
 * - "not_supported": decode may never attach.
 */
export function canDecodeAttach(eventPhase: string, coLocation: string): boolean {
  if (coLocation === "same_worker_required") {
    return eventPhase === "prefill"
  }
  if (coLocation === "future_transfer_capable") {
    return true
  }
  // "not_supported" or unrecognised
  return false
}
