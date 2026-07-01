/**
 * Dharma OS-Enforced Sandbox — Containment Recovery
 *
 * Recovery state management for containment failures. Tracks the
 * state of a failed containment and provides decision helpers for
 * whether (a) recovery can proceed or (b) the session must terminate.
 */

import type { ContainmentViolation } from "./containment-types"

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContainmentRecoveryState {
  /** Execution ID of the contained process that failed. */
  executionId: string
  /** Session ID that owns the contained process. */
  sessionId: string
  /** Whether the containment backend itself experienced a failure. */
  backendFailed: boolean
  /** Violations recorded during containment. */
  violations: ContainmentViolation[]
  /** Whether the process tree was successfully terminated. */
  processTreeTerminated: boolean
  /** Whether mutable state (overlays, temp dirs) has been cleaned. */
  mutableStateCleaned: boolean
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a recovery state after containment failure.
 *
 * @param executionId - The execution ID of the failed process.
 * @param sessionId - The session that owns the process.
 * @param error - A description of the failure.
 * @returns A new ContainmentRecoveryState.
 */
export function createRecoveryState(
  executionId: string,
  sessionId: string,
  error: string,
): ContainmentRecoveryState {
  const isBackendRelated = /backend|unavailable|capability/i.test(error)

  return {
    executionId,
    sessionId,
    backendFailed: isBackendRelated,
    violations: [
      {
        violationId: `recovery-${executionId}`,
        executionId,
        sessionId,
        timestamp: new Date().toISOString(),
        kind: "syscall_denied",
        severity: isBackendRelated ? "critical" : "warning",
        details: error,
      },
    ],
    processTreeTerminated: false,
    mutableStateCleaned: false,
  }
}

// ── Query Helpers ──────────────────────────────────────────────────────────

/**
 * Check if recovery can proceed.
 *
 * Recovery is possible when:
 * - The backend is functional (no backend failure)
 * - OR the process tree has been successfully terminated
 * - AND no critical violations remain unresolved
 *
 * @param state - The current recovery state.
 * @returns true if recovery can proceed.
 */
export function canRecover(state: ContainmentRecoveryState): boolean {
  if (state.backendFailed && !state.processTreeTerminated) {
    return false
  }

  return !state.violations.some(v => v.severity === "critical")
}

/**
 * Determine if the session should be terminated after a containment failure.
 *
 * Session termination is required when:
 * - The backend is permanently unavailable
 * - There are critical-severity violations (filesystem escape, secret access)
 * - The process tree could not be terminated
 *
 * @param state - The current recovery state.
 * @returns true if the session must be terminated.
 */
export function requiresSessionTermination(state: ContainmentRecoveryState): boolean {
  if (state.backendFailed && !state.processTreeTerminated) {
    return true
  }

  if (state.violations.some(v => v.severity === "critical") && !state.processTreeTerminated) {
    return true
  }

  if (!state.processTreeTerminated) {
    return true
  }

  return false
}
