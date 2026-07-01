/**
 * Dharma Session Authority — Session Lifecycle State Machine
 *
 * Implements the session lifecycle from the specification:
 * draft → materializing → ready → active → draining → sealed → exported → archived
 * draft → cancelled, materializing → failed, active → suspended → active, active → terminated
 */

import type { SessionLifecycleState } from "./types"
import { InvalidStateTransitionError } from "./session-errors"

export type SessionAction =
  | "request_materialize"
  | "materialize_success"
  | "materialize_fail"
  | "activate"
  | "suspend"
  | "resume"
  | "drain"
  | "seal"
  | "export"
  | "archive"
  | "cancel"
  | "terminate"

/**
 * Valid session lifecycle transitions.
 * From spec: draft → materializing → ready → active → draining → sealed → exported → archived
 */
export const VALID_SESSION_TRANSITIONS: Record<SessionLifecycleState, readonly SessionLifecycleState[]> = {
  draft: ["materializing", "cancelled"],
  materializing: ["ready", "failed"],
  ready: ["active", "cancelled"],
  active: ["draining", "suspended", "terminated"],
  suspended: ["active"],
  draining: ["sealed", "terminated"],
  sealed: ["exported"],
  exported: ["archived"],
  archived: [],
  cancelled: [],
  failed: [],
  terminated: [],
}

/**
 * Map session actions to resulting lifecycle states.
 */
export const SESSION_ACTION_MAP: Record<SessionLifecycleState, Partial<Record<SessionAction, SessionLifecycleState>>> = {
  draft: { request_materialize: "materializing", cancel: "cancelled" },
  materializing: { materialize_success: "ready", materialize_fail: "failed" },
  ready: { activate: "active", cancel: "cancelled" },
  active: { drain: "draining", suspend: "suspended", terminate: "terminated" },
  suspended: { resume: "active" },
  draining: { seal: "sealed", terminate: "terminated" },
  sealed: { export: "exported" },
  exported: { archive: "archived" },
  archived: {},
  cancelled: {},
  failed: {},
  terminated: {},
}

/** Check if a transition between two states is valid. */
export function isValidTransition(current: SessionLifecycleState, next: SessionLifecycleState): boolean {
  return VALID_SESSION_TRANSITIONS[current].includes(next)
}

/** Compute the next state given current state and action. */
export function applyAction(current: SessionLifecycleState, action: SessionAction): SessionLifecycleState {
  const targets = SESSION_ACTION_MAP[current]
  if (!targets) throw new InvalidStateTransitionError(current, `action:${action}`)
  const next = targets[action]
  if (!next) throw new InvalidStateTransitionError(current, `action:${action}`)
  return next
}

/** Check if a session state is terminal (no further transitions allowed). */
export function isTerminalState(state: SessionLifecycleState): boolean {
  return ["sealed", "exported", "archived", "cancelled", "failed", "terminated"].includes(state)
}

/** Check if a session state allows collaboration activity. */
export function isCollaborativeState(state: SessionLifecycleState): boolean {
  return ["active", "draining", "suspended"].includes(state)
}

/** Check if a session state allows workspace mutation. */
export function isMutableState(state: SessionLifecycleState): boolean {
  return ["active", "draining"].includes(state)
}

/** Check if a session state allows new command requests. */
export function acceptsCommands(state: SessionLifecycleState): boolean {
  return ["active"].includes(state)
}

/** Check if a session state allows compute activity. */
export function allowsCompute(state: SessionLifecycleState): boolean {
  return ["active", "draining"].includes(state)
}
