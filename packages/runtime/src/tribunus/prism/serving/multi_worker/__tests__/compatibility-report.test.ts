/**
 * Prism Multi-Worker Router — Compatibility Report Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createCompatibilityReport,
  addCompatibilityGap,
  setContractStatus,
  getReportSummary,
} from "../compatibility-report"
import type { LlmDPrismCompatibilityReport, CompatibilityGap, ContractStatus } from "../router-types"

describe("createCompatibilityReport", () => {
  test("creates a valid initial report", () => {
    const report = createCompatibilityReport(2, "0.1.0")
    expect(report.prismWorkerProtocolVersion).toBe(2)
    expect(report.llmdVersion).toBe("0.1.0")
    expect(report.workerContractStatus).toBe("native")
    expect(report.routingContractStatus).toBe("native")
    expect(report.kvEventContractStatus).toBe("native")
    expect(report.healthContractStatus).toBe("native")
    expect(report.metricsContractStatus).toBe("native")
    expect(report.drainContractStatus).toBe("native")
    expect(report.cancellationContractStatus).toBe("native")
    expect(report.knownGaps).toEqual([])
    expect(report.deferredFeatures).toEqual([])
    expect(report.testEvidenceRefs).toEqual([])
  })

  test("includes validatedAt timestamp", () => {
    const report = createCompatibilityReport(2, "0.1.0")
    expect(report.validatedAt).toBeDefined()
    expect(() => new Date(report.validatedAt)).not.toThrow()
  })

  test("includes gateway API version", () => {
    const report = createCompatibilityReport(2, "0.1.0")
    expect(report.gatewayApiInferenceExtensionVersion).toBe("1.0.0")
  })
})

describe("addCompatibilityGap", () => {
  const base = createCompatibilityReport(2, "0.1.0")

  test("appends a gap to knownGaps", () => {
    const gap: CompatibilityGap = {
      area: "streaming",
      description: "Server-sent events not supported",
      severity: "major",
      mitigation: "Use polling fallback",
    }
    const updated = addCompatibilityGap(base, gap)
    expect(updated.knownGaps).toHaveLength(1)
    expect(updated.knownGaps[0].area).toBe("streaming")
    expect(updated.knownGaps[0].severity).toBe("major")
  })

  test("multiple gaps accumulate", () => {
    const gap1: CompatibilityGap = { area: "a1", description: "d1", severity: "minor", mitigation: null }
    const gap2: CompatibilityGap = { area: "a2", description: "d2", severity: "blocking", mitigation: "fix" }
    const updated = addCompatibilityGap(addCompatibilityGap(base, gap1), gap2)
    expect(updated.knownGaps).toHaveLength(2)
  })
})

describe("setContractStatus", () => {
  const base = createCompatibilityReport(2, "0.1.0")

  test("sets worker contract status", () => {
    const updated = setContractStatus(base, "worker", "adapter_required")
    expect(updated.workerContractStatus).toBe("adapter_required")
    expect(updated.routingContractStatus).toBe("native") // unchanged
  })

  test("sets routing contract status", () => {
    const updated = setContractStatus(base, "routing", "unsupported")
    expect(updated.routingContractStatus).toBe("unsupported")
  })

  test("sets kvEvent contract status", () => {
    const updated = setContractStatus(base, "kvEvent", "deferred")
    expect(updated.kvEventContractStatus).toBe("deferred")
  })

  test("sets health contract status", () => {
    const updated = setContractStatus(base, "health", "adapter_required")
    expect(updated.healthContractStatus).toBe("adapter_required")
  })

  test("sets metrics contract status", () => {
    const updated = setContractStatus(base, "metrics", "unsupported")
    expect(updated.metricsContractStatus).toBe("unsupported")
  })

  test("sets drain contract status", () => {
    const updated = setContractStatus(base, "drain", "deferred")
    expect(updated.drainContractStatus).toBe("deferred")
  })

  test("sets cancellation contract status", () => {
    const updated = setContractStatus(base, "cancellation", "adapter_required")
    expect(updated.cancellationContractStatus).toBe("adapter_required")
  })

  test("unknown area leaves report unchanged", () => {
    const updated = setContractStatus(base, "unknown", "unsupported")
    expect(updated).toEqual(base)
  })
})

describe("getReportSummary", () => {
  test("generates a non-empty summary string", () => {
    const report = createCompatibilityReport(2, "0.1.0")
    const summary = getReportSummary(report)
    expect(typeof summary).toBe("string")
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toContain("Prism v2")
    expect(summary).toContain("llm-d 0.1.0")
  })

  test("reports blocking gaps count", () => {
    const report = createCompatibilityReport(2, "0.1.0")
    const withGap = addCompatibilityGap(report, {
      area: "critical",
      description: "Missing protocol",
      severity: "blocking",
      mitigation: null,
    })
    const withMinor = addCompatibilityGap(withGap, {
      area: "cosmetic",
      description: "Log format differs",
      severity: "minor",
      mitigation: "Warn once",
    })
    const summary = getReportSummary(withMinor)
    expect(summary).toContain("2 gaps")
    expect(summary).toContain("1 blocking")
  })
})
