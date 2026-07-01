/**
 * Dharma Live Sandbox — Restart Recovery
 *
 * Handles recovery of live sandbox sessions after process restarts.
 * Tracks pending recovery operations (materialization, process cleanup,
 * patch application, seal) and provides state-machine transitions for
 * recovery lifecycle: pending → resolved | failed.
 */

import { randomUUID } from "node:crypto"
import type { RecoveryState } from "./live-types"
import { RecoveryError } from "./live-errors"

// ── Valid Recovery Transitions ----------------------------------------------

/**
 * Valid state transitions for recovery records.
 * Maps current state → allowed next states.
 */
export const VALID_RECOVERY_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["resolved", "failed"] as const,
  resolved: [] as const,
  failed: ["pending"] as const,
}

// ── Recovery State Factory --------------------------------------------------

/**
 * Create a recovery record.
 *
 * Records that a session needs to perform a recovery operation
 * of the given kind after a restart or failure.
 *
 * @param sessionId - The session requiring recovery
 * @param kind - The type of recovery needed
 * @returns A new RecoveryState in "pending" state
 */
export function createRecoveryState(
  sessionId: string,
  kind: string,
): RecoveryState {
  const validKinds = ["materialization", "process_cleanup", "patch_application", "seal"]
  if (!validKinds.includes(kind)) {
    throw new RecoveryError(`Invalid recovery kind: "${kind}". Must be one of ${validKinds.join(", ")}`)
  }

  return {
    recoveryId: randomUUID(),
    sessionId,
    recoveryKind: kind as RecoveryState["recoveryKind"],
    state: "pending",
    detail: null,
    lastVerifiedDigest: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  }
}

// ── State Transitions -------------------------------------------------------

/**
 * Mark recovery as resolved.
 *
 * Transitions the recovery state from "pending" to "resolved".
 * Throws if the current state does not allow this transition.
 *
 * @param state - The current recovery state
 * @returns A new RecoveryState with state="resolved"
 * @throws RecoveryError if transition is invalid
 */
export function markRecoveryResolved(state: RecoveryState): RecoveryState {
  if (state.state !== "pending") {
    throw new RecoveryError(
      `Cannot resolve recovery in state "${state.state}": expected "pending"`,
    )
  }

  return {
    ...state,
    state: "resolved",
    resolvedAt: new Date().toISOString(),
  }
}

// ── Recovery Checks ---------------------------------------------------------

/**
 * Check if recovery is needed after restart.
 *
 * Returns true if any of the provided recovery states are still
 * in a non-resolved state (pending or failed).
 *
 * @param states - Array of recovery states to check
 * @returns true if any state requires recovery action
 */
export function isRecoveryNeeded(states: RecoveryState[]): boolean {
  return states.some((s) => s.state === "pending" || s.state === "failed")
}

// ── Summary -----------------------------------------------------------------

/**
 * Get a human-readable recovery summary for logging.
 *
 * @param states - Array of recovery states to summarize
 * @returns A formatted string showing recovery status by kind
 */
export function getRecoverySummary(states: RecoveryState[]): string {
  if (states.length === 0) {
    return "No recovery states recorded"
  }

  const byKind = new Map<string, RecoveryState[]>()
  for (const state of states) {
    const existing = byKind.get(state.recoveryKind) ?? []
    existing.push(state)
    byKind.set(state.recoveryKind, existing)
  }

  const lines: string[] = []
  for (const [kind, kindStates] of byKind) {
    const counts = kindStates.reduce(
      (acc, s) => {
        acc[s.state] = (acc[s.state] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
    const summary = Object.entries(counts)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ")
    lines.push(`  ${kind}: ${summary}`)
  }

  return `Recovery summary for ${states.length} state(s):\n${lines.join("\n")}`
}
