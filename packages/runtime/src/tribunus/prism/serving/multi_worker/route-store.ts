/**
 * Prism Multi-Worker Router — Route Record Tracking
 *
 * Pure functions for creating and managing route records that track
 * worker selection decisions, retries, and outcomes.
 */

import type { RouteRecord, RouteOutcome } from "./router-types"

let routeIdCounter = 0

/**
 * Create a new route record for a request-to-worker mapping.
 */
export function createRouteRecord(
  requestId: string,
  selectedWorkerId: string,
  candidates: string[],
): RouteRecord {
  routeIdCounter++
  const now = new Date().toISOString()
  return {
    routeId: `route_${routeIdCounter}`,
    requestId,
    selectedWorkerId,
    candidateWorkerIds: candidates,
    selectionReason: "",
    prefixAffinitySummary: "",
    loadSummary: "",
    retryCount: 0,
    traceContext: null,
    createdAt: now,
    completedAt: null,
    outcome: "retried",
  }
}

/**
 * Mark a route record as completed with the given outcome.
 * Returns a new record (immutable pattern).
 */
export function completeRouteRecord(
  record: RouteRecord,
  outcome: RouteOutcome,
): RouteRecord {
  return {
    ...record,
    outcome,
    completedAt: new Date().toISOString(),
  }
}

/**
 * Increment the retry count and reset the outcome to "retried".
 * Returns a new record.
 */
export function addRetry(record: RouteRecord): RouteRecord {
  return {
    ...record,
    retryCount: record.retryCount + 1,
    outcome: "retried",
    completedAt: null,
  }
}

/**
 * Produce a compact human-readable summary of route records.
 */
export function getRouteSummary(records: RouteRecord[]): string {
  const total = records.length
  const completed = records.filter((r) => r.outcome === "completed").length
  const failed = records.filter((r) => r.outcome === "failed").length
  const retried = records.filter((r) => r.outcome === "retried").length
  const cancelled = records.filter((r) => r.outcome === "cancelled").length
  const totalRetries = records.reduce((sum, r) => sum + r.retryCount, 0)
  return (
    `routes=${total} completed=${completed} failed=${failed} ` +
    `retried=${retried} cancelled=${cancelled} total_retries=${totalRetries}`
  )
}
