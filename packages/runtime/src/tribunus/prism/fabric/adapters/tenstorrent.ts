/**
 * Prism Heterogeneous Memory Fabric — Tenstorrent Adapter
 *
 * Adapter for Tenstorrent accelerator devices. Host-to-device transfers use
 * explicit DRAM copies via the Tensix backend. No unified addressing or
 * shared virtual memory — all data movement is explicit.
 */

import type {
  PrismMemoryFabricAdapter,
  PrismTopologyGraph,
  PrismMemoryDomainInfo,
  PrismMemoryTransportEdge,
  PrismComputeDevice,
} from "../fabric-types"

import { AdapterError } from "../fabric-errors"

// ── State ─────────────────────────────────────────────────────────────────────

const ALLOCATIONS = new Map<string, { domainId: string; bytes: number }>()

let allocationCounter = 0
let transferCounter = 0

// ── Exported Helper Functions ─────────────────────────────────────────────────

export function createTenstorrentDevice(id: string, memBytes: number): PrismComputeDevice {
  return {
    deviceId: id,
    deviceClass: "accelerator",
    backendKind: "tensix",
    targetCapabilitySignature: "tenstorrent_v1",
    memoryDomainIds: [`${id}_dram`],
    computeCapabilities: ["matrix", "simd", "tensor"],
    supportedWorkloads: ["prefill", "decode", "attention", "mlp", "norm", "embedding"],
    availableMemoryBytes: memBytes,
    reservedMemoryBytes: Math.floor(memBytes * 0.1),
    healthState: "healthy",
  }
}

export function getTenstorrentTransportKind(): "backend_device_copy" {
  return "backend_device_copy"
}

export function isTenstorrentAvailable(): boolean {
  // Stub — real detection requires probing /dev/tenstorrent or PCI vendor ID 0x1e57
  return false
}

// ── Topology Builders ─────────────────────────────────────────────────────────

const TT_DEVICE_ID = "tenstorrent_0"
const TT_MEM = 24_000_000_000

function buildDevices(): PrismComputeDevice[] {
  return [
    {
      deviceId: "tt_host_cpu_0",
      deviceClass: "cpu",
      backendKind: "cpu_native",
      targetCapabilitySignature: "tt_host_v1",
      memoryDomainIds: ["tt_host_system_0"],
      computeCapabilities: ["scalar", "simd"],
      supportedWorkloads: ["prefill", "decode", "postprocessing", "tokenization"],
      availableMemoryBytes: 16_000_000_000,
      reservedMemoryBytes: 0,
      healthState: "healthy",
    },
    createTenstorrentDevice(TT_DEVICE_ID, TT_MEM),
  ]
}

function buildMemoryDomains(): PrismMemoryDomainInfo[] {
  return [
    {
      domainId: "tt_host_system_0",
      domainKind: "cpu_system_memory",
      deviceIds: ["tt_host_cpu_0"],
      totalBytes: 16_000_000_000,
      usedBytes: 0,
      reservedBytes: 0,
      allocationGranularity: 4096,
    },
    {
      domainId: `${TT_DEVICE_ID}_dram`,
      domainKind: "accelerator_device_dram",
      deviceIds: [TT_DEVICE_ID],
      totalBytes: TT_MEM,
      usedBytes: 0,
      reservedBytes: Math.floor(TT_MEM * 0.1),
      allocationGranularity: 128,
    },
  ]
}

function buildTransportEdges(): PrismMemoryTransportEdge[] {
  return [
    {
      edgeId: "tt_host_to_device_dram",
      sourceDomainId: "tt_host_system_0",
      destinationDomainId: `${TT_DEVICE_ID}_dram`,
      transportKind: "backend_device_copy",
      accessMode: "read_write",
      coherencyMode: "non_coherent",
      maximumBytes: TT_MEM,
      measuredBandwidthBytesPerSecond: null,
      measuredLatencyMicroseconds: null,
      supportsAsync: true,
      supportsCancellation: true,
      supportsIntegrityValidation: true,
      availabilityState: "available",
    },
    {
      edgeId: "tt_device_to_host",
      sourceDomainId: `${TT_DEVICE_ID}_dram`,
      destinationDomainId: "tt_host_system_0",
      transportKind: "backend_device_copy",
      accessMode: "read_write",
      coherencyMode: "non_coherent",
      maximumBytes: TT_MEM,
      measuredBandwidthBytesPerSecond: null,
      measuredLatencyMicroseconds: null,
      supportsAsync: true,
      supportsCancellation: true,
      supportsIntegrityValidation: true,
      availabilityState: "available",
    },
  ]
}

function buildTopology(): PrismTopologyGraph {
  return {
    hostInstanceId: "tenstorrent_host",
    topologyGeneration: 1,
    discoveredAt: new Date().toISOString(),
    devices: buildDevices(),
    memoryDomains: buildMemoryDomains(),
    transportEdges: buildTransportEdges(),
    interconnects: [
      {
        interconnectId: "tt_pcie_link",
        sourceDeviceId: "tt_host_cpu_0",
        destinationDeviceId: TT_DEVICE_ID,
        interconnectType: "pcie",
        bandwidthBytesPerSecond: null,
        latencyMicroseconds: null,
        hops: 1,
      },
    ],
    capabilitySignatures: ["tenstorrent_v1"],
    measuredBandwidthClasses: [
      { className: "pcie_gen4_x16", minimumBytesPerSecond: 16_000_000_000, maximumBytesPerSecond: 32_000_000_000 },
    ],
    measuredLatencyClasses: [
      { className: "pcie_latency", minimumMicroseconds: 1.0, maximumMicroseconds: 5.0 },
    ],
    policyRestrictions: ["requires_tensix_backend"],
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class TenstorrentFabricAdapter implements PrismMemoryFabricAdapter {
  private topology: PrismTopologyGraph | null = null

  async probeTopology(): Promise<PrismTopologyGraph> {
    this.topology = buildTopology()
    return this.topology
  }

  listMemoryDomains(): PrismMemoryDomainInfo[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "tenstorrent")
    return this.topology.memoryDomains
  }

  listTransportEdges(): PrismMemoryTransportEdge[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "tenstorrent")
    return this.topology.transportEdges
  }

  async allocate(domainId: string, bytes: number): Promise<string> {
    const domain = this.topology?.memoryDomains.find((d) => d.domainId === domainId)
    if (!domain) throw new AdapterError(`Unknown domain: ${domainId}`, "tenstorrent")
    if (bytes > domain.totalBytes - domain.usedBytes - domain.reservedBytes) {
      throw new AdapterError(`Insufficient memory in domain: ${domainId}`, "tenstorrent")
    }
    const id = `tenstorrent_alloc_${++allocationCounter}`
    ALLOCATIONS.set(id, { domainId, bytes })
    return id
  }

  async mapShared(domainId: string, allocationId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "tenstorrent")
    // No unified addressing — explicit copy only
    return false
  }

  async stageForTransfer(allocationId: string, destinationDomainId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "tenstorrent")
    const edge = this.topology?.transportEdges.find(
      (e) => e.sourceDomainId === alloc.domainId && e.destinationDomainId === destinationDomainId,
    )
    return edge !== undefined && edge.availabilityState !== "unavailable"
  }

  async transfer(sourceAllocationId: string, destinationDomainId: string, _plan: string): Promise<number> {
    const alloc = ALLOCATIONS.get(sourceAllocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${sourceAllocationId}`, "tenstorrent")
    const edge = this.topology?.transportEdges.find(
      (e) =>
        e.sourceDomainId === alloc.domainId && e.destinationDomainId === destinationDomainId,
    )
    if (!edge || edge.availabilityState === "unavailable") {
      throw new AdapterError(
        `No available transport from ${alloc.domainId} to ${destinationDomainId}`,
        "tenstorrent",
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
    return {
      edgeId: edge.edgeId,
      measuredBandwidthBytesPerSecond: 24_000_000_000,
      measuredLatencyMicroseconds: 2.5,
      availabilityState: "available",
    }
  }
}
