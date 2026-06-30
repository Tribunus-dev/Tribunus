/**
 * Prism Prefill/Decode Role Separation — Phase Lifecycle
 *
 * Prefill→decode phase state machine for same-worker execution.
 *
 * A single worker cycles through:
 *   prefill: pending → running → completed
 *   decode:  pending → running → completed
 *
 * Failure classification maps runtime errors and cancellations to
 * structured {@link PhaseFailureClass} values.
 */

import type { PhaseLifecycleState, PhaseFailureClass } from "./phase-role-types"

// ── Lifecycle Construction -------------------------------------------------

export function createPhaseLifecycle(
  executionId: string,
  requestId: string,
  workerId: string,
): PhaseLifecycleState {
  return {
    executionId,
    requestId,
    prefillState: "pending",
    decodeState: "pending",
    kvNamespaceId: null,
    prefillWorkerId: workerId,
    decodeWorkerId: workerId,
    prefillCompletedAt: null,
    decodeStartedAt: null,
  }
}

// ── Prefill Transitions ----------------------------------------------------

export function transitionPrefill(
  state: PhaseLifecycleState,
  newState: string,
): PhaseLifecycleState {
  let kvNamespaceId = state.kvNamespaceId
  let prefillCompletedAt = state.prefillCompletedAt
  if (newState === "completed") {
    prefillCompletedAt = new Date().toISOString()
  }
  return {
    ...state,
    prefillState: newState,
    kvNamespaceId,
    prefillCompletedAt,
  }
}

// ── Decode Transitions -----------------------------------------------------

export function transitionDecode(
  state: PhaseLifecycleState,
  newState: string,
): PhaseLifecycleState {
  let decodeStartedAt = state.decodeStartedAt
  if (newState === "running" && state.decodeState === "pending") {
    decodeStartedAt = new Date().toISOString()
  }
  return {
    ...state,
    decodeState: newState,
    decodeStartedAt,
  }
}

// ── Completion Queries -----------------------------------------------------

export function isPrefillComplete(state: PhaseLifecycleState): boolean {
  return state.prefillState === "completed"
}

export function isDecodeComplete(state: PhaseLifecycleState): boolean {
  return state.decodeState === "completed"
}

// ── Failure Classification -------------------------------------------------

/**
 * Map a stage + reason to a structured failure class.
 *
 * Heuristic matching: the `reason` string is checked for known keywords.
 * - "timeout"                   → stage_timeout
 * - "budget", "quota", "limit"  → stage_budget_exceeded
 * - "cancel"                    → stage_cancelled
 * - decode stage: "kv", "namespace", "cache_miss" → decode_kv_invalid
 * - decode stage: "worker", "mismatch"            → decode_worker_mismatch
 * - default                     → stage_failed
 */
export function getFailureClass(
  state: PhaseLifecycleState,
  stage: "prefill" | "decode",
  reason: string,
): PhaseFailureClass {
  const lower = reason.toLowerCase()

  if (lower.includes("timeout")) {
    return stage === "prefill" ? "prefill_timeout" : "decode_timeout"
  }
  if (lower.includes("budget") || lower.includes("quota") || lower.includes("limit")) {
    return stage === "prefill" ? "prefill_budget_exceeded" : "decode_budget_exceeded"
  }
  if (lower.includes("cancel")) {
    return stage === "prefill" ? "prefill_cancelled" : "decode_cancelled"
  }
  if (stage === "decode") {
    if (lower.includes("kv") || lower.includes("namespace") || lower.includes("cache_miss")) {
      return "decode_kv_invalid"
    }
    if (lower.includes("worker") || lower.includes("mismatch")) {
      return "decode_worker_mismatch"
    }
  }
  return stage === "prefill" ? "prefill_failed" : "decode_failed"
}
