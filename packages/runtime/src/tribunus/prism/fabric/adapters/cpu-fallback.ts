/**
 * Prism Heterogeneous Memory Fabric — CPU Fallback Adapter
 *
 * Stub adapter for CPU-only execution. All memory is system memory and
 * transport is trivially direct_shared_access since only one domain exists.
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

const ALLOCATIONS = new Map<string, { domainId: string; bytes: number }>()

let allocationCounter = 0
let transferCounter = 0

const HOST_DEVICE_ID = "cpu_fallback_0"
const SYSTEM_DOMAIN_ID = "cpu_system_memory_0"

function buildCpuDevice(): PrismComputeDevice {
  return {
    deviceId: HOST_DEVICE_ID,
    deviceClass: "cpu",
    backendKind: "cpu_native",
    targetCapabilitySignature: "cpu_fallback_v1",
    memoryDomainIds: [SYSTEM_DOMAIN_ID],
    computeCapabilities: ["scalar", "simd"],
    supportedWorkloads: [
      "prefill",
      "decode",
      "embedding",
      "attention",
      "mlp",
      "norm",
      "classification_head",
      "postprocessing",
      "static_subgraph",
    ],
    availableMemoryBytes: 16_000_000_000,
    reservedMemoryBytes: 0,
    healthState: "healthy",
  }
}

function buildSystemMemoryDomain(): PrismMemoryDomainInfo {
  return {
    domainId: SYSTEM_DOMAIN_ID,
    domainKind: "cpu_system_memory",
    deviceIds: [HOST_DEVICE_ID],
    totalBytes: 16_000_000_000,
    usedBytes: 0,
    reservedBytes: 0,
    allocationGranularity: 4096,
  }
}

function buildDirectEdge(): PrismMemoryTransportEdge {
  return {
    edgeId: "cpu_fallback_direct_0",
    sourceDomainId: SYSTEM_DOMAIN_ID,
    destinationDomainId: SYSTEM_DOMAIN_ID,
    transportKind: "direct_shared_access",
    accessMode: "read_write",
    coherencyMode: "coherent",
    maximumBytes: 16_000_000_000,
    measuredBandwidthBytesPerSecond: null,
    measuredLatencyMicroseconds: null,
    supportsAsync: true,
    supportsCancellation: true,
    supportsIntegrityValidation: true,
    availabilityState: "available",
  }
}

function buildTopology(): PrismTopologyGraph {
  return {
    hostInstanceId: "cpu_fallback_host",
    topologyGeneration: 1,
    discoveredAt: new Date().toISOString(),
    devices: [buildCpuDevice()],
    memoryDomains: [buildSystemMemoryDomain()],
    transportEdges: [buildDirectEdge()],
    interconnects: [],
    capabilitySignatures: ["cpu_fallback_v1"],
    measuredBandwidthClasses: [
      { className: "system_memory", minimumBytesPerSecond: 1_000_000_000, maximumBytesPerSecond: 50_000_000_000 },
    ],
    measuredLatencyClasses: [
      { className: "local_ram", minimumMicroseconds: 0.05, maximumMicroseconds: 0.1 },
    ],
    policyRestrictions: [],
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class CpuFallbackFabricAdapter implements PrismMemoryFabricAdapter {
  private topology: PrismTopologyGraph | null = null

  async probeTopology(): Promise<PrismTopologyGraph> {
    this.topology = buildTopology()
    return this.topology
  }

  listMemoryDomains(): PrismMemoryDomainInfo[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "cpu_fallback")
    return this.topology.memoryDomains
  }

  listTransportEdges(): PrismMemoryTransportEdge[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "cpu_fallback")
    return this.topology.transportEdges
  }

  async allocate(domainId: string, bytes: number): Promise<string> {
    if (domainId !== SYSTEM_DOMAIN_ID) {
      throw new AdapterError(`Unknown domain: ${domainId}`, "cpu_fallback")
    }
    const id = `cpu_fallback_alloc_${++allocationCounter}`
    ALLOCATIONS.set(id, { domainId, bytes })
    return id
  }

  async mapShared(domainId: string, allocationId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "cpu_fallback")
    if (domainId !== SYSTEM_DOMAIN_ID) return false
    return true
  }

  async stageForTransfer(allocationId: string, destinationDomainId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "cpu_fallback")
    if (destinationDomainId !== SYSTEM_DOMAIN_ID) return false
    return true
  }

  async transfer(sourceAllocationId: string, destinationDomainId: string, _plan: string): Promise<number> {
    const alloc = ALLOCATIONS.get(sourceAllocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${sourceAllocationId}`, "cpu_fallback")
    if (destinationDomainId !== SYSTEM_DOMAIN_ID) {
      throw new AdapterError(`Unknown destination domain: ${destinationDomainId}`, "cpu_fallback")
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
      measuredBandwidthBytesPerSecond: 12_000_000_000,
      measuredLatencyMicroseconds: 0.075,
      availabilityState: "available",
    }
  }
}
