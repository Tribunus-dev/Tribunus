/**
 * Prism KV Handoff — Rollback Protocol
 *
 * Pure functions for determining when and how to roll back a handoff.
 * The actual side-effect coordination lives in HandoffCoordinator.
 */

import type { HandoffState } from "./handoff-types"

// ── Terminal / non-recoverable failure states ───────────────────────────────

const TERMINAL_FAILURE_STATES: Partial<Record<HandoffState, true>> = {
  failed: true,
  rejected: true,
  cancelled: true,
  timeout: true,
}

const ALREADY_ROLLED_BACK: Partial<Record<HandoffState, true>> = {
  rolled_back: true,
  completed: true,
  degraded_completed: true,
}

// ── Get Rollback Target State ───────────────────────────────────────────────

/**
 * Determine the rollback target state from the current handoff state.
 *
 * - Already-rolled or completed states stay "rolled_back".
 * - Terminal failures always map to "rolled_back".
 * - Active mid-flight states also map to "rolled_back" — any partial
 *   progress must be unwound.
 */
export function getRollbackState(current: HandoffState): HandoffState {
  if (ALREADY_ROLLED_BACK[current]) {
    return "rolled_back"
  }
  // Everything else rolls back
  return "rolled_back"
}

// ── Should Rollback ─────────────────────────────────────────────────────────

/**
 * Returns true when the current state indicates a rollback is needed.
 * A handoff in a terminal failure state or a mid-flight state after a
 * critical error should be rolled back.
 *
 * Already-terminated states (completed, rolled_back, degraded_completed)
 * do NOT require a rollback.
 */
export function shouldRollback(state: HandoffState): boolean {
  if (ALREADY_ROLLED_BACK[state]) {
    return false
  }
  if (TERMINAL_FAILURE_STATES[state]) {
    return true
  }
  // Mid-flight states that may need cleanup after an unrecoverable error
  return [
    "export_preparing",
    "exported",
    "transferring",
    "importing",
    "source_disposition_pending",
  ].includes(state)
}

// ── Classify Rollback Reason ────────────────────────────────────────────────

/**
 * Produce a human-readable explanation of why a rollback occurred,
 * derived from the handoff state at the time the decision was made.
 */
export function classifyRollbackReason(state: HandoffState): string {
  switch (state) {
    case "failed":
      return "handoff failed — unrecoverable error during processing"
    case "rejected":
      return "handoff rejected — eligibility or compatibility check failed"
    case "cancelled":
      return "handoff cancelled — request withdrawn or lease revoked"
    case "timeout":
      return "handoff timed out — deadline exceeded before completion"
    case "export_preparing":
    case "exported":
      return "source export failed — rolling back export preparation"
    case "transferring":
      return "transfer interrupted — payload not fully delivered"
    case "importing":
      return "destination import failed — rolling back partial import"
    case "source_disposition_pending":
      return "source disposition unresolvable — rolling back"
    case "rolled_back":
    case "completed":
    case "degraded_completed":
      return "no rollback needed — handoff already terminated"
    default:
      return `unknown state "${state}" mapped to rollback`
  }
}
