/**
 * Prism KV Handoff Metrics — named metric list and snapshot utilities
 */

import { HANDOFF_METRICS } from "./handoff-types"

/**
 * Returns the canonical metric names for the KV handoff subsystem.
 */
export function getHandoffMetricNames(): string[] {
  return [...HANDOFF_METRICS]
}

/**
 * Builds a plain metric snapshot from the given counters.
 */
export function createHandoffMetricsSnapshot(
  requests: number,
  inflight: number,
  completed: number,
  failed: number,
  bytes: number,
): Record<string, number> {
  return {
    prism_kv_handoff_requests_total: requests,
    prism_kv_handoff_inflight: inflight,
    prism_kv_handoff_completed_total: completed,
    prism_kv_handoff_failed_total: failed,
    prism_kv_handoff_bytes: bytes,
  }
}
