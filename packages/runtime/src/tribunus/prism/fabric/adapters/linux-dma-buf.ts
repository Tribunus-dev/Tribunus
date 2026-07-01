/**
 * Prism Heterogeneous Memory Fabric — Linux DMA Buffer Adapter
 *
 * Optional adapter that exposes dma-buf import/export transport edges between
 * memory domains. Requires backend validation — the adapter checks that the
 * backend supports dma-buf before allowing operations.
 *
 * dma-buf provides zero-copy buffer sharing across kernel device drivers,
 * enabling efficient cross-device transfers without staging through host memory.
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

/**
 * Create a dma-buf transport edge between two memory domains.
 */
export function createDmaBufEdge(
  sourceDomainId: string,
  destDomainId: string,
): PrismMemoryTransportEdge {
  return {
    edgeId: `dmabuf_${sourceDomainId}_${destDomainId}`,
    sourceDomainId,
    destinationDomainId: destDomainId,
    transportKind: "dma_buf_import",
    accessMode: "read_write",
    coherencyMode: "non_coherent",
    maximumBytes: 1_000_000_000,
    measuredBandwidthBytesPerSecond: null,
    measuredLatencyMicroseconds: null,
    supportsAsync: true,
    supportsCancellation: false,
    supportsIntegrityValidation: false,
    availabilityState: "untested",
  }
}

/**
 * Returns true when the Linux dma-buf subsystem is available on this host.
 * Stub — always returns false since real detection requires /dev/dri access.
 */
export function isDmaBufAvailable(): boolean {
  return false
}

/**
 * Returns true when a benchmark result qualifies for dma-buf usage.
 * A non-null result with bandwidth above 1 GiB/s is considered qualified.
 */
export function isDmaBufQualified(benchmarkResult: string | null): boolean {
  if (benchmarkResult === null) return false
  const parsed = Number(benchmarkResult)
  if (Number.isNaN(parsed)) return false
  return parsed >= 1_000_000_000
}

// ── Topology Builders ─────────────────────────────────────────────────────────

function buildTopology(): PrismTopologyGraph {
  return {
    hostInstanceId: "linux_dma_buf_host",
    topologyGeneration: 1,
    discoveredAt: new Date().toISOString(),
    devices: [
      {
        deviceId: "dmabuf_host_cpu_0",
        deviceClass: "cpu",
        backendKind: "cpu_native",
        targetCapabilitySignature: "dmabuf_host_v1",
        memoryDomainIds: ["dmabuf_host_system_0"],
        computeCapabilities: ["scalar", "simd"],
        supportedWorkloads: ["prefill", "decode", "postprocessing", "tokenization"],
        availableMemoryBytes: 16_000_000_000,
        reservedMemoryBytes: 0,
        healthState: "healthy",
      },
    ],
    memoryDomains: [
      {
        domainId: "dmabuf_host_system_0",
        domainKind: "cpu_system_memory",
        deviceIds: ["dmabuf_host_cpu_0"],
        totalBytes: 16_000_000_000,
        usedBytes: 0,
        reservedBytes: 0,
        allocationGranularity: 4096,
      },
      {
        domainId: "dmabuf_import_0",
        domainKind: "shared_memory_segment",
        deviceIds: [],
        totalBytes: 1_000_000_000,
        usedBytes: 0,
        reservedBytes: 0,
        allocationGranularity: 4096,
      },
    ],
    transportEdges: [
      {
        edgeId: "dmabuf_host_to_import",
        sourceDomainId: "dmabuf_host_system_0",
        destinationDomainId: "dmabuf_import_0",
        transportKind: "dma_buf_import",
        accessMode: "read_write",
        coherencyMode: "non_coherent",
        maximumBytes: 1_000_000_000,
        measuredBandwidthBytesPerSecond: null,
        measuredLatencyMicroseconds: null,
        supportsAsync: true,
        supportsCancellation: false,
        supportsIntegrityValidation: false,
        availabilityState: "untested",
      },
    ],
    interconnects: [],
    capabilitySignatures: ["dmabuf_v1"],
    measuredBandwidthClasses: [
      { className: "dmabuf", minimumBytesPerSecond: 1_000_000_000, maximumBytesPerSecond: 12_000_000_000 },
    ],
    measuredLatencyClasses: [
      { className: "dmabuf_latency", minimumMicroseconds: 0.5, maximumMicroseconds: 2.0 },
    ],
    policyRestrictions: ["requires_dma_buf_backend"],
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class LinuxDmaBufFabricAdapter implements PrismMemoryFabricAdapter {
  private topology: PrismTopologyGraph | null = null
  private validated = false

  async probeTopology(): Promise<PrismTopologyGraph> {
    if (!isDmaBufAvailable()) {
      throw new AdapterError(
        "dma-buf is not available on this host; cannot probe topology",
        "linux_dma_buf",
      )
    }
    this.topology = buildTopology()
    this.validated = true
    return this.topology
  }

  listMemoryDomains(): PrismMemoryDomainInfo[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "linux_dma_buf")
    return this.topology.memoryDomains
  }

  listTransportEdges(): PrismMemoryTransportEdge[] {
    if (!this.topology) throw new AdapterError("Adapter must probeTopology() first", "linux_dma_buf")
    return this.topology.transportEdges
  }

  async allocate(domainId: string, bytes: number): Promise<string> {
    if (!this.validated) {
      throw new AdapterError("Backend has not been validated; cannot allocate", "linux_dma_buf")
    }
    const domain = this.topology?.memoryDomains.find((d) => d.domainId === domainId)
    if (!domain) throw new AdapterError(`Unknown domain: ${domainId}`, "linux_dma_buf")
    if (bytes > domain.totalBytes - domain.usedBytes - domain.reservedBytes) {
      throw new AdapterError(`Insufficient memory in domain: ${domainId}`, "linux_dma_buf")
    }
    const id = `dmabuf_alloc_${++allocationCounter}`
    ALLOCATIONS.set(id, { domainId, bytes })
    return id
  }

  async mapShared(domainId: string, allocationId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "linux_dma_buf")
    if (!this.validated) return false
    // dma-buf import domain supports shared mapping
    return domainId === "dmabuf_import_0" || domainId === "dmabuf_host_system_0"
  }

  async stageForTransfer(allocationId: string, destinationDomainId: string): Promise<boolean> {
    const alloc = ALLOCATIONS.get(allocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${allocationId}`, "linux_dma_buf")
    if (!this.validated) return false
    const edge = this.topology?.transportEdges.find(
      (e) => e.sourceDomainId === alloc.domainId && e.destinationDomainId === destinationDomainId,
    )
    return edge !== undefined && edge.availabilityState !== "unavailable"
  }

  async transfer(sourceAllocationId: string, destinationDomainId: string, _plan: string): Promise<number> {
    const alloc = ALLOCATIONS.get(sourceAllocationId)
    if (!alloc) throw new AdapterError(`Unknown allocation: ${sourceAllocationId}`, "linux_dma_buf")
    if (!this.validated) {
      throw new AdapterError("Backend has not been validated; cannot transfer", "linux_dma_buf")
    }
    const edge = this.topology?.transportEdges.find(
      (e) =>
        e.sourceDomainId === alloc.domainId && e.destinationDomainId === destinationDomainId,
    )
    if (!edge || edge.availabilityState === "unavailable") {
      throw new AdapterError(
        `No available transport from ${alloc.domainId} to ${destinationDomainId}`,
        "linux_dma_buf",
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
      measuredBandwidthBytesPerSecond: 5_000_000_000,
      measuredLatencyMicroseconds: 1.0,
      availabilityState: "available",
    }
  }
}
