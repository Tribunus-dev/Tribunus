/**
 * Prism llm-d Worker — In-Flight Request Store
 *
 * Pure state-transition functions for request execution lifecycle.
 * Each function returns a new PrismRequestExecution with updated state.
 */

import type { PrismRequestExecution } from "./worker-types"

// ── Factory ----------------------------------------------------------------

/**
 * Create a new execution entry in the initial pending state.
 */
export function createExecution(
  executionId: string,
  requestId: string,
  modelDigest: string,
): PrismRequestExecution {
  const now = new Date().toISOString()
  return {
    executionId,
    requestId,
    modelArtifactDigest: modelDigest,
    computeImageDigest: "",
    targetCapabilitySignature: "",
    prefillState: "pending",
    decodeState: "pending",
    kvNamespaceId: null,
    admissionTime: now,
    startedAt: now,
    completedAt: null,
  }
}

// ── State transitions ------------------------------------------------------

/**
 * Transition execution from pending → running (prefill starts).
 */
export function startExecution(exec: PrismRequestExecution): PrismRequestExecution {
  const now = new Date().toISOString()
  return {
    ...exec,
    prefillState: "running",
    decodeState: "pending",
    startedAt: now,
  }
}

/**
 * Transition execution to completed.
 */
export function completeExecution(exec: PrismRequestExecution): PrismRequestExecution {
  return {
    ...exec,
    prefillState: "completed",
    decodeState: "completed",
    completedAt: new Date().toISOString(),
  }
}

/**
 * Transition execution to failed.
 */
export function failExecution(exec: PrismRequestExecution): PrismRequestExecution {
  return {
    ...exec,
    prefillState: exec.prefillState === "completed" ? exec.prefillState : "failed",
    decodeState: "failed",
    completedAt: new Date().toISOString(),
  }
}

/**
 * Transition execution to cancelled.
 */
export function cancelExecution(exec: PrismRequestExecution): PrismRequestExecution {
  return {
    ...exec,
    prefillState: "cancelled",
    decodeState: "cancelled",
    completedAt: new Date().toISOString(),
  }
}

// ── Queries ----------------------------------------------------------------

/**
 * Count executions that are still active (not completed, failed, or cancelled).
 */
export function getActiveExecutionCount(executions: PrismRequestExecution[]): number {
  return executions.filter((e) => {
    const ds = e.decodeState
    return ds !== "completed" && ds !== "failed" && ds !== "cancelled"
  }).length
}

/**
 * Return all executions (in any state) associated with a requestId.
 */
export function getExecutionsForRequest(
  requestId: string,
  executions: PrismRequestExecution[],
): PrismRequestExecution[] {
  return executions.filter((e) => e.requestId === requestId)
}
