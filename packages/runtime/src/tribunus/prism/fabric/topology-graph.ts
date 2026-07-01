/**
 * Prism Heterogeneous Memory Fabric — Topology Graph
 *
 * Pure functions for creating and querying the PrismTopologyGraph.
 */

import {
  type PrismTopologyGraph,
  type PrismComputeDevice,
  type PrismMemoryDomainInfo,
  type PrismMemoryTransportEdge,
  type PrismMemoryTransportKind,
  type PrismDeviceClass,
} from "./fabric-types"

const DEFAULT_BANDWIDTH_CLASSES = [
  { className: "ultra", minimumBytesPerSecond: 200_000_000_000, maximumBytesPerSecond: Infinity },
  { className: "high", minimumBytesPerSecond: 50_000_000_000, maximumBytesPerSecond: 200_000_000_000 },
  { className: "medium", minimumBytesPerSecond: 10_000_000_000, maximumBytesPerSecond: 50_000_000_000 },
  { className: "low", minimumBytesPerSecond: 1_000_000_000, maximumBytesPerSecond: 10_000_000_000 },
  { className: "slow", minimumBytesPerSecond: 0, maximumBytesPerSecond: 1_000_000_000 },
]

const DEFAULT_LATENCY_CLASSES = [
  { className: "ultra_low", minimumMicroseconds: 0, maximumMicroseconds: 0.5 },
  { className: "low", minimumMicroseconds: 0.5, maximumMicroseconds: 5 },
  { className: "medium", minimumMicroseconds: 5, maximumMicroseconds: 50 },
  { className: "high", minimumMicroseconds: 50, maximumMicroseconds: 500 },
  { className: "slow", minimumMicroseconds: 500, maximumMicroseconds: Infinity },
]

/**
 * Create an empty topology graph for a given host instance.
 */
export function createEmptyTopologyGraph(hostId: string): PrismTopologyGraph {
  return {
    hostInstanceId: hostId,
    topologyGeneration: 0,
    discoveredAt: new Date().toISOString(),
    devices: [],
    memoryDomains: [],
    transportEdges: [],
    interconnects: [],
    capabilitySignatures: [],
    measuredBandwidthClasses: [...DEFAULT_BANDWIDTH_CLASSES],
    measuredLatencyClasses: [...DEFAULT_LATENCY_CLASSES],
    policyRestrictions: [],
  }
}

/**
 * Add a compute device to the topology graph. Returns a new graph reference.
 */
export function addDeviceToGraph(
  graph: PrismTopologyGraph,
  device: PrismComputeDevice,
): PrismTopologyGraph {
  return {
    ...graph,
    devices: [...graph.devices, device],
  }
}

/**
 * Add a memory domain to the topology graph. Returns a new graph reference.
 */
export function addMemoryDomain(
  graph: PrismTopologyGraph,
  domain: PrismMemoryDomainInfo,
): PrismTopologyGraph {
  return {
    ...graph,
    memoryDomains: [...graph.memoryDomains, domain],
  }
}

/**
 * Add a transport edge to the topology graph. Returns a new graph reference.
 */
export function addTransportEdge(
  graph: PrismTopologyGraph,
  edge: PrismMemoryTransportEdge,
): PrismTopologyGraph {
  return {
    ...graph,
    transportEdges: [...graph.transportEdges, edge],
  }
}

/**
 * Look up a device by its deviceId.
 */
export function getDeviceById(
  graph: PrismTopologyGraph,
  deviceId: string,
): PrismComputeDevice | undefined {
  return graph.devices.find((d) => d.deviceId === deviceId)
}

/**
 * Look up a memory domain by its domainId.
 */
export function getDomainById(
  graph: PrismTopologyGraph,
  domainId: string,
): PrismMemoryDomainInfo | undefined {
  return graph.memoryDomains.find((d) => d.domainId === domainId)
}

/**
 * Get all devices of a given device class.
 */
export function getDevicesByClass(
  graph: PrismTopologyGraph,
  deviceClass: PrismDeviceClass,
): PrismComputeDevice[] {
  return graph.devices.filter((d) => d.deviceClass === deviceClass)
}

/**
 * Get transport edges between two memory domains (directional: source -> dest).
 */
export function getTransportEdgesBetween(
  graph: PrismTopologyGraph,
  sourceDomainId: string,
  destDomainId: string,
): PrismMemoryTransportEdge[] {
  return graph.transportEdges.filter(
    (e) => e.sourceDomainId === sourceDomainId && e.destinationDomainId === destDomainId,
  )
}

/**
 * Get the set of available transport kinds between two memory domains.
 * Returns only edges whose availabilityState is "available" or "degraded".
 */
export function getAvailableTransportKinds(
  graph: PrismTopologyGraph,
  sourceDomainId: string,
  destDomainId: string,
): PrismMemoryTransportKind[] {
  const edges = graph.transportEdges.filter(
    (e) =>
      e.sourceDomainId === sourceDomainId &&
      e.destinationDomainId === destDomainId &&
      (e.availabilityState === "available" || e.availabilityState === "degraded"),
  )
  const kinds = new Set(edges.map((e) => e.transportKind))
  return [...kinds]
}

/**
 * Increment the topology generation counter. Returns a new graph.
 */
export function incrementTopologyGeneration(graph: PrismTopologyGraph): PrismTopologyGraph {
  return {
    ...graph,
    topologyGeneration: graph.topologyGeneration + 1,
  }
}
