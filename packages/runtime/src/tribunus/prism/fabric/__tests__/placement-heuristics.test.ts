/**
 * Prism Fabric — Placement Heuristics Tests
 *
 * Tests for APU vs dGPU preference, workload scoring, and latency preference.
 */

import { expect, test, describe } from "bun:test"
import {
  scoreDeviceForWorkload,
  scoreMemoryDomain,
  scoreTransferCost,
  scoreKvLocality,
} from "../placement-scorer"

import { createPlacementRequest } from "../placement-request"

import type {
  PrismComputeDevice,
  PrismMemoryDomainInfo,
  PrismMemoryTransportEdge,
} from "../fabric-types"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDevice(overrides: Partial<PrismComputeDevice>): PrismComputeDevice {
  return {
    deviceId: "dev-1",
    deviceClass: "integrated_gpu",
    backendKind: "metal",
    targetCapabilitySignature: "sig-1",
    memoryDomainIds: ["dom-1"],
    computeCapabilities: ["fp16", "fp32"],
    supportedWorkloads: ["prefill", "decode", "attention", "mlp"],
    availableMemoryBytes: 4_000_000_000,
    reservedMemoryBytes: 1_000_000_000,
    healthState: "healthy",
    ...overrides,
  }
}

function makeDomain(overrides: Partial<PrismMemoryDomainInfo>): PrismMemoryDomainInfo {
  return {
    domainId: "dom-1",
    domainKind: "apu_shared_memory",
    deviceIds: ["dev-1"],
    totalBytes: 8_000_000_000,
    usedBytes: 2_000_000_000,
    reservedBytes: 500_000_000,
    allocationGranularity: 4096,
    ...overrides,
  }
}

function makeEdge(overrides: Partial<PrismMemoryTransportEdge>): PrismMemoryTransportEdge {
  return {
    edgeId: "edge-1",
    sourceDomainId: "src-1",
    destinationDomainId: "dst-1",
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
    ...overrides,
  }
}

// ── APU prefers local for short workloads ─────────────────────────────────────

describe("APU prefers local for short workloads", () => {
  test("integrated_gpu scores higher for short decode workload than cpu", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 128, 64)

    const igpu = makeDevice({ deviceClass: "integrated_gpu" })
    const cpu = makeDevice({ deviceClass: "cpu", supportedWorkloads: ["tokenization"] })

    const igpuScore = scoreDeviceForWorkload(igpu, req)
    const cpuScore = scoreDeviceForWorkload(cpu, req)

    // iGPU has decode affinity (0.8 base); CPU has none → iGPU should score higher.
    expect(igpuScore).toBeGreaterThan(cpuScore)
  })

  test("healthy iGPU scores higher than degraded iGPU", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 128, 64)

    const healthy = makeDevice({ healthState: "healthy" })
    const degraded = makeDevice({ healthState: "degraded" })

    const hs = scoreDeviceForWorkload(healthy, req)
    const ds = scoreDeviceForWorkload(degraded, req)

    expect(hs).toBeGreaterThan(ds)
  })
})

// ── dGPU for long workloads ───────────────────────────────────────────────────

describe("dGPU preferred for long workloads", () => {
  test("discrete_gpu scores higher than integrated_gpu for decode with many tokens", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 4096, 2048)

    const dgpu = makeDevice({
      deviceId: "dgpu-1",
      deviceClass: "discrete_gpu",
      backendKind: "cuda",
      availableMemoryBytes: 12_000_000_000,
      reservedMemoryBytes: 2_000_000_000,
    })
    const igpu = makeDevice({
      deviceId: "igpu-1",
      deviceClass: "integrated_gpu",
      availableMemoryBytes: 4_000_000_000,
      reservedMemoryBytes: 1_000_000_000,
    })

    const dgpuScore = scoreDeviceForWorkload(dgpu, req)
    const igpuScore = scoreDeviceForWorkload(igpu, req)

    // dGPU has stronger decode affinity (0.95) and more memory → higher score.
    expect(dgpuScore).toBeGreaterThan(igpuScore)
  })

  test("dGPU scores higher for attention-heavy workloads", () => {
    const req = createPlacementRequest("req-1", "route-1", "attention", "digest-a", "digest-tok", 512, 256)

    const dgpu = makeDevice({
      deviceId: "dgpu-1",
      deviceClass: "discrete_gpu",
      backendKind: "cuda",
      availableMemoryBytes: 12_000_000_000,
      reservedMemoryBytes: 2_000_000_000,
    })
    const cpu = makeDevice({ deviceClass: "cpu", supportedWorkloads: ["tokenization"] })

    expect(scoreDeviceForWorkload(dgpu, req)).toBeGreaterThan(scoreDeviceForWorkload(cpu, req))
  })
})

// ── Score by Workload ─────────────────────────────────────────────────────────

describe("scoreDeviceForWorkload", () => {
  test("returns score in [0, 1]", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    const device = makeDevice({})

    const score = scoreDeviceForWorkload(device, req)

    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test("unhealthy device scores lower than healthy", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
   const healthy = makeDevice({ healthState: "healthy" })
   const unhealthy = makeDevice({ healthState: "unhealthy" })

   expect(scoreDeviceForWorkload(unhealthy, req)).toBeLessThan(scoreDeviceForWorkload(healthy, req))
  })

  test("device with no free memory scores lower", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    const full = makeDevice({ availableMemoryBytes: 0, reservedMemoryBytes: 5_000_000_000 })
    const free = makeDevice({ availableMemoryBytes: 5_000_000_000, reservedMemoryBytes: 0 })

    expect(scoreDeviceForWorkload(full, req)).toBeLessThan(scoreDeviceForWorkload(free, req))
  })
})

// ── Memory Domain Scoring ─────────────────────────────────────────────────────

describe("scoreMemoryDomain", () => {
  test("returns higher score for domain with more free capacity", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    const full = makeDomain({ totalBytes: 1000, usedBytes: 900 })
    const empty = makeDomain({ totalBytes: 1000, usedBytes: 0 })

    expect(scoreMemoryDomain(empty, req)).toBeGreaterThan(scoreMemoryDomain(full, req))
  })

  test("returns score in [0, 1]", () => {
    const req = createPlacementRequest("req-1", "route-1", "decode", "digest-a", "digest-tok", 512, 256)
    const domain = makeDomain({})

    const score = scoreMemoryDomain(domain, req)

    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})

// ── Transfer Cost Scoring ─────────────────────────────────────────────────────

describe("scoreTransferCost", () => {
  test("returns 0 for unavailable edge", () => {
    const edge = makeEdge({ availabilityState: "unavailable" })

    expect(scoreTransferCost(edge, 1024)).toBe(0)
  })

  test("high-bandwidth edge scores higher than low-bandwidth", () => {
    const fast = makeEdge({ measuredBandwidthBytesPerSecond: 100_000_000_000 })
    const slow = makeEdge({ measuredBandwidthBytesPerSecond: 1_000_000_000 })

    expect(scoreTransferCost(fast, 1024)).toBeGreaterThan(scoreTransferCost(slow, 1024))
  })

  test("returns score in [0, 1]", () => {
    const edge = makeEdge({})

    expect(scoreTransferCost(edge, 1024)).toBeGreaterThanOrEqual(0)
    expect(scoreTransferCost(edge, 1024)).toBeLessThanOrEqual(1)
  })
})

// ── KV Locality Scoring ───────────────────────────────────────────────────────

describe("scoreKvLocality", () => {
  test("highest score when KV exists and locality preferred", () => {
    expect(scoreKvLocality(true, true)).toBe(1.0)
  })

  test("intermediate score when KV exists but locality not preferred", () => {
    const score = scoreKvLocality(true, false)
    expect(score).toBe(0.8)
  })

  test("lowest score when no existing KV", () => {
    const score = scoreKvLocality(false, true)
    expect(score).toBe(0.5)
  })
})
