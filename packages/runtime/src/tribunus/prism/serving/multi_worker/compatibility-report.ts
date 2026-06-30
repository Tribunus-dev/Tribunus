/**
 * Prism Multi-Worker Router — Compatibility Report
 *
 * Constructs and manages LlmDPrismCompatibilityReport objects for
 * validating protocol and contract compatibility between the Prism
 * router and an llm-d worker instance.
 */

import type {
  LlmDPrismCompatibilityReport,
  CompatibilityGap,
  ContractStatus,
} from "./router-types"

/**
 * Create a new compatibility report for a given Prism protocol version
 * and llm-d version string.
 */
export function createCompatibilityReport(
  prismVersion: number,
  llmdVersion: string,
): LlmDPrismCompatibilityReport {
  return {
    llmdVersion,
    gatewayApiInferenceExtensionVersion: "1.0.0",
    prismWorkerProtocolVersion: prismVersion,
    validatedAt: new Date().toISOString(),
    workerContractStatus: "native",
    routingContractStatus: "native",
    kvEventContractStatus: "native",
    healthContractStatus: "native",
    metricsContractStatus: "native",
    drainContractStatus: "native",
    cancellationContractStatus: "native",
    knownGaps: [],
    deferredFeatures: [],
    testEvidenceRefs: [],
  }
}

/**
 * Add a compatibility gap to the report. Returns a new report with the gap appended.
 */
export function addCompatibilityGap(
  report: LlmDPrismCompatibilityReport,
  gap: CompatibilityGap,
): LlmDPrismCompatibilityReport {
  return {
    ...report,
    knownGaps: [...report.knownGaps, gap],
  }
}

/**
 * Set the contract status for a specific contract area in the report.
 * Returns a new report with the updated status.
 *
 * Supported area values: "worker", "routing", "kvEvent", "health",
 * "metrics", "drain", "cancellation"
 */
export function setContractStatus(
  report: LlmDPrismCompatibilityReport,
  area: string,
  status: ContractStatus,
): LlmDPrismCompatibilityReport {
  switch (area) {
    case "worker":
      return { ...report, workerContractStatus: status }
    case "routing":
      return { ...report, routingContractStatus: status }
    case "kvEvent":
      return { ...report, kvEventContractStatus: status }
    case "health":
      return { ...report, healthContractStatus: status }
    case "metrics":
      return { ...report, metricsContractStatus: status }
    case "drain":
      return { ...report, drainContractStatus: status }
    case "cancellation":
      return { ...report, cancellationContractStatus: status }
    default:
      return report
  }
}

/**
 * Produce a concise human-readable summary string from a compatibility report.
 */
export function getReportSummary(report: LlmDPrismCompatibilityReport): string {
  const gapsCount = report.knownGaps.length
  const blockingGaps = report.knownGaps.filter((g) => g.severity === "blocking").length
  const deferred = report.deferredFeatures.length
  const nonNative = (
    Object.entries({
      worker: report.workerContractStatus,
      routing: report.routingContractStatus,
      kvEvent: report.kvEventContractStatus,
      health: report.healthContractStatus,
      metrics: report.metricsContractStatus,
      drain: report.drainContractStatus,
      cancellation: report.cancellationContractStatus,
    }) as [string, ContractStatus][]
  ).filter(([, s]) => s !== "native")

  return [
    `Prism v${report.prismWorkerProtocolVersion} ↔ llm-d ${report.llmdVersion}`,
    `Contracts: ${report.workerContractStatus}/${report.routingContractStatus}/${report.kvEventContractStatus}` +
      `/${report.healthContractStatus}/${report.metricsContractStatus}/${report.drainContractStatus}/${report.cancellationContractStatus}`,
    `${nonNative.length} non-native contracts, ${gapsCount} gaps (${blockingGaps} blocking), ${deferred} deferred features`,
  ].join(" | ")
}
