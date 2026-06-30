/**
 * Dharma Replication — Transport Lifecycle State Machine
 *
 * Defines valid state transitions for the swarm lifecycle and provides
 * a deterministic action-to-state mapper plus exponential backoff.
 *
 * @module
 */

import type { SwarmLifecycleState } from "./protocol"

// ── Transition Table ----------------------------------------------------------

/**
 * Valid transitions for each swarm lifecycle state.
 * Every key maps to the reachable next-states.
 */
export const VALID_SWARM_TRANSITIONS: Record<
  SwarmLifecycleState,
  readonly SwarmLifecycleState[]
> = {
  stopped: ["starting"],
  starting: ["joining"],
  joining: ["connected"],
  connected: ["degraded", "paused", "stopping"],
  degraded: ["connected", "stopping"],
  paused: ["connected", "stopping"],
  stopping: ["stopped"],
}

/** Check whether a transition from `current` to `next` is valid. */
export function isValidSwarmTransition(
  current: SwarmLifecycleState,
  next: SwarmLifecycleState,
): boolean {
  const allowed = VALID_SWARM_TRANSITIONS[current]
  return allowed ? allowed.includes(next) : false
}

// ── Action → State Mapper -----------------------------------------------------

export type SwarmAction =
  | "start"
  | "join_complete"
  | "connection_change"
  | "degrade"
  | "recover"
  | "pause"
  | "resume"
  | "stop"
  | "stop_complete"
  | "error"

/**
 * Compute the next swarm lifecycle state given the current state and an action.
 *
 * Returns the current state if the action is not applicable — caller should
 * check `isValidSwarmTransition` if they want to reject illegal moves.
 */
export function nextSwarmState(
  current: SwarmLifecycleState,
  action: SwarmAction,
): SwarmLifecycleState {
  switch (current) {
    case "stopped":
      if (action === "start") return "starting"
      return current

    case "starting":
      if (action === "join_complete") return "joining"
      return current

    case "joining":
      if (action === "connection_change") return "connected"
      return current

    case "connected":
      if (action === "degrade") return "degraded"
      if (action === "pause") return "paused"
      if (action === "stop") return "stopping"
      return current

    case "degraded":
      if (action === "recover") return "connected"
      if (action === "stop") return "stopping"
      return current

    case "paused":
      if (action === "resume") return "connected"
      if (action === "stop") return "stopping"
      return current

    case "stopping":
      if (action === "stop_complete") return "stopped"
      return current
  }
}

// ── Exponential Backoff -------------------------------------------------------

/**
 * Calculate exponential backoff with jitter.
 *
 * `attempt` is 0-based (first attempt → baseMs, with jitter).
 * The result is clamped to maxMs.
 */
export function calculateBackoff(
  attempt: number,
  baseMs: number = 1_000,
  maxMs: number = 60_000,
): number {
  const exponent = Math.min(attempt, 31) // prevent overflow
  const raw = baseMs * Math.pow(2, exponent)
  const clamped = Math.min(raw, maxMs)
  const halfJitter = clamped / 2
  // Full jitter: random in [0, clamped]
  return Math.floor(Math.random() * clamped + halfJitter * 0.5)
}
