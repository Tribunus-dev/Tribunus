/**
 * Prism KV Handoff Protocol Simulation — State Machine
 */

import type { HandoffState, HandoffAction } from "./handoff-types"

/**
 * Maps each state to the set of states reachable via a single valid action.
 */
export const VALID_HANDOFF_TRANSITIONS: Record<HandoffState, readonly HandoffState[]> = {
  // ── Active intermediate states ──────────────────────────────────────────
  draft:                              ["requested"],
  requested:                          ["source_validating", "rejected", "failed"],
  source_validating:                  ["destination_validating", "rejected", "failed"],
  destination_validating:             ["export_preparing", "rejected", "failed"],
  export_preparing:                   ["exported", "cancelled", "failed"],
  exported:                           ["transferring", "cancelled", "expired", "failed"],
  transferring:                       ["importing", "cancelled", "timeout", "failed"],
  importing:                          ["destination_validated", "cancelled", "timeout", "failed"],
  destination_validated:              ["committed", "rollback_required"],
  committed:                          ["source_disposition_pending", "failed"],
  source_disposition_pending:         ["completed", "degraded_completed"],
  rollback_required:                  ["rolled_back", "cancelled", "failed"],

  // ── Terminal / absorbing states ─────────────────────────────────────────
  completed:          [],
  degraded_completed: [],
  rejected:           [],
  cancelled:          [],
  timeout:            [],
  expired:            [],
  failed:             [],
  rolled_back:        [],
}

// ── Action → State map (happy-path vs. branching outcomes) ────────────────

type TransitionMap = Partial<Record<HandoffAction, HandoffState>>

const HAPPY_PATH: TransitionMap = {
  request:                 "requested",
  validate_source:         "source_validating",
  validate_destination:    "destination_validating",
  prepare_export:          "export_preparing",
  export:                  "exported",
  transfer:                "transferring",
  import:                  "importing",
  validate_destination_import: "destination_validated",
  commit:                  "committed",
  dispose_source:          "source_disposition_pending",
  complete:                "completed",
}

/**
 * Applies an action to the current handoff state and returns the resulting state.
 *
 * - Actions that unambiguously advance the handoff (`request`, `export`, …)
 *   follow the happy path.
 * - Branching actions (`reject`, `cancel`, `expire`, `timeout`, `fail`,
 *   `rollback`) lead to their respective outcome states.
 *
 * @throws if the action is not valid from the current state.
 */
export function applyHandoffAction(
  current: HandoffState,
  action: HandoffAction,
): HandoffState {
  // Happy-path actions
  if (action in HAPPY_PATH) {
    const next = HAPPY_PATH[action]!
    if (
      VALID_HANDOFF_TRANSITIONS[current]?.includes(next) === true
    ) {
      return next
    }
  }

  // Branching actions
  const branchingActionMap: Partial<Record<HandoffAction, HandoffState>> = {
    reject:   "rejected",
    cancel:   "cancelled",
    expire:   "expired",
    timeout:  "timeout",
    fail:     "failed",
    rollback: current === "rollback_required" ? "rolled_back" : "rollback_required",
  }

  if (action in branchingActionMap) {
    const next = branchingActionMap[action]!
    if (
      VALID_HANDOFF_TRANSITIONS[current]?.includes(next) === true
    ) {
      return next
    }
  }

  throw new Error(
    `Invalid transition: action "${action}" is not valid from state "${current}"`,
  )
}

/**
 * Returns true when the state is terminal (absorbing — no further transitions).
 */
export function isTerminalHandoffState(state: HandoffState): boolean {
  return VALID_HANDOFF_TRANSITIONS[state].length === 0
}

/**
 * Returns true for negative terminal states (not success).
 *
 * - "completed" and "degraded_completed" are considered non-failing terminal
 *   states; everything else that is terminal (rejected, cancelled, timeout,
 *   expired, failed, rolled_back) is considered failed.
 * - Non-terminal states return false.
 */
export function isFailedState(state: HandoffState): boolean {
  if (!isTerminalHandoffState(state)) return false
  return state !== "completed" && state !== "degraded_completed"
}

/**
 * Returns true when the handoff can still be cancelled from this state.
 *
 * Cancellation is permitted from any state that lists "cancelled" among its
 * valid transitions.
 */
export function canCancel(state: HandoffState): boolean {
  return VALID_HANDOFF_TRANSITIONS[state]?.includes("cancelled") === true
}
