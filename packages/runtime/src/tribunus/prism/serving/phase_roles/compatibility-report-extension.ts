/**
 * Compatibility report extension — extends the base compatibility report with
 * phase-role-specific contract status fields.
 */

import type { LlmDPrismPhaseCompatibilityReport } from "./phase-role-types"

/**
 * Create a default phase compatibility report with all fields initialised.
 */
export function createPhaseCompatibilityReport(): LlmDPrismPhaseCompatibilityReport {
  return {
    llmdVersion: "2.0.0",
    prismWorkerProtocolVersion: 1,
    routerProtocolVersion: 1,
    kvEventSchemaVersion: 2,
    unifiedWorkerSupport: "verified",
    phaseRoleAdvertisementSupport: "verified",
    sameWorkerPhasePinningSupport: "verified",
    phaseCapacityReportingSupport: "verified",
    phaseMetricSupport: "verified",
    phaseReceiptSupport: "verified",
    phaseDrainSupport: "verified",
    crossWorkerKvTransferSupport: "not_supported",
    prefillDecodeDisaggregationSupport: "not_supported",
    knownGaps: [],
    deferredFeatures: ["cross_worker_kv_transfer", "prefill_decode_disaggregation"],
    testEvidenceRefs: [],
  }
}

/**
 * Set a specific phase contract status field on the report.
 * Returns a new object with the updated field.
 */
export function setPhaseContractStatus(
  report: LlmDPrismPhaseCompatibilityReport,
  area: string,
  status: string,
): LlmDPrismPhaseCompatibilityReport {
  return { ...report, [area]: status }
}
