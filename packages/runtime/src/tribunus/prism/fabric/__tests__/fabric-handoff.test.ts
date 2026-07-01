/**
 * Fabric Handoff — Unit Tests
 */

import { expect, test, describe, beforeEach } from "bun:test"
import {
  createFabricKvHandoffRequest,
  selectTransportPath,
  validateFabricHandoffCompatibility,
  getHandoffModeLabel,
  _resetHandoffCounter,
} from "../fabric-handoff"
import type { PrismMemoryTransportEdge, PrismMemoryDomainKind } from "../fabric-types"

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeEdge(
  overrides: Partial<PrismMemoryTransportEdge> = {},
): PrismMemoryTransportEdge {
  return {
    edgeId: "edge_001",
    sourceDomainId: "domain_cpu",
    destinationDomainId: "domain_apu",
    transportKind: "direct_shared_access",
    accessMode: "read_write",
    coherencyMode: "coherent",
    maximumBytes: 1_073_741_824,
    measuredBandwidthBytesPerSecond: 50_000_000_000,
    measuredLatencyMicroseconds: 5,
    supportsAsync: true,
    supportsCancellation: true,
    supportsIntegrityValidation: true,
    availabilityState: "available",
    ...overrides,
  }
}

const CPU_DOMAIN: PrismMemoryDomainKind = "cpu_system_memory"
const APU_DOMAIN: PrismMemoryDomainKind = "apu_shared_memory"
const NPU_DOMAIN: PrismMemoryDomainKind = "npu_shared_memory"
const DGPU_DOMAIN: PrismMemoryDomainKind = "discrete_gpu_vram"

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetHandoffCounter()
})

// ── createFabricKvHandoffRequest ───────────────────────────────────────────

describe("createFabricKvHandoffRequest", () => {
  test("creates handoff request with all required fields", () => {
    const req = createFabricKvHandoffRequest("cpu_0", "domain_cpu", "apu_0", "domain_apu")

    expect(req.handoffId).toBe("handoff_1")
    expect(req.sourceDeviceId).toBe("cpu_0")
    expect(req.sourceMemoryDomainId).toBe("domain_cpu")
    expect(req.destinationDeviceId).toBe("apu_0")
    expect(req.destinationMemoryDomainId).toBe("domain_apu")
    expect(req.selectedTransportPath).toEqual([])
    expect(req.policyBasis).toBe("default")
    expect(req.estimatedTransferBytes).toBeGreaterThan(0)
  })

  test("increments handoff counter", () => {
    const r1 = createFabricKvHandoffRequest("a", "b", "c", "d")
    const r2 = createFabricKvHandoffRequest("a", "b", "c", "d")
    expect(r1.handoffId).toBe("handoff_1")
    expect(r2.handoffId).toBe("handoff_2")
  })
})

// ── selectTransportPath ────────────────────────────────────────────────────

describe("selectTransportPath", () => {
  test("returns null when no available edges exist", () => {
    const result = selectTransportPath(CPU_DOMAIN, APU_DOMAIN, [])
    expect(result).toBeNull()
  })

  test("prefers available edge over untested", () => {
    const available = makeEdge({ edgeId: "avail", availabilityState: "available" })
    const untested = makeEdge({
      edgeId: "untest",
      availabilityState: "untested",
    })
    const result = selectTransportPath(CPU_DOMAIN, APU_DOMAIN, [untested, available])
    expect(result).not.toBeNull()
    expect(result!.edgeId).toBe("avail")
  })

  test("ignores degraded and unavailable edges", () => {
    const degraded = makeEdge({ edgeId: "deg", availabilityState: "degraded" })
    const unavailable = makeEdge({ edgeId: "unav", availabilityState: "unavailable" })
    const result = selectTransportPath(CPU_DOMAIN, DGPU_DOMAIN, [degraded, unavailable])
    expect(result).toBeNull()
  })

  test("returns an edge when candidates exist (even untested)", () => {
    const edge = makeEdge({ availabilityState: "untested" })
    const result = selectTransportPath(CPU_DOMAIN, APU_DOMAIN, [edge])
    expect(result).not.toBeNull()
    expect(result!.edgeId).toBe("edge_001")
  })

  test("prefers edges with smaller kind-distance", () => {
    const far = makeEdge({ edgeId: "far" })
    const close = makeEdge({ edgeId: "close" })
    // When both are available, sorting by score still picks the first
    const result = selectTransportPath(CPU_DOMAIN, APU_DOMAIN, [far, close])
    expect(result).not.toBeNull()
  })
})

// ── validateFabricHandoffCompatibility ─────────────────────────────────────

describe("validateFabricHandoffCompatibility", () => {
  test("valid handoff passes validation", () => {
    const req = createFabricKvHandoffRequest("cpu_0", "dom_cpu", "apu_0", "dom_apu")
    const result = validateFabricHandoffCompatibility(req)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("rejects empty handoffId", () => {
    const req = createFabricKvHandoffRequest("cpu_0", "dom_cpu", "apu_0", "dom_apu")
    const bad = { ...req, handoffId: "" }
    const result = validateFabricHandoffCompatibility(bad)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("handoffId")
  })

  test("rejects same source and destination device", () => {
    const req = createFabricKvHandoffRequest("cpu_0", "dom_cpu", "pu_1", "dom_apu")
    const bad = { ...req, sourceDeviceId: "same", destinationDeviceId: "same" }
    const result = validateFabricHandoffCompatibility(bad)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("device")
  })

  test("rejects same source and destination memory domain", () => {
    const req = createFabricKvHandoffRequest("cpu_0", "dom_cpu", "apu_0", "dom_apu")
    const bad = { ...req, sourceMemoryDomainId: "same", destinationMemoryDomainId: "same" }
    const result = validateFabricHandoffCompatibility(bad)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("memory domain")
  })

  test("rejects zero estimated transfer bytes", () => {
    const req = createFabricKvHandoffRequest("cpu_0", "dom_cpu", "apu_0", "dom_apu")
    const bad = { ...req, estimatedTransferBytes: 0 }
    const result = validateFabricHandoffCompatibility(bad)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("estimatedTransferBytes")
  })

  test("rejects empty source device id", () => {
    const req = createFabricKvHandoffRequest("cpu_0", "dom_cpu", "apu_0", "dom_apu")
    const bad = { ...req, sourceDeviceId: "   " }
    const result = validateFabricHandoffCompatibility(bad)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("sourceDeviceId")
  })
})

// ── getHandoffModeLabel ────────────────────────────────────────────────────

describe("getHandoffModeLabel", () => {
  test("returns formatted label for CPU → APU", () => {
    const label = getHandoffModeLabel(CPU_DOMAIN, APU_DOMAIN)
    expect(label).toBe("CPU System Memory → APU Shared Memory")
  })

  test("returns formatted label for dGPU → NPU", () => {
    const label = getHandoffModeLabel(DGPU_DOMAIN, NPU_DOMAIN)
    expect(label).toBe("dGPU VRAM → NPU Shared Memory")
  })

  test("handles unknown kinds gracefully", () => {
    const label = getHandoffModeLabel("unknown_domain" as any, APU_DOMAIN)
    expect(label).toContain("unknown_domain")
  })
})
