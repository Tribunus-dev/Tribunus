/**
 * Prism KV Handoff Compatibility Report — factory and status update
 */

import type { LlmDKvHandoffCompatibilityReport } from "./handoff-types"

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a baseline compatibility report with defaults for a simulation-only
 * disaggregated serving scenario.
 */
export function createKvHandoffCompatibilityReport(): LlmDKvHandoffCompatibilityReport {
  return {
    sameWorkerPhasePinningSupport: "supported",
    simulatedKvHandoffSupport: "supported",
    handoffReceiptSupport: "supported",
    strictKvCompatibilityValidationSupport: "supported",
    sourceRetentionPolicySupport: "supported",
    simulatedFailureRecoverySupport: "supported",
    realNetworkKvTransportSupport: "not_supported",
    nixlConnectorSupport: "not_supported",
    rdmaTransportSupport: "not_supported",
    sharedKvStoreSupport: "not_supported",
    productionPrefillDecodeDisaggregationSupport: "not_supported",
    knownGaps: [
      "real_network_transport",
      "nixl_connector",
      "rdma_transport",
      "shared_kv_store",
    ],
    deferredFeatures: [
      "production_disaggregation",
      "real_transport_integrity",
    ],
    testEvidenceRefs: [],
  }
}

// ── Status Mutation ─────────────────────────────────────────────────────────

/**
 * Sets a single area's status on the report, returning the updated report.
 */
export function setKvHandoffStatus(
  report: LlmDKvHandoffCompatibilityReport,
  area: string,
  status: string,
): LlmDKvHandoffCompatibilityReport {
  const validAreas: (keyof LlmDKvHandoffCompatibilityReport)[] = [
    "sameWorkerPhasePinningSupport",
    "simulatedKvHandoffSupport",
    "handoffReceiptSupport",
    "strictKvCompatibilityValidationSupport",
    "sourceRetentionPolicySupport",
    "simulatedFailureRecoverySupport",
    "realNetworkKvTransportSupport",
    "nixlConnectorSupport",
    "rdmaTransportSupport",
    "sharedKvStoreSupport",
    "productionPrefillDecodeDisaggregationSupport",
  ]

  const key = validAreas.find((k) => k === area)

  if (!key) {
    throw new Error(`Unknown compatibility area: "${area}"`)
  }

  ;(report as unknown as Record<string, string | string[]>)[key] = status
  return report
}
