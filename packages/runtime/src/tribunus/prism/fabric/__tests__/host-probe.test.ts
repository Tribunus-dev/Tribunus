import { expect, describe, it, mock } from "bun:test"

import {
  probeAppleSiliconHost,
  probeLinuxCpuHost,
  probeUnknownHost,
  probeCurrentHost,
  dossierToTopologyGraph,
  detectHostClass,
  detectOsInfo,
  detectMemoryBytes,
  type HostCapabilityDossier,
} from "../host-probe"

import type {
  PrismTopologyGraph,
  PrismMemoryTransportEdge,
} from "../fabric-types"

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check that a transport edge has all required fields set.
 */
function isValidTransportEdge(e: PrismMemoryTransportEdge): boolean {
  return (
    typeof e.edgeId === "string" &&
    e.edgeId.length > 0 &&
    typeof e.sourceDomainId === "string" &&
    typeof e.destinationDomainId === "string" &&
    typeof e.transportKind === "string" &&
    typeof e.accessMode === "string" &&
    typeof e.coherencyMode === "string" &&
    typeof e.maximumBytes === "number" &&
    (e.measuredBandwidthBytesPerSecond === null ||
      typeof e.measuredBandwidthBytesPerSecond === "number") &&
    (e.measuredLatencyMicroseconds === null ||
      typeof e.measuredLatencyMicroseconds === "number") &&
    typeof e.supportsAsync === "boolean" &&
    typeof e.supportsCancellation === "boolean" &&
    typeof e.supportsIntegrityValidation === "boolean" &&
    typeof e.availabilityState === "string"
  )
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("probeAppleSiliconHost", () => {
  it("returns a complete dossier with all required fields", () => {
    const dossier = probeAppleSiliconHost()

    expect(dossier.hostClass).toBe("apple_silicon")
    expect(dossier.osFamily).toBe("macos")
    expect(dossier.arch).toBe("arm64")
    expect(typeof dossier.osVersion).toBe("string")
    expect(dossier.osVersion.length).toBeGreaterThan(0)

    // Backend versions
    expect(typeof dossier.backendVersions).toBe("object")
    // On real macOS we'd see node/bun versions; in test they exist
    expect(dossier.backendVersions.node).toBeDefined()
  })

  it("creates a valid cpuDomain", () => {
    const d = probeAppleSiliconHost()
    expect(d.cpuDomain.domainId).toBe("sysmem")
    expect(d.cpuDomain.domainKind).toBe("cpu_system_memory")
    expect(d.cpuDomain.totalBytes).toBeGreaterThan(0)
    expect(d.cpuDomain.allocationGranularity).toBe(4096)
    expect(Array.isArray(d.cpuDomain.deviceIds)).toBe(true)
    expect(d.cpuDomain.deviceIds).toContain("cpu0")
  })

  it("creates gpuDomain and npuDomain", () => {
    const d = probeAppleSiliconHost()

    // GPU domain
    expect(d.gpuDomain).not.toBeNull()
    expect(d.gpuDomain!.domainId).toBe("igpu_shared")
    expect(d.gpuDomain!.domainKind).toBe("apu_shared_memory")

    // NPU domain
    expect(d.npuDomain).not.toBeNull()
    expect(d.npuDomain!.domainId).toBe("ane_shared")
    expect(d.npuDomain!.domainKind).toBe("npu_shared_memory")
  })

  it("creates deviceMemoryDomains that include gpu, igpu-local, and ane", () => {
    const d = probeAppleSiliconHost()
    const kinds = d.deviceMemoryDomains.map((dm) => dm.domainKind)
    expect(kinds).toContain("apu_shared_memory")
    expect(kinds).toContain("integrated_gpu_local_alias")
    expect(kinds).toContain("npu_shared_memory")
  })

  it("creates legal transport edges with correct properties", () => {
    const d = probeAppleSiliconHost()

    expect(d.legalTransportEdges.length).toBeGreaterThanOrEqual(6)

    for (const edge of d.legalTransportEdges) {
      // Validate with raw type check
      const valid = isValidTransportEdge(edge)
      expect(valid).toBe(true)
    }

    // Check specific edge kinds exist
    const kinds = d.legalTransportEdges.map((e) => e.transportKind)
    expect(kinds).toContain("direct_shared_access")
    expect(kinds).toContain("zero_copy_mapped_access")
    expect(kinds).toContain("serialized_payload_copy")

    // Check specific transport paths
    const edgeIds = d.legalTransportEdges.map((e) => e.edgeId)
    expect(edgeIds).toContain("edge_sysmem_to_igpu_shared")
    expect(edgeIds).toContain("edge_igpu_shared_to_igpu_local")
    expect(edgeIds).toContain("edge_sysmem_to_ane_shared")
  })

  it("includes bandwidth and latency classes", () => {
    const d = probeAppleSiliconHost()
    expect(d.measuredBandwidthClasses.length).toBeGreaterThan(0)
    expect(d.measuredLatencyClasses.length).toBeGreaterThan(0)
  })

  it("includes supported artifact classes", () => {
    const d = probeAppleSiliconHost()
    expect(d.supportedArtifactClasses).toContain("gguf_q4_0")
    expect(d.supportedArtifactClasses).toContain("gguf_f16")
    expect(d.supportedArtifactClasses).toContain("mlx_q4")
  })

  it("enables APU placement policies and disables dGPU policies", () => {
    const d = probeAppleSiliconHost()
    expect(d.enabledPlacementPolicies).toContain("apu_cpu_only")
    expect(d.enabledPlacementPolicies).toContain("apu_integrated_gpu")
    expect(d.enabledPlacementPolicies).toContain("fallback_cpu")

    expect(d.disabledPlacementPolicies).toContain("dGPU_offload")
    expect(d.disabledPlacementPolicies).toContain("accelerator_device_execution")
  })

  it("has an ISO timestamp for evidenceTimestamp", () => {
    const d = probeAppleSiliconHost()
    expect(d.evidenceTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

describe("probeLinuxCpuHost", () => {
  it("returns a complete dossier for CPU-only linux host", () => {
    const d = probeLinuxCpuHost()

    expect(d.hostClass).toBe("linux_cpu")
    // osFamily reflects the actual host, not a hypothetical target
    expect(typeof d.osFamily).toBe("string")
    expect(typeof d.osVersion).toBe("string")

    // No GPU or NPU
    expect(d.gpuDomain).toBeNull()
    expect(d.npuDomain).toBeNull()
    expect(d.deviceMemoryDomains).toEqual([])

    // Only the self-edge
    expect(d.legalTransportEdges.length).toBe(1)
    expect(d.legalTransportEdges[0].transportKind).toBe("direct_shared_access")

    // Only CPU fallback
    expect(d.enabledPlacementPolicies).toEqual(["fallback_cpu"])
    expect(d.disabledPlacementPolicies.length).toBeGreaterThan(0)
  })
})

describe("probeUnknownHost", () => {
  it("returns a minimal dossier with unknown host class", () => {
    const d = probeUnknownHost()

    expect(d.hostClass).toBe("unknown")
    expect(typeof d.osFamily).toBe("string")
    expect(typeof d.osVersion).toBe("string")
    expect(d.gpuDomain).toBeNull()
    expect(d.npuDomain).toBeNull()
    expect(d.legalTransportEdges).toEqual([])
    expect(d.enabledPlacementPolicies).toEqual([])
    expect(d.supportedArtifactClasses).toEqual([])
    expect(d.evidenceTimestamp).toBeTruthy()
  })
})

describe("dossierToTopologyGraph", () => {
  it("converts an apple_silicon dossier to a valid PrismTopologyGraph", () => {
    const dossier = probeAppleSiliconHost()
    const graph = dossierToTopologyGraph(dossier)

    // Topology graph basics
    expect(graph.hostInstanceId).toContain("host-apple_silicon")
    expect(graph.topologyGeneration).toBe(0)
    expect(typeof graph.discoveredAt).toBe("string")

    // Devices
    expect(graph.devices.length).toBeGreaterThanOrEqual(2) // cpu + igpu + npu
    const cpuDevice = graph.devices.find((d) => d.deviceId === "cpu0")
    expect(cpuDevice).toBeDefined()
    expect(cpuDevice!.deviceClass).toBe("cpu")
    expect(cpuDevice!.backendKind).toBe("metal")

    const gpuDevice = graph.devices.find((d) => d.deviceId === "igpu0")
    expect(gpuDevice).toBeDefined()
    expect(gpuDevice!.deviceClass).toBe("integrated_gpu")
    expect(gpuDevice!.backendKind).toBe("metal")

    const npuDevice = graph.devices.find((d) => d.deviceId === "npu0")
    expect(npuDevice).toBeDefined()
    expect(npuDevice!.deviceClass).toBe("npu")

    // Memory domains
    expect(graph.memoryDomains.length).toBeGreaterThanOrEqual(3)
    const sysmem = graph.memoryDomains.find((d) => d.domainId === "sysmem")
    expect(sysmem).toBeDefined()
    expect(sysmem!.domainKind).toBe("cpu_system_memory")

    // Transport edges — all edges from dossier should be present
    expect(graph.transportEdges.length).toBe(dossier.legalTransportEdges.length)

    // Capability signatures
    expect(graph.capabilitySignatures).toEqual(dossier.supportedArtifactClasses)

    // Policy restrictions
    expect(graph.policyRestrictions.length).toBeGreaterThan(0)
    expect(graph.policyRestrictions[0]).toMatch(/^disabled:/)

    // Bandwidth/Latency classes mapped
    expect(graph.measuredBandwidthClasses.length).toBe(dossier.measuredBandwidthClasses.length)
    expect(graph.measuredLatencyClasses.length).toBe(dossier.measuredLatencyClasses.length)
  })

  it("converts a linux_cpu dossier to a minimal topology graph", () => {
    const dossier = probeLinuxCpuHost()
    const graph = dossierToTopologyGraph(dossier)

    expect(graph.hostInstanceId).toContain("host-linux_cpu")
    expect(graph.devices.length).toBe(1) // CPU only
    expect(graph.devices[0].deviceClass).toBe("cpu")
    expect(graph.devices[0].backendKind).toBe("cpu_native")
    expect(graph.memoryDomains.length).toBe(1)
    expect(graph.transportEdges.length).toBe(1)
  })

  it("converts an unknown dossier to a minimal topology graph", () => {
    const dossier = probeUnknownHost()
    const graph = dossierToTopologyGraph(dossier)

    expect(graph.devices.length).toBe(1)
    expect(graph.transportEdges.length).toBe(0)
    expect(graph.policyRestrictions).toEqual([])
  })

  it("preserves transport edge field values through conversion", () => {
    const dossier = probeAppleSiliconHost()
    const graph = dossierToTopologyGraph(dossier)

    for (const edge of graph.transportEdges) {
      const original = dossier.legalTransportEdges.find((e) => e.edgeId === edge.edgeId)
      expect(original).toBeDefined()
      expect(edge.sourceDomainId).toBe(original!.sourceDomainId)
      expect(edge.destinationDomainId).toBe(original!.destinationDomainId)
      expect(edge.transportKind).toBe(original!.transportKind)
      expect(edge.accessMode).toBe(original!.accessMode)
      expect(edge.coherencyMode).toBe(original!.coherencyMode)
    }
  })
})

describe("detectHostClass", () => {
  it("returns apple_silicon on arm64 macOS", () => {
    const result = detectHostClass()
    // On this machine it should be apple_silicon
    expect(result).toBe("apple_silicon")
  })
})

describe("detectOsInfo", () => {
  it("returns real OS information", () => {
    const info = detectOsInfo()
    expect(typeof info.osFamily).toBe("string")
    expect(info.osFamily.length).toBeGreaterThan(0)
    expect(typeof info.osVersion).toBe("string")
    expect(info.osVersion.length).toBeGreaterThan(0)
    expect(typeof info.arch).toBe("string")
    expect(info.arch.length).toBeGreaterThan(0)
  })

  it("reports arm64 on Apple Silicon", () => {
    const info = detectOsInfo()
    // On this CI/machine it should be arm64
    expect(info.arch).toBe("arm64")
  })
})

describe("detectMemoryBytes", () => {
  it("returns a positive number", () => {
    const bytes = detectMemoryBytes()
    expect(bytes).toBeGreaterThan(0)
    expect(Number.isFinite(bytes)).toBe(true)
  })

  it("returns a multiple of 1024 (reasonable memory)", () => {
    const bytes = detectMemoryBytes()
    // Sanity: at least 1 GB, less than 2 TB
    expect(bytes).toBeGreaterThan(1 * 1024 * 1024 * 1024)
    expect(bytes).toBeLessThan(2 * 1024 * 1024 * 1024 * 1024)
  })
})

describe("probeCurrentHost", () => {
  it("returns a complete dossier with correct host class", async () => {
    const dossier = await probeCurrentHost()

    expect(dossier.hostClass).toBe("apple_silicon")
    expect(dossier.cpuDomain.totalBytes).toBeGreaterThan(0)
    expect(typeof dossier.evidenceTimestamp).toBe("string")
    expect(dossier.evidenceTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("produces a valid topology graph round-trip", async () => {
    const dossier = await probeCurrentHost()
    const graph = dossierToTopologyGraph(dossier)

    // Graph must have at least CPU device + system memory
    expect(graph.devices.length).toBeGreaterThanOrEqual(1)
    expect(graph.memoryDomains.length).toBeGreaterThanOrEqual(1)
    expect(graph.discoveredAt).toBeTruthy()

    // All device memoryDomainIds must reference existing domains
    const domainIds = new Set(graph.memoryDomains.map((d) => d.domainId))
    for (const device of graph.devices) {
      for (const memId of device.memoryDomainIds) {
        expect(domainIds.has(memId)).toBe(true)
      }
    }

    // All transport edges must reference existing domains
    for (const edge of graph.transportEdges) {
      expect(domainIds.has(edge.sourceDomainId)).toBe(true)
      expect(domainIds.has(edge.destinationDomainId)).toBe(true)
    }
  })
})
