/**
 * Prism Fabric — KV Residency Tests
 *
 * Tests for policy defaults, device class mapping, and migration decisions.
 */

import { expect, test, describe } from "bun:test"
import {
  createDefaultKvResidencyPolicy,
  createAllowAllResidencyPolicy,
  canResideOnDevice,
  shouldMigrateKv,
} from "../residency-policy"

import { getPreferredResidency, resolveKvResidencyAfterHandoff } from "../kv-residency"

import type { PrismMemoryTransportEdge } from "../fabric-types"

// ── Policy Defaults ───────────────────────────────────────────────────────────

describe("createDefaultKvResidencyPolicy", () => {
  test("prefers existing locality", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(policy.preferExistingLocality).toBe(true)
  })

  test("allows APU shared residency but not dGPU", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(policy.allowApuSharedResidency).toBe(true)
    expect(policy.allowDgpuResidency).toBe(false)
  })

  test("allows local host handoff", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(policy.allowLocalHostHandoff).toBe(true)
  })

  test("disallows export to staging by default", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(policy.allowExportToStaging).toBe(false)
  })

  test("sets sensible defaults", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(policy.maximumStagingBytes).toBeGreaterThan(0)
    expect(policy.retentionDurationMs).toBeGreaterThan(0)
    expect(policy.migrationThreshold).toBeGreaterThan(0)
  })
})

describe("createAllowAllResidencyPolicy", () => {
  test("allows everything", () => {
    const policy = createAllowAllResidencyPolicy()
    expect(policy.allowApuSharedResidency).toBe(true)
    expect(policy.allowDgpuResidency).toBe(true)
    expect(policy.allowExportToStaging).toBe(true)
    expect(policy.allowLocalHostHandoff).toBe(true)
    expect(policy.allowBackendNativeImport).toBe(true)
  })

  test("higher staging limit than default", () => {
    const def = createDefaultKvResidencyPolicy()
    const all = createAllowAllResidencyPolicy()
    expect(all.maximumStagingBytes).toBeGreaterThan(def.maximumStagingBytes)
  })
})

// ── Device Class Mapping ──────────────────────────────────────────────────────

describe("canResideOnDevice", () => {
  test("CPU always allowed by any policy", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(canResideOnDevice(policy, "cpu")).toBe(true)
  })

  test("integrated_gpu allowed when APU shared residency enabled", () => {
    const policy = createDefaultKvResidencyPolicy()
    policy.allowApuSharedResidency = false

    expect(canResideOnDevice(policy, "integrated_gpu")).toBe(false)
  })

  test("discrete_gpu allowed only when dGPU residency enabled", () => {
    const strict = createDefaultKvResidencyPolicy()
    const permissive = createAllowAllResidencyPolicy()

    expect(canResideOnDevice(strict, "discrete_gpu")).toBe(false)
    expect(canResideOnDevice(permissive, "discrete_gpu")).toBe(true)
  })

  test("accelerator requires export to staging", () => {
    const strict = createDefaultKvResidencyPolicy()
    const permissive = createAllowAllResidencyPolicy()

    expect(canResideOnDevice(strict, "accelerator")).toBe(false)
    expect(canResideOnDevice(permissive, "accelerator")).toBe(true)
  })

  test("NPU mapped via APU shared residency", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(canResideOnDevice(policy, "npu")).toBe(true)

    policy.allowApuSharedResidency = false
    expect(canResideOnDevice(policy, "npu")).toBe(false)
  })
})

// ── Migration Decisions ───────────────────────────────────────────────────────

describe("shouldMigrateKv", () => {
  test("does not migrate from CPU system memory by default", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(shouldMigrateKv("cpu_system_memory", policy)).toBe(false)
  })

  test("migrates from dGPU vram when default policy disallows dGPU", () => {
    const policy = createDefaultKvResidencyPolicy()
    expect(shouldMigrateKv("discrete_gpu_vram", policy)).toBe(true)
  })

  test("does not migrate from dGPU vram when allow-all policy", () => {
    const policy = createAllowAllResidencyPolicy()
    expect(shouldMigrateKv("discrete_gpu_vram", policy)).toBe(false)
  })

  test("migrates from APU shared when threshold <= 0.6", () => {
    const policy = createDefaultKvResidencyPolicy()
    policy.migrationThreshold = 0.5
    expect(shouldMigrateKv("apu_shared_memory", policy)).toBe(true)
  })

  test("does not migrate from APU shared when threshold > 0.6", () => {
    const policy = createDefaultKvResidencyPolicy()
    policy.migrationThreshold = 0.7
    expect(shouldMigrateKv("apu_shared_memory", policy)).toBe(false)
  })
})

// ── Preferred Residency ───────────────────────────────────────────────────────

describe("getPreferredResidency", () => {
  test("cpu → cpu_system_memory", () => {
    expect(getPreferredResidency("cpu")).toBe("cpu_system_memory")
  })

  test("integrated_gpu → apu_shared_memory", () => {
    expect(getPreferredResidency("integrated_gpu")).toBe("apu_shared_memory")
  })

  test("discrete_gpu → discrete_gpu_vram", () => {
    expect(getPreferredResidency("discrete_gpu")).toBe("discrete_gpu_vram")
  })

  test("npu → npu_shared_memory", () => {
    expect(getPreferredResidency("npu")).toBe("npu_shared_memory")
  })
})

// ── Handoff Residency Resolution ──────────────────────────────────────────────

describe("resolveKvResidencyAfterHandoff", () => {
  function makeEdge(overrides: Partial<PrismMemoryTransportEdge>): PrismMemoryTransportEdge {
    return {
      edgeId: "e1",
      sourceDomainId: "src-1",
      destinationDomainId: "dst-1",
      transportKind: "direct_shared_access",
      accessMode: "read_write",
      coherencyMode: "coherent",
      maximumBytes: 8_000_000_000,
      measuredBandwidthBytesPerSecond: null,
      measuredLatencyMicroseconds: null,
      supportsAsync: false,
      supportsCancellation: false,
      supportsIntegrityValidation: false,
      availabilityState: "available",
      ...overrides,
    }
  }

 const dgpuDomains = [
   {
     domainId: "dst-1",
     domainKind: "discrete_gpu_vram" as const,
     deviceIds: ["dgpu-1"],
     totalBytes: 16_000_000_000,
     usedBytes: 4_000_000_000,
     reservedBytes: 1_000_000_000,
     allocationGranularity: 65536,
   },
 ]

  test("uses destination kind when direct path available", () => {
    const edges = [makeEdge({})]

   const result = resolveKvResidencyAfterHandoff("apu_shared_memory", "discrete_gpu_vram", edges, dgpuDomains)

    expect(result).toBe("discrete_gpu_vram")
  })

  test("falls back to pinned host memory when no direct path but some edges available", () => {
    const edges = [makeEdge({ destinationDomainId: "other", availabilityState: "available" })]

   const result = resolveKvResidencyAfterHandoff("apu_shared_memory", "discrete_gpu_vram", edges, dgpuDomains)

    expect(result).toBe("pinned_host_memory")
  })

  test("stays at source when no viable edges at all", () => {
   const result = resolveKvResidencyAfterHandoff("apu_shared_memory", "discrete_gpu_vram", [], dgpuDomains)

    expect(result).toBe("apu_shared_memory")
  })
})
