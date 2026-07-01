/**
 * Prism Heterogeneous Memory Fabric — Metric Helpers
 *
 * Utility functions for working with the standard Prism fabric metric names
 * and constructing Prometheus-compatible label sets.
 */

import { FABRIC_METRICS } from "./fabric-types"

/**
 * Return the full list of standard Prism fabric metric names.
 */
export function getFabricMetricNames(): string[] {
  return [...FABRIC_METRICS]
}

/**
 * Create a set of Prometheus-compatible labels for a fabric metric.
 *
 * @param deviceClass  — e.g. "cpu", "integrated_gpu", "discrete_gpu", "npu"
 * @param transportKind — e.g. "direct_shared_access", "pinned_host_copy"
 * @param outcome      — e.g. "success", "failure", "timeout"
 */
export function createFabricMetricLabels(
  deviceClass: string,
  transportKind: string,
  outcome: string,
): Record<string, string> {
  return {
    device_class: deviceClass,
    transport_kind: transportKind,
    outcome: outcome,
  }
}
