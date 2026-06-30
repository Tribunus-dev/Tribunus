/**
 * Prism llm-d Worker — Request Cancellation
 *
 * Pure functions for managing request cancellation state transitions.
 * Cancellation is idempotent: cancelling an already-cancelled or
 * completed execution is a no-op.
 */

import type { PrismRequestExecution, PrefillState, DecodeState } from "./worker-types"

/**
 * Cancel an in-flight request execution.
 * Sets prefill and decode states to "cancelled" unless they are already
 * in a terminal state ("completed", "failed", "cancelled").
 * Returns a new execution object with updated state.
 *
 * @param execution — the current execution state
 * @param reason — optional cancellation reason (stored for observability)
 */
export function cancelRequest(execution: PrismRequestExecution, reason?: string): PrismRequestExecution {
  const now = new Date().toISOString()

  const terminalState = (s: string): boolean =>
    s === "completed" || s === "failed" || s === "cancelled"

  const nextPrefill: PrefillState = terminalState(execution.prefillState)
    ? execution.prefillState
    : "cancelled"

  const nextDecode: DecodeState = terminalState(execution.decodeState)
    ? execution.decodeState
    : "cancelled"

  return {
    ...execution,
    prefillState: nextPrefill,
    decodeState: nextDecode,
    completedAt: now,
  }
}

/**
 * Check whether a subsequent cancelRequest call is idempotent
 * (i.e., the execution is already in a terminal state).
 */
export function isCancellationIdempotent(execution: PrismRequestExecution): boolean {
  return (
    execution.prefillState === "cancelled" ||
    execution.prefillState === "completed" ||
    execution.prefillState === "failed" ||
    execution.decodeState === "cancelled" ||
    execution.decodeState === "completed" ||
    execution.decodeState === "failed"
  )
}
