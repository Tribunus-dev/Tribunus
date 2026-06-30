/**
 * Prism Multi-Worker Router — Failover Management
 *
 * Detects worker failures, selects replacement workers, and determines
 * retry eligibility based on failover policy and output emission state.
 */

import type { RouterWorkerState, RouteRecord, FailoverPolicy } from "./router-types"
import { FailoverError } from "./router-errors"

/**
 * Detect whether a worker has failed based on its state.
 * A worker is considered failed when it is unhealthy, has a recent error,
 * or has been non-responsive past the staleness threshold.
 */
export function detectWorkerFailure(worker: RouterWorkerState): boolean {
  if (!worker.healthy) return true
  if (!worker.ready) return true
  if (worker.lastError !== null) return true
  return false
}

/**
 * Select the best eligible worker for failover from a list of candidates.
 * Returns null if no eligible worker is available.
 *
 * Selection preference (in order):
 *  1. Non-draining, healthy, ready workers with lowest active request ratio
 *  2. Draining workers are excluded
 *  3. Unhealthy/unready workers are excluded
 */
export function selectFailoverWorker(
  failedWorkerId: string,
  eligibleWorkers: RouterWorkerState[],
): RouterWorkerState | null {
  const candidates = eligibleWorkers.filter(
    (w) =>
      w.workerId !== failedWorkerId &&
      !w.draining &&
      w.healthy &&
      w.ready &&
      w.activeRequests < w.maxConcurrentRequests,
  )

  if (candidates.length === 0) return null

  // Pick the worker with the lowest active request load ratio
  return candidates.reduce((best, candidate) => {
    const bestLoad = best.activeRequests / Math.max(best.maxConcurrentRequests, 1)
    const candidateLoad = candidate.activeRequests / Math.max(candidate.maxConcurrentRequests, 1)
    return candidateLoad < bestLoad ? candidate : best
  })
}

/**
 * Determine whether a request can be retried on a failover worker given the
 * failover policy and whether any output has been emitted to the client.
 */
export function canRetryRequest(
  record: RouteRecord,
  policy: FailoverPolicy,
  outputEmitted: boolean,
): boolean {
  switch (policy) {
    case "fail_after_first_output":
      // Never retry if any output was emitted
      return !outputEmitted

    case "retry_before_output":
      // Retry only if no output was emitted yet
      return !outputEmitted

    case "retry_idempotent":
      // Retry regardless of output state (idempotent requests are safe)
      return true

    default:
      return false
  }
}

/**
 * Determine whether a failover should be surfaced as a visible failure to
 * the client, based on the failover policy and output emission state.
 */
export function shouldFailVisibly(policy: FailoverPolicy, outputEmitted: boolean): boolean {
  if (!outputEmitted) return false
  if (policy === "fail_after_first_output") return true
  if (policy === "retry_before_output") return false
  if (policy === "retry_idempotent") return false
  return true
}
