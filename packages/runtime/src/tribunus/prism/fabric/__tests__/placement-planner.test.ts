/**
 * Prism Fabric — Placement Planner Tests
 *
 * Tests for candidate enumeration, device filtering, budget-constrained
 * selection, and fallback decisions.
 */

import { expect, test, describe } from "bun:test"
import {
  enumerateCandidatePlacements,
  isDeviceAllowed,
  selectPlacement,
  estimateMovementCost,
  estimateExecutionCost,
  scorePlacement,
  makeFallbackDecision,
} from "../placement-planner"

import { createPlacementRequest } from "../placement-request"
import { createFabricMemoryBudget } from "../memory-budget"

import type { PrismTopologyGraph } from "../fabric-types"

// ── Test Fixtures ─────────────────────────────────────────────────────────────

function sampleTopology(): PrismTopologyGraph {
  return {
    hostInstanceId: "host-1",
    topologyGeneration: 1,
    discoveredAt: "2025-01-01T00:00:00Z",
    devices: [
      {
        deviceId: "cpu-1",
        deviceClass: "cpu",
        backendKind: "cpu_native",
        targetCapabilitySignature: "sig-cpu",
        memoryDomainIds: ["dom-cpu-1"],
        computeCapabilities: ["fp32"],
        supportedWorkloads: ["tokenization", "postprocessing", "static_subgraph"],
        availableMemoryBytes: 8_000_000_000,
        reservedMemoryBytes: 500_000_000,
        healthState: "healthy",
      },
      {
        deviceId: "igpu-1",
        deviceClass: "integrated_gpu",
        backendKind: "metal",
        targetCapabilitySignature: "sig-igpu",
        memoryDomainIds: ["dom-apu-1"],
        computeCapabilities: ["fp16", "fp32"],
        supportedWorkloads: ["prefill", "decode", "attention", "mlp", "norm"],
        availableMemoryBytes: 4_000_000_000,
        reservedMemoryBytes: 1_000_000_000,
        healthState: "healthy",
      },
      {
        deviceId: "dgpu-1",
        deviceClass: "discrete_gpu",
        backendKind: "cuda",
        targetCapabilitySignature: "sig-dgpu",
        memoryDomainIds: ["dom-dgpu-1"],
        computeCapabilities: ["fp16", "fp32", "fp64"],
        supportedWorkloads: ["prefill", "decode", "attention", "mlp", "norm", "classification_head"],
        availableMemoryBytes: 12_000_000_000,
        reservedMemoryBytes: 2_000_000_000,
        healthState: "healthy",
      },
    ],
    memoryDomains: [
      {
        domainId: "dom-cpu-1",
        domainKind: "cpu_system_memory",
        deviceIds: ["cpu-1"],
        totalBytes: 16_000_000_000,
        usedBytes: 4_000_000_000,
        reservedBytes: 500_000_000,
        allocationGranularity: 4096,
      },
      {
        domainId: "dom-apu-1",
        domainKind: "apu_shared_memory",
        deviceIds: ["igpu-1"],
        totalBytes: 8_000_000_000,
        usedBytes: 2_000_000_000,
        reservedBytes: 500_000_000,
        allocationGranularity: 4096,
      },
      {
        domainId: "dom-dgpu-1",
        domainKind: "discrete_gpu_vram",
        deviceIds: ["dgpu-1"],
        totalBytes: 16_000_000_000,
        usedBytes: 4_000_000_000,
        reservedBytes: 1_000_000_000,
        allocationGranularity: 65536,
      },
    ],
    transportEdges: [
      {
        edgeId: "edge-cpu-apu",
        sourceDomainId: "dom-cpu-1",
        destinationDomainId: "dom-apu-1",
        transportKind: "direct_shared_access",
        accessMode: "read_write",
        coherencyMode: "coherent",
        maximumBytes: 8_000_000_000,
        measuredBandwidthBytesPerSecond: 40_000_000_000,
        measuredLatencyMicroseconds: 5,
        supportsAsync: true,
        supportsCancellation: true,
        supportsIntegrityValidation: true,
        availabilityState: "available",
      },
      {
        edgeId: "edge-cpu-dgpu",
        sourceDomainId: "dom-cpu-1",
        destinationDomainId: "dom-dgpu-1",
        transportKind: "backend_device_copy",
        accessMode: "read_write",
        coherencyMode: "non_coherent",
        maximumBytes: 16_000_000_000,
        measuredBandwidthBytesPerSecond: 12_000_000_000,
        measuredLatencyMicroseconds: 20,
        supportsAsync: true,
        supportsCancellation: false,
        supportsIntegrityValidation: true,
        availabilityState: "available",
      },
    ],
    interconnects: [],
    capabilitySignatures: ["sig-cpu", "sig-igpu", "sig-dgpu"],
    measuredBandwidthClasses: [],
    measuredLatencyClasses: [],
    policyRestrictions: [],
  }
}

// ── Candidate Enumeration ─────────────────────────────────────────────────────

describe("enumerateCandidatePlacements", () => {
  test("enumerates one candidate per allowed device", () => {
    const topo = sampleTopology()
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)

    const candidates = enumerateCandidatePlacements(topo, req)

    expect(candidates.length).toBe(3) // cpu-1, igpu-1, dgpu-1
    const deviceIds = candidates.map(c => c.selectedDeviceId).sort()
    expect(deviceIds).toEqual(["cpu-1", "dgpu-1", "igpu-1"])
  })

  test("skips forbidden devices", () => {
    const topo = sampleTopology()
    const req = createPlacementRequest("req-2", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    req.forbiddenDevices = ["dgpu-1"]

    const candidates = enumerateCandidatePlacements(topo, req)

    const deviceIds = candidates.map(c => c.selectedDeviceId)
    expect(deviceIds).not.toContain("dgpu-1")
    expect(deviceIds).toContain("cpu-1")
    expect(deviceIds).toContain("igpu-1")
  })

  test("only includes explicitly allowed devices", () => {
    const topo = sampleTopology()
    const req = createPlacementRequest("req-3", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    req.allowedDevices = ["igpu-1"]

    const candidates = enumerateCandidatePlacements(topo, req)

    expect(candidates.length).toBe(1)
    expect(candidates[0].selectedDeviceId).toBe("igpu-1")
  })

  test("returns empty when no devices allowed", () => {
    const topo = sampleTopology()
    const req = createPlacementRequest("req-4", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    req.allowedDevices = ["nonexistent"]

    const candidates = enumerateCandidatePlacements(topo, req)

    expect(candidates.length).toBe(0)
  })
})

// ── Device Filtering ──────────────────────────────────────────────────────────

describe("isDeviceAllowed", () => {
  const devices = sampleTopology().devices

  test("allows device with no constraints", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)

    expect(isDeviceAllowed(req, "cpu-1", devices)).toBe(true)
    expect(isDeviceAllowed(req, "igpu-1", devices)).toBe(true)
    expect(isDeviceAllowed(req, "dgpu-1", devices)).toBe(true)
  })

  test("forbids a device when listed in forbiddenDevices", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    req.forbiddenDevices = ["dgpu-1"]

    expect(isDeviceAllowed(req, "dgpu-1", devices)).toBe(false)
    expect(isDeviceAllowed(req, "cpu-1", devices)).toBe(true)
  })

  test("only allows devices from allowedDevices when non-empty", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    req.allowedDevices = ["igpu-1"]

    expect(isDeviceAllowed(req, "igpu-1", devices)).toBe(true)
    expect(isDeviceAllowed(req, "cpu-1", devices)).toBe(false)
    expect(isDeviceAllowed(req, "dgpu-1", devices)).toBe(false)
  })

  test("forbiddenDevices overrides allowedDevices", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    req.allowedDevices = ["igpu-1", "dgpu-1"]
    req.forbiddenDevices = ["dgpu-1"]

    expect(isDeviceAllowed(req, "dgpu-1", devices)).toBe(false)
    expect(isDeviceAllowed(req, "igpu-1", devices)).toBe(true)
  })
})

// ── Selection with Budget ─────────────────────────────────────────────────────

describe("selectPlacement", () => {
  test("selects the highest-scored device within budget", () => {
    const topo = sampleTopology()
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    const budget = createFabricMemoryBudget()

    const decision = selectPlacement(topo, req, budget)

    expect(decision).not.toBeNull()
    expect(decision!.policyBasis).toBe("scored")
    expect(decision!.selectedDeviceId.length).toBeGreaterThan(0)
  })

  test("returns null when all domains exceed emergency threshold", () => {
    const topo = sampleTopology()
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    const budget = createFabricMemoryBudget()
    budget.emergencyReclaimThreshold = 0.0 // no domain passes

    const decision = selectPlacement(topo, req, budget)

    expect(decision).toBeNull()
  })

  test("returns null when no candidates exist", () => {
    const topo = sampleTopology()
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    req.forbiddenDevices = ["cpu-1", "igpu-1", "dgpu-1"]
    const budget = createFabricMemoryBudget()

    const decision = selectPlacement(topo, req, budget)

    expect(decision).toBeNull()
  })
})

// ── Cost Estimates ────────────────────────────────────────────────────────────

describe("estimateMovementCost", () => {
  test("returns finite cost for available edge", () => {
    const edge = sampleTopology().transportEdges[0]!

    const cost = estimateMovementCost(1_000_000_000, edge)

    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(Infinity)
  })

  test("returns Infinity for unavailable edge", () => {
    const edge = { ...sampleTopology().transportEdges[0]!, availabilityState: "unavailable" as const }

    const cost = estimateMovementCost(1_000_000_000, edge)

    expect(cost).toBe(Infinity)
  })

  test("returns byte-based cost when no edge", () => {
    const cost = estimateMovementCost(1_000_000_000, null)

    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(Infinity)
  })
})

describe("estimateExecutionCost", () => {
  test("computes cost from token counts", () => {
    const cost = estimateExecutionCost(512, 256, false)

    // 512 * 0.5 + 256 * 1.0 = 512
    expect(cost).toBe(512)
  })

  test("applies KV reuse discount", () => {
    const withReuse = estimateExecutionCost(512, 256, true)
    const withoutReuse = estimateExecutionCost(512, 256, false)

    expect(withReuse).toBeLessThan(withoutReuse)
    expect(withReuse).toBe(withoutReuse * 0.6)
  })
})

// ── Score Placement ───────────────────────────────────────────────────────────

describe("scorePlacement", () => {
  test("produces score in [0, 1]", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    const decision = makeFallbackDecision("test")

    const score = scorePlacement(decision, req)

    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("KV reuse scores higher than no reuse", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    const low = scorePlacement(
      { ...makeFallbackDecision("test"), expectedKvReuse: false, estimatedExecutionCost: 100 },
      req,
    )
    const high = scorePlacement(
      { ...makeFallbackDecision("test"), expectedKvReuse: true, estimatedExecutionCost: 100 },
      req,
    )

    expect(high).toBeGreaterThan(low)
  })
})

// ── Fallback ──────────────────────────────────────────────────────────────────

describe("makeFallbackDecision", () => {
  test("creates a fallback_cpu decision", () => {
    const decision = makeFallbackDecision("No devices available")

    expect(decision.destinationResidency).toBe("cpu_system_memory")
    expect(decision.policyBasis).toBe("fallback")
    expect(decision.decisionReason).toBe("No devices available")
    expect(decision.fallbackDecisionIds).toEqual([])
    expect(decision.selectedTransportPath).toEqual([])
  })
})
