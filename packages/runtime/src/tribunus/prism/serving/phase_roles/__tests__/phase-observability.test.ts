/**
 * Tests — Phase Observability
 *
 * Covers phase metrics names, metrics snapshot creation, compatibility
 * report creation, and phase contract status updates.
 */

import { describe, it, expect } from "bun:test"
import { getPhaseMetricNames, createPhaseMetricsSnapshot } from "../phase-metrics"
import { createPhaseCompatibilityReport, setPhaseContractStatus } from "../compatibility-report-extension"

describe("getPhaseMetricNames", () => {
  it("returns the canonical list of phase metric names", () => {
    const names = getPhaseMetricNames()
    expect(names).toContain("prefill_active_operations")
    expect(names).toContain("prefill_maximum_operations")
    expect(names).toContain("decode_active_operations")
    expect(names).toContain("decode_maximum_operations")
    expect(names).toContain("decode_active_kv_namespaces")
  })

  it("returns a mutable copy", () => {
    const names = getPhaseMetricNames()
    const originalLength = names.length
    names.push("extra")
    expect(names).toHaveLength(originalLength + 1)
    // Subsequent call unaffected
    expect(getPhaseMetricNames()).toHaveLength(originalLength)
  })
})

describe("createPhaseMetricsSnapshot", () => {
  it("creates a snapshot with all metric fields", () => {
    const snapshot = createPhaseMetricsSnapshot(3, 8, 5, 8, 12)
    expect(snapshot.prefill_active_operations).toBe(3)
    expect(snapshot.prefill_maximum_operations).toBe(8)
    expect(snapshot.decode_active_operations).toBe(5)
    expect(snapshot.decode_maximum_operations).toBe(8)
    expect(snapshot.decode_active_kv_namespaces).toBe(12)
  })

  it("handles zero values", () => {
    const snapshot = createPhaseMetricsSnapshot(0, 0, 0, 0, 0)
    expect(snapshot.prefill_active_operations).toBe(0)
    expect(snapshot.decode_active_kv_namespaces).toBe(0)
  })

  it("handles capacity at limit", () => {
    const snapshot = createPhaseMetricsSnapshot(8, 8, 4, 4, 64)
    expect(snapshot.prefill_active_operations).toBe(snapshot.prefill_maximum_operations)
  })
})

describe("createPhaseCompatibilityReport", () => {
  it("creates a report with all fields at defaults", () => {
    const report = createPhaseCompatibilityReport()
    expect(report.llmdVersion).toBe("2.0.0")
    expect(report.prismWorkerProtocolVersion).toBe(1)
    expect(report.kvEventSchemaVersion).toBe(2)
    expect(report.unifiedWorkerSupport).toBe("verified")
    expect(report.phaseRoleAdvertisementSupport).toBe("verified")
    expect(report.sameWorkerPhasePinningSupport).toBe("verified")
    expect(report.phaseCapacityReportingSupport).toBe("verified")
    expect(report.phaseMetricSupport).toBe("verified")
    expect(report.phaseReceiptSupport).toBe("verified")
    expect(report.phaseDrainSupport).toBe("verified")
    expect(report.crossWorkerKvTransferSupport).toBe("not_supported")
    expect(report.prefillDecodeDisaggregationSupport).toBe("not_supported")
  })

  it("includes known gaps and deferred features", () => {
    const report = createPhaseCompatibilityReport()
    expect(report.knownGaps).toEqual([])
    expect(report.deferredFeatures).toContain("cross_worker_kv_transfer")
    expect(report.deferredFeatures).toContain("prefill_decode_disaggregation")
    expect(report.testEvidenceRefs).toEqual([])
  })
})

describe("setPhaseContractStatus", () => {
  it("returns a new report with the updated field", () => {
    const report = createPhaseCompatibilityReport()
    const updated = setPhaseContractStatus(report, "crossWorkerKvTransferSupport", "verified")
    expect(updated.crossWorkerKvTransferSupport).toBe("verified")
    // Original unchanged
    expect(report.crossWorkerKvTransferSupport).toBe("not_supported")
  })

  it("updates multiple fields independently", () => {
    const report = createPhaseCompatibilityReport()
    const a = setPhaseContractStatus(report, "phaseDrainSupport", "in_progress")
    const b = setPhaseContractStatus(report, "prefillDecodeDisaggregationSupport", "verified")
    expect(a.phaseDrainSupport).toBe("in_progress")
    expect(a.prefillDecodeDisaggregationSupport).toBe("not_supported")
    expect(b.phaseDrainSupport).toBe("verified")
    expect(b.prefillDecodeDisaggregationSupport).toBe("verified")
  })
})
