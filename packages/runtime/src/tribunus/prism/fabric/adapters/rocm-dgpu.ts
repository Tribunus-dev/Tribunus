/**
 * Prism Heterogeneous Memory Fabric — ROCm dGPU Adapter
 *
 * Adapter for discrete AMD GPUs with dedicated VRAM. No unified shared memory;
 * transfers use pinned host staging buffers or backend device copies.
 * Managed memory migration is available on devices that support it.
 */

import type {
  PrismMemoryFabricAdapter,
  PrismTopologyGraph,
  PrismMemoryDomainInfo,
  PrismMemoryTransportEdge,
  PrismComputeDevice,
} from "../fabric-types"

import { AdapterError } from "../fabric-errors"

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALLOCATIONS = new Map<string, { domainId: string; bytes: number; deviceId: string | null }>()

let allocationCounter = 0
let transferCounter = 0

// ── Exported Helper Functions ─────────────────────────────────────────────────

export function createDgpuDevice(id: string, memBytes: number): PrismComputeDevice {
  return {
    deviceId: id,
    deviceClass: "discrete_gpu",
    backendKind: "rocm",
    targetCapabilitySignature: "dgpu_rocm_v1",
    memoryDomainIds: [`${id}_vram`, `${id}_pinned_host`],
    computeCapabilities: ["matrix", "simd", "tensor", "raytracing"],
    supportedWorkloads: ["prefill", "decode", "attention", "mlp", "norm", "embedding", "postprocessing"],
    availableMemoryBytes: memBytes,
    reservedMemoryBytes: Math.floor(memBytes * 0.05),
    healthState: "healthy",
  }
}

export function canDgpuUseManagedMemory(device: PrismComputeDevice): boolean {
  // Managed memory requires special hardware support; assume devices with
  // > 24 GiB VRAM support it (e.g., MI200+).
  return device.deviceClass === "discrete_gpu" && device.availableMemoryBytes >= 24_000_000_000
}

export function getDgpuTransportKind(
  device: PrismComputeDevice,
): "pinned_host_copy" | "backend_device_copy" | "managed_memory_migration" {
  if (canDgpuUseManagedMemory(device)) return "managed_memory_migration"
  if (device.availableMemoryBytes >= 8_000_000_000) return "pinned_host_copy"
  return "backend_device_copy"
}

// ── Device / Domain Builders ──────────────────────────────────────────────────

const DGPU_ID = "dgpu_0"
const DGPU_MEM = 32_000_000_000

function buildDevices(): PrismComputeDevice[] {
  return [
    {
      deviceId: "dgpu_host_cpu_0",
      deviceClass: "cpu",
      backendKind: "cpu_native",
      targetCapabilitySignature: "dgpu_host_v1",
      memoryDomainIds: ["dgpu_host_system_0"],
      computeCapabilities: ["scalar", "simd"],
      supportedWorkloads: ["prefill", "decode", "postprocessing", "tokenization"],
      availableMemoryBytes: 16_000_000_000,
      reservedMemoryBytes: 0,
      healthState: "healthy",
    },
    createDgpuDevice(DGPU_ID, DGPU_MEM),
  ]
}

function buildMemoryDomains(): PrismMemoryDomainInfo[] {
  return [
    {
      domainId: "dgpu_host_system_0",
      domainKind: "cpu_system_memory",
      deviceIds: ["dgpu_host_cpu_0"],
      totalBytes: 16_000_000_000,
      usedBytes: 0,
      reservedBytes: 0,
      allocationGranularity: 4096,
    },
    {
      domainId: `${DGPU_ID}_vram`,
      domainKind: "discrete_gpu_vram",
      deviceIds: [DGPU_ID],
      totalBytes: DGPU_MEM,
      usedBytes: 0,
      reservedBytes: Math.floor(DGPU_MEM * 0.05),
      allocationGranularity: 256,
    },
    {
      domainId: `${DGPU_ID}_pinned_host`,
      domainKind: "pinned_host_memory",
      deviceIds: ["dgpu_host_cpu_0"],
      totalBytes: 2_000_000_000,
      usedBytes: 0,
      reservedBytes: 0,
      allocationGranularity: 4096,
    },
  ]
}

function buildTransportEdges(): PrismMemoryTransportEdge[] {
  return [
    {
      edgeId: "dgpu_host_to_pinned",
      sourceDomainId: "dgpu_host_system_0",
      destinationDomainId: `${DGPU_ID}_pinned_host`,
      transportKind: "pinned_host_copy",
      accessMode: "read_write",
      coherencyMode: "coherent",
      maximumBytes: 2_000_000_000,
      measuredBandwidthBytesPerSecond: null,
      measuredLatencyMicroseconds: null,
      supportsAsync: true,
      supportsCancellation: false,
      supportsIntegrityValidation: true,
      availabilityState: "available",
    },
    {
      edgeId: "dgpu_pinned_to_vram",
      sourceDomainId: `${DGPU_ID}_pinned_host`,
      destinationDomainId: `${DGPU_ID}_vram`,
      transportKind: "backend_device_copy",
      accessMode: "read_write",
      coherencyMode: "non_coherent",
      maximumBytes: DGPU_MEM,
      measuredBandwidthBytesPerSecond: null,
      measuredLatencyMicroseconds: null,
      supportsAsync: true,
      supportsCancellation: true,
      supportsIntegrityValidation: true,
      availabilityState: "available",
    },
    {
      edgeId: "dgpu_host_to_vram_managed",
      sourceDomainId: "dgpu_host_system_0",
      destinationDomainId: `${DGPU_ID}_vram`,
      transportKind: "managed_memory_migration",
      accessMode: "read_write",
      coherencyMode: "managed",
      maximumBytes: DGPU_MEM,
      measuredBandwidthBytesPerSecond: null,
      measuredLatencyMicroseconds: null,
      supportsAsync: true,
      supportsCancellation: true,
      supportsIntegrityValidation: false,
      availabilityState: "available",
    },
  ]
}

function buildTopology(): PrismTopologyGraph {
  return {
    hostInstanceId: "rocm_dgpu_host",
    topologyGeneration: 1,
    discoveredAt: new Date().toISOString(),
    devices: buildDevices(),
    memoryDomains: buildMemoryDomains(),
    transportEdges: buildTransportEdges(),
    interconnects: [
      {
        interconnectId: "dgpu_pcie_link",
        sourceDeviceId: "dgpu_host_cpu_0",
        destinationDeviceId: DGPU_ID,
        interconnectType: "pcie",
        bandwidthBytesPerSecond: null,
        latencyMicroseconds: null,
        hops: 1,
      },
    ],
    capabilitySignatures: ["dgpu_rocm_v1"],
    measuredBandwidthClasses: [
      { className: "pcie_gen4", minimumBytesPerSecond: 16_000_000_000, maximumBytesPerSecond: 32_000_000_000 },
    ],
    measuredLatencyClasses: [
      { className: "pcie_latency", minimumMicroseconds: 1.0, maximumMicroseconds: 5.0 },
    ],
    policyRestrictions: [],
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class RocmDiscreteGpuFabricAdapter implements PrismMemoryFabricAdapter {
  private topology: PrismTopologyGraph | null = null

  async probeTopology(): Promise<PrismTopologyGraph> {
    this.topology = buildTopology()
    return this.topology
  }

  listMemoryDomains(): PrismMemoryDomainInfo[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "rocm_dgpu")
    return this.topology.memoryDomains
  }

  listTransportEdges(): PrismMemoryTransportEdge[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "rocm_dgpu")
    return this.topology.transportEdges
  }

  async allocate(domainId: string, bytes: number): Promise<string> {
    const domain = this.topology?.memoryDomains.find((d) => d.domainId === domainId)
    if (!domain) throw new AdapterError(`Unknown domain: ${domainId}`, "rocm_dgpu")
    if (bytes > domain.totalBytes - domain.usedBytes - domain.reservedBytes) {
      throw new AdapterError(`Insufficient memory in domain: ${domainId}`, "rocm_dgpu")
    }
    const id = `rocm_dgpu_alloc_${++allocationCounter}`
    ALLOCATIONS.set(id, { domainId, bytes, deviceId: null })
    return id
  }

  async mapShared(domainId: string, allocationId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "rocm_dgpu")
    // dGPU VRAM can be mapped for host access via pinned host staging
    return domainId === `${DGPU_ID}_pinned_host`
  }

  async stageForTransfer(allocationId: string, destinationDomainId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "rocm_dgpu")
    const edge = this.topology?.transportEdges.find(
      (e) => e.sourceDomainId === alloc.domainId && e.destinationDomainId === destinationDomainId,
    )
    return edge !== undefined && edge.availabilityState !== "unavailable"
  }

  async transfer(sourceAllocationId: string, destinationDomainId: string, _plan: string): Promise<number> {
    const alloc = ALLOCATIONS.get(sourceAllocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${sourceAllocationId}`, "rocm_dgpu")
    const edge = this.topology?.transportEdges.find(
      (e) =>
        e.sourceDomainId === alloc.domainId && e.destinationDomainId === destinationDomainId,
    )
    if (!edge || edge.availabilityState === "unavailable") {
      throw new AdapterError(
        `No available transport from ${alloc.domainId} to ${destinationDomainId}`,
        "rocm_dgpu",
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
    const isPinned = edge.transportKind === "pinned_host_copy"
    return {
      edgeId: edge.edgeId,
      measuredBandwidthBytesPerSecond: isPinned ? 25_000_000_000 : 20_000_000_000,
      measuredLatencyMicroseconds: isPinned ? 3.0 : 2.0,
      availabilityState: "available",
    }
  }
}
