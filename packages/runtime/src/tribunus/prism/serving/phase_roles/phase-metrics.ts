/**
 * Phase metrics — per-phase capacity and utilisation snapshots.
 */

const PHASE_METRIC_NAMES = [
  "prefill_active_operations",
  "prefill_maximum_operations",
  "decode_active_operations",
  "decode_maximum_operations",
  "decode_active_kv_namespaces",
] as const

/**
 * Return the canonical list of phase metric names.
 */
export function getPhaseMetricNames(): string[] {
  return [...PHASE_METRIC_NAMES]
}

/**
 * Create a phase metrics snapshot from per-phase capacity values.
 */
export function createPhaseMetricsSnapshot(
  prefillActive: number,
  prefillMax: number,
  decodeActive: number,
  decodeMax: number,
  decodeKv: number,
): Record<string, number> {
  return {
    prefill_active_operations: prefillActive,
    prefill_maximum_operations: prefillMax,
    decode_active_operations: decodeActive,
    decode_maximum_operations: decodeMax,
    decode_active_kv_namespaces: decodeKv,
  }
}
