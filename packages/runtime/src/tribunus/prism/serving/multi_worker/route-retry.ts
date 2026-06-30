/**
 * Prism Multi-Worker Router — Retry Logic
 *
 * Implements retry record creation, retry budget checks, and retry/fail/redirect
 * decision making for the multi-worker router.
 */

import type { RouteRecord } from "./router-types"
import { RouteRetryError } from "./router-errors"

/**
 * Create a new RouteRecord for a retry attempt on a different worker.
 * Inherits trace context and increments the retry counter.
 */
export function createRetryRecord(original: RouteRecord, newWorkerId: string): RouteRecord {
  return {
    ...original,
    routeId: `${original.routeId}-retry-${original.retryCount + 1}`,
    selectedWorkerId: newWorkerId,
    retryCount: original.retryCount + 1,
    outcome: "retried",
    createdAt: new Date().toISOString(),
    completedAt: null,
  }
}

/**
 * Check whether a retry is still within the allowed budget.
 */
export function isRetryAllowed(record: RouteRecord, maxRetries: number): boolean {
  return record.retryCount < maxRetries
}

/**
 * Get the retry decision for a route record based on retry budget, output
 * emission state, and request idempotency.
 *
 * Returns:
 *   - "retry"   → can and should retry on another worker
 *   - "fail"    → retry budget exhausted or non-idempotent post-output failure
 *   - "redirect" → no output yet but within budget; redirect to another worker
 */
export function getRetryDecision(
  record: RouteRecord,
  maxRetries: number,
  outputEmitted: boolean,
  idempotent: boolean,
): { action: "retry" | "fail" | "redirect"; reason: string } {
  if (!isRetryAllowed(record, maxRetries)) {
    return {
      action: "fail",
      reason: `Retry budget exhausted (retried ${record.retryCount}/${maxRetries} times)`,
    }
  }

  if (outputEmitted && !idempotent) {
    return {
      action: "fail",
      reason: "Output already emitted and request is non-idempotent; cannot retry safely",
    }
  }

  if (outputEmitted && idempotent) {
    return {
      action: "retry",
      reason: "Output emitted but request is idempotent; safe to retry",
    }
  }

  if (record.retryCount === 0) {
    return {
      action: "redirect",
      reason: "First attempt failed before output; redirect to another worker",
    }
  }

  return {
    action: "retry",
    reason: "Retry within budget and no output emitted",
  }
}
