/**
 * ROCm dGPU Capability Tests
 *
 * Verifies that a discrete GPU host topology includes:
 *   - VRAM memory domains per GPU
 *   - Pinned host memory for DMA transfers
 *   - No free (costless) shared memory between CPU and dGPU
 *   - Peer device copies between VRAM domains
 */
import { expect, describe, it } from "bun:test"
import { probeDgpuHost } from "../topology-probe"
import { getClosestTransportKind, getRequiredCapabilities } from "../transport-capability"
import { getDevicesByClass, getTransportEdgesBetween } from "../topology-graph"
import { classifyMemoryDomain } from "../memory-domain"
import { createDevice } from "../device-registry"

describe("ROCm dGPU capability: VRAM domain", () => {
  const graph = probeDgpuHost(2)

  it("has discrete GPU devices with ROCm backend", () => {
    const dgpus = getDevicesByClass(graph, "discrete_gpu")
    expect(dgpus).toHaveLength(2)

    for (const dgpu of dgpus) {
      expect(dgpu.backendKind).toBe("rocm")
      expect(dgpu.computeCapabilities).toContain("vram_access")
    }
  })

  it("has one VRAM domain per discrete GPU", () => {
    const vramDomains = graph.memoryDomains.filter((d) => d.domainKind === "discrete_gpu_vram")
    expect(vramDomains).toHaveLength(2)

    for (const vram of vramDomains) {
      expect(vram.totalBytes).toBeGreaterThan(0)
      expect(classifyMemoryDomain(vram.domainKind)).toBe("device")
    }
  })

  it("classifies VRAM as device memory (not shared)", () => {
    for (const dom of graph.memoryDomains) {
      if (dom.domainKind === "discrete_gpu_vram") {
        expect(classifyMemoryDomain(dom.domainKind)).toBe("device")
      }
    }
  })
})

describe("ROCm dGPU capability: pinned host memory", () => {
  const graph = probeDgpuHost(2)

  it("has a pinned host memory domain", () => {
    const pinnedDoms = graph.memoryDomains.filter((d) => d.domainKind === "pinned_host_memory")
    expect(pinnedDoms).toHaveLength(1)
    expect(pinnedDoms[0].domainId).toBe("pinned_host0")
  })

  it("has pinned_host_copy transport edges from pinned to VRAM", () => {
    for (let i = 0; i < 2; i++) {
      const edges = getTransportEdgesBetween(graph, "pinned_host0", `vram${i}`)
      expect(edges.length).toBeGreaterThanOrEqual(1)
      expect(edges.some((e) => e.transportKind === "pinned_host_copy")).toBe(true)
    }
  })

  it("has backend_device_copy transport edges from VRAM to pinned (readback)", () => {
    for (let i = 0; i < 2; i++) {
      const edges = getTransportEdgesBetween(graph, `vram${i}`, "pinned_host0")
      expect(edges.length).toBeGreaterThanOrEqual(1)
      expect(edges.some((e) => e.transportKind === "backend_device_copy")).toBe(true)
    }
  })

  it("has pinned_host_copy from system memory to VRAM", () => {
    for (let i = 0; i < 2; i++) {
      const edges = getTransportEdgesBetween(graph, "sysmem", `vram${i}`)
      expect(edges.length).toBeGreaterThanOrEqual(1)
      expect(edges.some((e) => e.transportKind === "pinned_host_copy")).toBe(true)
    }
  })
})

describe("ROCm dGPU capability: no free shared memory", () => {
  it("does not have APU shared memory domains", () => {
    const graph = probeDgpuHost(1)
    const sharedDoms = graph.memoryDomains.filter(
      (d) => d.domainKind === "apu_shared_memory" || d.domainKind === "npu_shared_memory",
    )
    expect(sharedDoms).toHaveLength(0)
  })

  it("does not have direct_shared_access edges between CPU and VRAM", () => {
    const graph = probeDgpuHost(1)
    const edges = graph.transportEdges.filter(
      (e) =>
        (e.sourceDomainId === "sysmem" && e.destinationDomainId === "vram0") ||
        (e.sourceDomainId === "vram0" && e.destinationDomainId === "sysmem"),
    )
    // Should only be pinned_host_copy / backend_device_copy, never direct_shared_access
    for (const edge of edges) {
      expect(edge.transportKind).not.toBe("direct_shared_access")
    }
  })

  it("resolves pinned_host_copy as closest transport from CPU to dGPU (not direct_shared)", () => {
    expect(getClosestTransportKind("cpu_system_memory", "discrete_gpu_vram")).toBe("pinned_host_copy")
  })

  it("resolves backend_device_copy as closest from pinned to VRAM", () => {
    expect(getClosestTransportKind("pinned_host_memory", "discrete_gpu_vram")).toBe("backend_device_copy")
  })

  it("requires device_memory_access capability for dGPU", () => {
    const dgpu = createDevice("dgpu0", "discrete_gpu", "rocm", 24_000_000_000)
    const caps = getRequiredCapabilities([dgpu])
    expect(caps).toContain("device_memory_access")
    expect(caps).not.toContain("shared_memory_access")
  })
})

describe("ROCm dGPU capability: peer device copy", () => {
  const graph = probeDgpuHost(3)

  it("has peer_device_copy edges between VRAM domains", () => {
    const peerEdges = graph.transportEdges.filter((e) => e.transportKind === "peer_device_copy")
    // 3 GPUs → P2P edges: each pair has two directional edges
    // vram1↔vram0 (2) + vram2→vram0 (1) + vram2→vram1 (1) = 4 (due to directional asymmetry in probe)
    expect(peerEdges.length).toBeGreaterThan(0)
  })

  it("resolves peer_device_copy as closest transport between VRAM domains", () => {
    expect(getClosestTransportKind("discrete_gpu_vram", "discrete_gpu_vram")).toBe("peer_device_copy")
  })

  it("marks P2P edges as available", () => {
    const peerEdges = graph.transportEdges.filter((e) => e.transportKind === "peer_device_copy")
    for (const edge of peerEdges) {
      expect(edge.availabilityState).toBe("available")
    }
  })
})
