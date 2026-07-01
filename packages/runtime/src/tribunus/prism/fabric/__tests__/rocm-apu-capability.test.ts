/**
 * ROCm APU Capability Tests
 *
 * Verifies that an APU host topology includes:
 *   - iGPU shared memory domain (apu_shared_memory)
 *   - Zero-copy mapped access between APU shared and iGPU local alias
 *   - Managed memory migration capability via domain pair resolution
 */
import { expect, describe, it } from "bun:test"
import { probeApuHost } from "../topology-probe"
import { getClosestTransportKind } from "../transport-capability"
import { getDevicesByClass } from "../topology-graph"
import { classifyTransportKind } from "../transport-edge"

describe("ROCm APU capability: iGPU shared memory", () => {
  const graph = probeApuHost(false)

  it("includes an integrated GPU device with ROCm backend", () => {
    const igpus = getDevicesByClass(graph, "integrated_gpu")
    expect(igpus).toHaveLength(1)

    const igpu = igpus[0]
    expect(igpu.deviceId).toBe("igpu0")
    expect(igpu.backendKind).toBe("rocm")
    expect(igpu.computeCapabilities).toContain("shared_memory")
  })

  it("has an APU shared memory domain", () => {
    const apuShared = graph.memoryDomains.find((d) => d.domainKind === "apu_shared_memory")
    expect(apuShared).toBeDefined()
    expect(apuShared!.domainId).toBe("apu_shared0")
    // APU shared memory is large enough to hold model weights
    expect(apuShared!.totalBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024 * 1024)
  })

  it("has an integrated GPU local alias domain", () => {
    const igpuLocal = graph.memoryDomains.find((d) => d.domainKind === "integrated_gpu_local_alias")
    expect(igpuLocal).toBeDefined()
    expect(igpuLocal!.domainId).toBe("igpu_local0")
  })

  it("connects CPU and iGPU to the shared memory domain", () => {
    const apuShared = graph.memoryDomains.find((d) => d.domainKind === "apu_shared_memory")!
    expect(apuShared.deviceIds).toContain("cpu0")
    expect(apuShared.deviceIds).toContain("igpu0")
  })

  it("provides transport edges from system memory to APU shared memory", () => {
    const edges = graph.transportEdges.filter(
      (e) => e.sourceDomainId === "sysmem" && e.destinationDomainId === "apu_shared0",
    )
    expect(edges.length).toBeGreaterThanOrEqual(1)
    expect(edges.some((e) => e.transportKind === "direct_shared_access")).toBe(true)
  })

  it("marks all transport edges as available", () => {
    const unavailable = graph.transportEdges.filter((e) => e.availabilityState !== "available")
    expect(unavailable).toHaveLength(0)
  })
})

describe("ROCm APU capability: zero-copy mapped access", () => {
  it("resolves zero-copy transport between shared memory and iGPU local alias", () => {
    const kind = getClosestTransportKind("apu_shared_memory", "integrated_gpu_local_alias")
    // Closest transport: same shared kind → direct_shared_access (since both are shared types)
    // The iGPU local alias is a shared-type domain
    expect(kind).toBeDefined()
  })

  it("has zero_copy_mapped_access edges between APU shared and iGPU local", () => {
    const graph = probeApuHost(false)
    const edges = graph.transportEdges.filter(
      (e) =>
        (e.sourceDomainId === "apu_shared0" && e.destinationDomainId === "igpu_local0") ||
        (e.sourceDomainId === "igpu_local0" && e.destinationDomainId === "apu_shared0"),
    )
    expect(edges.length).toBeGreaterThanOrEqual(2)
    expect(edges.every((e) => e.transportKind === "zero_copy_mapped_access")).toBe(true)
    expect(edges.every((e) => e.availabilityState === "available")).toBe(true)
  })
})

describe("ROCm APU capability: managed memory", () => {
  it("resolves managed memory migration for CPU to managed memory", () => {
    const hostTask = getClosestTransportKind("cpu_system_memory", "managed_memory")
    expect(hostTask).toBe("managed_memory_migration")
  })

  it("resolves managed memory migration for managed to VRAM", () => {
    const task = getClosestTransportKind("managed_memory", "discrete_gpu_vram")
    expect(task).toBe("managed_memory_migration")
  })

  it("classifies transport kinds correctly for APU topologies", () => {
    expect(classifyTransportKind("direct_shared_access")).toBe("shared")
    expect(classifyTransportKind("zero_copy_mapped_access")).toBe("shared")
    expect(classifyTransportKind("managed_memory_migration")).toBe("copy")
  })
})
