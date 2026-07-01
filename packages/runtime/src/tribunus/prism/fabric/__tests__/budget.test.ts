/**
 * Prism Fabric — Budget Tests
 *
 * Tests for allocation limits, transfer overload prevention, and memory
 * pressure detection.
 */

import { expect, test, describe } from "bun:test"
import {
  createFabricMemoryBudget,
  checkAllocationWithinBudget,
  checkTransferBudget,
  isMemoryPressureCritical,
} from "../memory-budget"

import type { PrismMemoryDomainInfo } from "../fabric-types"

// ── Factory ───────────────────────────────────────────────────────────────────

describe("createFabricMemoryBudget", () => {
  test("creates budget with sensible defaults", () => {
    const budget = createFabricMemoryBudget()

    expect(budget.apuSharedMemoryLimit).toBeGreaterThan(0)
    expect(budget.apuCpuReserve).toBeGreaterThan(0)
    expect(budget.apuIntegratedGpuReserve).toBeGreaterThan(0)
    expect(budget.maximumInflightTransfers).toBeGreaterThan(0)
    expect(budget.maximumInflightHandoffs).toBeGreaterThan(0)
    expect(budget.emergencyReclaimThreshold).toBeGreaterThan(0)
    expect(budget.emergencyReclaimThreshold).toBeLessThan(1)
  })

  test("dGPU and accelerator limits start empty", () => {
    const budget = createFabricMemoryBudget()
    expect(Object.keys(budget.dGpuVramLimits).length).toBe(0)
    expect(Object.keys(budget.acceleratorDramLimits).length).toBe(0)
  })
})

// ── Allocation Within Limits ──────────────────────────────────────────────────

describe("checkAllocationWithinBudget", () => {
  test("allows allocation within APU shared limit", () => {
    const budget = createFabricMemoryBudget()
    budget.apuSharedMemoryLimit = 1_000_000_000 // 1 GB

    const result = checkAllocationWithinBudget(budget, "apu_shared_memory", 500_000_000)

    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("disallows allocation exceeding APU shared limit", () => {
    const budget = createFabricMemoryBudget()
    budget.apuSharedMemoryLimit = 1_000_000_000

    const result = checkAllocationWithinBudget(budget, "apu_shared_memory", 2_000_000_000)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("exceeds")
  })

  test("allows allocation within pinned host staging limit", () => {
    const budget = createFabricMemoryBudget()
    budget.pinnedHostStagingLimit = 500_000_000

    const result = checkAllocationWithinBudget(budget, "pinned_host_memory", 250_000_000)

    expect(result.allowed).toBe(true)
  })

  test("disallows zero or negative allocation", () => {
    const budget = createFabricMemoryBudget()

    const result = checkAllocationWithinBudget(budget, "apu_shared_memory", -100)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("positive")
  })

  test("unbounded domain kinds have no limit", () => {
    const budget = createFabricMemoryBudget()

    // cpu_system_memory has no explicit budget cap
    const result = checkAllocationWithinBudget(budget, "cpu_system_memory", 1_000_000_000_000)

    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("disallows allocation exceeding NPU reserve", () => {
    const budget = createFabricMemoryBudget()
    budget.apuNpuReserve = 256_000_000

    const result = checkAllocationWithinBudget(budget, "npu_shared_memory", 500_000_000)

    expect(result.allowed).toBe(false)
  })

  test("dGPU VRAM uses highest known limit when no per-device limit", () => {
    const budget = createFabricMemoryBudget()
    budget.dGpuVramLimits["dgpu-0"] = 16_000_000_000

    const result = checkAllocationWithinBudget(budget, "discrete_gpu_vram", 8_000_000_000)

    expect(result.allowed).toBe(true)
  })
})

// ── Transfer Overload Prevention ──────────────────────────────────────────────

describe("checkTransferBudget", () => {
  test("allows when within limits", () => {
    const budget = createFabricMemoryBudget()

    const result = checkTransferBudget(budget, 1, 1)

    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("disallows when inflight transfers exceed maximum", () => {
    const budget = createFabricMemoryBudget()
    budget.maximumInflightTransfers = 2

    const result = checkTransferBudget(budget, 5, 0)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Inflight transfers")
  })

  test("disallows when inflight handoffs exceed maximum", () => {
    const budget = createFabricMemoryBudget()
    budget.maximumInflightHandoffs = 1

    const result = checkTransferBudget(budget, 0, 3)

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Inflight handoffs")
  })
})

// ── Memory Pressure ───────────────────────────────────────────────────────────

describe("isMemoryPressureCritical", () => {
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

  test("returns false when pressure is below threshold", () => {
    const domain = makeDomain({ totalBytes: 1000, usedBytes: 300, reservedBytes: 100 })

    expect(isMemoryPressureCritical(domain, 0.9)).toBe(false)
  })

  test("returns true when pressure meets threshold", () => {
    const domain = makeDomain({ totalBytes: 1000, usedBytes: 800, reservedBytes: 100 })

    expect(isMemoryPressureCritical(domain, 0.9)).toBe(true)
  })

  test("returns true when pressure exceeds threshold", () => {
    const domain = makeDomain({ totalBytes: 1000, usedBytes: 900, reservedBytes: 90 })

    expect(isMemoryPressureCritical(domain, 0.8)).toBe(true)
  })

  test("returns true when total is zero (edge case)", () => {
    const domain = makeDomain({ totalBytes: 0 })

    expect(isMemoryPressureCritical(domain, 0.9)).toBe(true)
  })
})
