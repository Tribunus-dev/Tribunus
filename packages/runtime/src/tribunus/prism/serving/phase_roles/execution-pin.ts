/**
 * Prism Prefill/Decode Role Separation — Execution Pin
 *
 * Manages the lifecycle of an execution pin that binds a prefill→decode
 * sequence to a single worker instance. The pin tracks phases through
 * reservation, prefill, decode, and terminal states.
 *
 * Valid state transitions:
 *   reserved → prefill_running → prefill_completed → decode_running → completed
 *   Any state → cancelled | failed
 */

import type { PrismExecutionPin, ExecutionPinState } from "./phase-role-types"
import { ExecutionPinError } from "./phase-role-errors"

// ── State Machine Transitions ----------------------------------------------

export const VALID_PIN_TRANSITIONS: Record<ExecutionPinState, readonly ExecutionPinState[]> = {
  reserved: ["prefill_running", "cancelled", "failed"],
  prefill_running: ["prefill_completed", "cancelled", "failed"],
  prefill_completed: ["decode_running", "cancelled", "failed"],
  decode_running: ["completed", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
}

export type PinAction =
  | "start_prefill"
  | "complete_prefill"
  | "start_decode"
  | "complete"
  | "cancel"
  | "fail"

const PIN_ACTION_EFFECTS: Record<PinAction, (state: ExecutionPinState) => ExecutionPinState> = {
  start_prefill: () => "prefill_running",
  complete_prefill: () => "prefill_completed",
  start_decode: () => "decode_running",
  complete: () => "completed",
  cancel: () => "cancelled",
  fail: () => "failed",
}

/**
 * Attempt to advance a pin from its current state by applying an action.
 *
 * Throws {@link ExecutionPinError} if the transition is not permitted by
 * the state machine defined in {@link VALID_PIN_TRANSITIONS}.
 */
export function applyPinAction(state: ExecutionPinState, action: PinAction): ExecutionPinState {
  const next = PIN_ACTION_EFFECTS[action](state)
  const allowed = VALID_PIN_TRANSITIONS[state]
  if (!allowed.includes(next)) {
    throw new ExecutionPinError(
      `Invalid pin transition: ${state} → ${next} via action "${action}"`,
    )
  }
  return next
}

// ── Pin Construction -------------------------------------------------------

export function createExecutionPin(
  executionId: string,
  routeId: string,
  requestId: string,
  workerId: string,
  instanceId: string,
  modelDigest: string,
  computeDigest: string,
): PrismExecutionPin {
  const now = new Date().toISOString()
  return {
    executionId,
    routeId,
    requestId,
    workerId,
    workerInstanceId: instanceId,
    modelArtifactDigest: modelDigest,
    tokenizerDigest: "",
    computeImageDigest: computeDigest,
    kvNamespaceId: null,
    phaseCoLocationPolicy: "same_worker_required",
    issuedAt: now,
    expiresAt: null,
    state: "reserved",
  }
}

// ── Pin Queries ------------------------------------------------------------

/**
 * Whether the pin is in a non-terminal, actively-executing state.
 *
 * Active states: reserved, prefill_running, prefill_completed, decode_running.
 * Terminal states: completed, cancelled, failed — not active.
 */
export function isExecutionPinActive(pin: PrismExecutionPin): boolean {
  return (
    pin.state === "reserved" ||
    pin.state === "prefill_running" ||
    pin.state === "prefill_completed" ||
    pin.state === "decode_running"
  )
}

/**
 * Whether a given worker instance is the one bound to this execution pin.
 */
export function canWorkerExecutePin(
  pin: PrismExecutionPin,
  workerInstanceId: string,
): boolean {
  return pin.workerInstanceId === workerInstanceId
}
