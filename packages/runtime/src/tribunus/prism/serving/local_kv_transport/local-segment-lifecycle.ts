/**
 * Prism Local-Host KV Transport — 12-State Segment Lifecycle FSM
 *
 * Pure functions implementing the segment state machine with the transitions
 * defined in the transport specification.
 *
 * State space (11 + synthetic):
 *   allocated → writing → sealed → offered → mapped_by_destination
 *   → import_verified → acknowledged → released
 *   with fail/cancel/expire edges as detailed below.
 */

import type { SegmentState } from "./local-transport-types"

// ── Transition Table ────────────────────────────────────────────────────────

/**
 * Maps each `SegmentState` to the set of states it may legally transition to.
 *
 * ```
 * allocated                    → writing | failed
 * writing                     → sealed  | failed | cancelled
 * sealed                      → offered | expired | cancelled | failed
 * offered                     → mapped_by_destination | expired | cancelled | failed
 * mapped_by_destination       → import_verified | failed | cancelled
 * import_verified             → acknowledged | failed | cancelled
 * acknowledged                → released
 * released / failed / cancelled / expired  → (terminal — no outgoing)
 * ```
 */
export const VALID_SEGMENT_TRANSITIONS: Record<SegmentState, readonly SegmentState[]> = {
  allocated: ["writing", "failed"],
  writing: ["sealed", "failed", "cancelled"],
  sealed: ["offered", "expired", "cancelled", "failed"],
  offered: ["mapped_by_destination", "expired", "cancelled", "failed"],
  mapped_by_destination: ["import_verified", "failed", "cancelled"],
  import_verified: ["acknowledged", "failed", "cancelled"],
  acknowledged: ["released"],
  released: [],
  failed: [],
  cancelled: [],
  expired: [],
}

// ── Action Application ──────────────────────────────────────────────────────

/**
 * Applies an action string to a current segment state.
 *
 * The action is interpreted as a ***target state name***. If a transition from
 * `current` to that target exists in `VALID_SEGMENT_TRANSITIONS`, the target is
 * returned; otherwise `current` is returned unchanged (no-op).
 *
 * @example
 * ```ts
 * applySegmentAction("allocated", "writing")  // → "writing"
 * applySegmentAction("allocated", "sealed")    // → "allocated" (invalid)
 * ```
 */
export function applySegmentAction(current: SegmentState, action: string): SegmentState {
  const target = action as SegmentState
  const allowed = VALID_SEGMENT_TRANSITIONS[current]
  return (allowed as readonly string[]).includes(target) ? target : current
}

// ── Predicates ──────────────────────────────────────────────────────────────

/**
 * Returns `true` when the state has no outgoing transitions — i.e. it is a
 * terminal (absorbing) state in the FSM.
 */
export function isSegmentTerminal(state: SegmentState): boolean {
  return VALID_SEGMENT_TRANSITIONS[state].length === 0
}

/**
 * Returns `true` when the segment may transition to `"released"` — i.e. the
 * protocol has reached the `"acknowledged"` handshake point.
 */
export function canReleaseSegment(state: SegmentState): boolean {
  const allowed = VALID_SEGMENT_TRANSITIONS[state]
  return (allowed as readonly string[]).includes("released")
}
