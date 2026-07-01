/**
 * Prism Heterogeneous Memory Fabric — ROCm APU Adapter
 *
 * Shared-memory adapter for AMD APU devices where the CPU and integrated GPU
 * share a unified memory domain. Supports direct shared access and zero-copy
 * mapped access between CPU and iGPU domains.
 */

import type {
  PrismMemoryFabricAdapter,
  PrismTopologyGraph,
  PrismMemoryDomainInfo,
  PrismMemoryTransportEdge,
  PrismComputeDevice,
  PrismApuSharedMemoryProfile,
} from "../fabric-types"

import { AdapterError } from "../fabric-errors"

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALLOCATIONS = new Map<string, { domainId: string; bytes: number }>()

let allocationCounter = 0
let transferCounter = 0

function defaultCpuDevice(): PrismComputeDevice {
  return {
    deviceId: "apu_cpu_0",
    deviceClass: "cpu",
    backendKind: "cpu_native",
    targetCapabilitySignature: "apu_rocm_v1",
    memoryDomainIds: ["apu_cpu_system_0"],
    computeCapabilities: ["scalar", "simd"],
    supportedWorkloads: ["prefill", "decode", "embedding", "attention", "mlp", "norm", "postprocessing"],
    availableMemoryBytes: 14_000_000_000,
    reservedMemoryBytes: 2_000_000_000,
    healthState: "healthy",
  }
}

function defaultIGpuDevice(): PrismComputeDevice {
  return {
    deviceId: "apu_igpu_0",
    deviceClass: "integrated_gpu",
    backendKind: "rocm",
    targetCapabilitySignature: "apu_rocm_v1",
    memoryDomainIds: ["apu_cpu_system_0", "apu_igpu_local_0"],
    computeCapabilities: ["matrix", "simd", "tensor"],
    supportedWorkloads: ["prefill", "decode", "attention", "mlp", "norm", "embedding"],
    availableMemoryBytes: 8_000_000_000,
    reservedMemoryBytes: 0,
    healthState: "healthy",
  }
}

function buildTopology(): PrismTopologyGraph {
  return {
    hostInstanceId: "rocm_apu_host",
    topologyGeneration: 1,
    discoveredAt: new Date().toISOString(),
    devices: [defaultCpuDevice(), defaultIGpuDevice()],
    memoryDomains: [
      {
        domainId: "apu_cpu_system_0",
        domainKind: "cpu_system_memory",
        deviceIds: ["apu_cpu_0", "apu_igpu_0"],
        totalBytes: 16_000_000_000,
        usedBytes: 0,
        reservedBytes: 2_000_000_000,
        allocationGranularity: 4096,
      },
      {
        domainId: "apu_igpu_local_0",
        domainKind: "integrated_gpu_local_alias",
        deviceIds: ["apu_igpu_0"],
        totalBytes: 8_000_000_000,
        usedBytes: 0,
        reservedBytes: 0,
        allocationGranularity: 256,
      },
      {
        domainId: "apu_shared_0",
        domainKind: "apu_shared_memory",
        deviceIds: ["apu_cpu_0", "apu_igpu_0"],
        totalBytes: 8_000_000_000,
        usedBytes: 0,
        reservedBytes: 0,
        allocationGranularity: 4096,
      },
    ],
    transportEdges: [
      {
        edgeId: "apu_cpu_to_shared",
        sourceDomainId: "apu_cpu_system_0",
        destinationDomainId: "apu_shared_0",
        transportKind: "direct_shared_access",
        accessMode: "read_write",
        coherencyMode: "coherent",
        maximumBytes: 8_000_000_000,
        measuredBandwidthBytesPerSecond: null,
        measuredLatencyMicroseconds: null,
        supportsAsync: true,
        supportsCancellation: true,
        supportsIntegrityValidation: true,
        availabilityState: "available",
      },
      {
        edgeId: "apu_igpu_to_shared",
        sourceDomainId: "apu_igpu_local_0",
        destinationDomainId: "apu_shared_0",
        transportKind: "zero_copy_mapped_access",
        accessMode: "read_write",
        coherencyMode: "io_coherent",
        maximumBytes: 8_000_000_000,
        measuredBandwidthBytesPerSecond: null,
        measuredLatencyMicroseconds: null,
        supportsAsync: true,
        supportsCancellation: false,
        supportsIntegrityValidation: true,
        availabilityState: "available",
      },
    ],
    interconnects: [
      {
        interconnectId: "apu_cpu_igpu_fabric",
        sourceDeviceId: "apu_cpu_0",
        destinationDeviceId: "apu_igpu_0",
        interconnectType: "fabric",
        bandwidthBytesPerSecond: null,
        latencyMicroseconds: null,
        hops: 1,
      },
    ],
    capabilitySignatures: ["apu_rocm_v1"],
    measuredBandwidthClasses: [
      { className: "apu_shared", minimumBytesPerSecond: 20_000_000_000, maximumBytesPerSecond: 80_000_000_000 },
    ],
    measuredLatencyClasses: [
      { className: "apu_latency", minimumMicroseconds: 0.1, maximumMicroseconds: 0.5 },
    ],
    policyRestrictions: [],
  }
}

// ── Exported Helper Functions ─────────────────────────────────────────────────

export function createApuProfile(
  cpuId: string,
  iGpuId: string,
  memBytes: number,
): PrismApuSharedMemoryProfile {
  return {
    profileId: `apu_profile_${cpuId}_${iGpuId}`,
    cpuDeviceId: cpuId,
    integratedGpuDeviceId: iGpuId,
    npuDeviceId: null,
    sharedMemoryDomainId: `apu_shared_${cpuId}_${iGpuId}`,
    supportsCpuGpuDirectSharedAccess: true,
    supportsZeroCopyMappedAccess: true,
    supportsManagedMemory: false,
    supportsNpuSharedAccess: false,
    maximumSharedAllocationBytes: memBytes,
    allocationGranularity: 4096,
    coherencyRequirements: ["io_coherent"],
    synchronizationRequirements: ["queue_signal", "fence"],
    bandwidthClass: "apu_shared",
    latencyClass: "apu_latency",
  }
}

export function isApuProfileComplete(profile: PrismApuSharedMemoryProfile): boolean {
  return (
    profile.profileId.length > 0 &&
    profile.cpuDeviceId.length > 0 &&
    profile.integratedGpuDeviceId.length > 0 &&
    profile.sharedMemoryDomainId.length > 0 &&
    profile.maximumSharedAllocationBytes > 0 &&
    profile.allocationGranularity > 0 &&
    profile.supportsCpuGpuDirectSharedAccess !== undefined &&
    profile.supportsZeroCopyMappedAccess !== undefined
  )
}

export function canApuUseDirectSharedAccess(profile: PrismApuSharedMemoryProfile): boolean {
  return profile.supportsCpuGpuDirectSharedAccess && profile.maximumSharedAllocationBytes > 0
}

export function canApuUseZeroCopy(profile: PrismApuSharedMemoryProfile): boolean {
  return profile.supportsZeroCopyMappedAccess && profile.maximumSharedAllocationBytes > 0
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class RocmApuFabricAdapter implements PrismMemoryFabricAdapter {
  private topology: PrismTopologyGraph | null = null

  static createApuProfile(
    cpuId: string,
    iGpuId: string,
    sharedDomainId: string,
  ): PrismApuSharedMemoryProfile {
    return {
      profileId: `apu_profile_${cpuId}_${iGpuId}`,
      cpuDeviceId: cpuId,
      integratedGpuDeviceId: iGpuId,
      npuDeviceId: null,
      sharedMemoryDomainId: sharedDomainId,
      supportsCpuGpuDirectSharedAccess: true,
      supportsZeroCopyMappedAccess: true,
      supportsManagedMemory: false,
      supportsNpuSharedAccess: false,
      maximumSharedAllocationBytes: 8_000_000_000,
      allocationGranularity: 4096,
      coherencyRequirements: ["io_coherent"],
      synchronizationRequirements: ["queue_signal", "fence"],
      bandwidthClass: "apu_shared",
      latencyClass: "apu_latency",
    }
  }

  async probeTopology(): Promise<PrismTopologyGraph> {
    this.topology = buildTopology()
    return this.topology
  }

  listMemoryDomains(): PrismMemoryDomainInfo[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "rocm_apu")
    return this.topology.memoryDomains
  }

  listTransportEdges(): PrismMemoryTransportEdge[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "rocm_apu")
    return this.topology.transportEdges
  }

  async allocate(domainId: string, bytes: number): Promise<string> {
    const domain = this.topology?.memoryDomains.find((d) => d.domainId === domainId)
    if (!domain) throw new AdapterError(`Unknown domain: ${domainId}`, "rocm_apu")
    if (bytes > domain.totalBytes - domain.usedBytes - domain.reservedBytes) {
      throw new AdapterError(`Insufficient memory in domain: ${domainId}`, "rocm_apu")
    }
    const id = `rocm_apu_alloc_${++allocationCounter}`
    ALLOCATIONS.set(id, { domainId, bytes })
    return id
  }

  async mapShared(domainId: string, allocationId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "rocm_apu")
    // APU shared memory domains support mapping across CPU and iGPU
    return (
      domainId === "apu_shared_0" ||
      domainId === "apu_cpu_system_0" ||
      domainId === "apu_igpu_local_0"
    )
  }

  async stageForTransfer(allocationId: string, destinationDomainId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "rocm_apu")
    const edge = this.topology?.transportEdges.find(
      (e) => e.destinationDomainId === destinationDomainId,
    )
    return edge !== undefined && edge.availabilityState !== "unavailable"
  }

  async transfer(sourceAllocationId: string, destinationDomainId: string, _plan: string): Promise<number> {
    const alloc = ALLOCATIONS.get(sourceAllocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${sourceAllocationId}`, "rocm_apu")
    const edge = this.topology?.transportEdges.find(
      (e) =>
        e.sourceDomainId === alloc.domainId && e.destinationDomainId === destinationDomainId,
    )
    if (!edge || edge.availabilityState === "unavailable") {
      throw new AdapterError(
        `No available transport from ${alloc.domainId} to ${destinationDomainId}`,
        "rocm_apu",
      )
    }
    return ++transferCounter
  }

  async synchronize(_transferId: string): Promise<boolean> {
    return true
  }

  async release(allocationId: string): Promise<boolean> {
    if (!ALLOCATIONS.has(allocationId)) return false
    ALLOCATIONS.delete(allocationId)
    return true
  }

  async measurePath(edge: PrismMemoryTransportEdge): Promise<Partial<PrismMemoryTransportEdge>> {
    const isZeroCopy = edge.transportKind === "zero_copy_mapped_access"
    return {
      edgeId: edge.edgeId,
      measuredBandwidthBytesPerSecond: isZeroCopy ? 40_000_000_000 : 50_000_000_000,
      measuredLatencyMicroseconds: isZeroCopy ? 0.3 : 0.15,
      availabilityState: "available",
    }
  }
}
