/**
 * Prism Heterogeneous Memory Fabric — Transport Edge
 *
 * Pure functions for transport edge lifecycle and byte capacity queries.
 */

import {
  type PrismMemoryTransportEdge,
  type PrismMemoryTransportKind,
  type TransportEdgeState,
} from "./fabric-types"

/**
 * Create a transport edge between two memory domains.
 * Default access mode is "read_write", coherency "io_coherent",
 * maximumBytes set to 0 (no limit known until benchmarked).
 */
export function createTransportEdge(
  id: string,
  sourceDomainId: string,
  destDomainId: string,
  kind: PrismMemoryTransportKind,
): PrismMemoryTransportEdge {
  return {
    edgeId: id,
    sourceDomainId,
    destinationDomainId: destDomainId,
    transportKind: kind,
    accessMode: "read_write",
    coherencyMode: "io_coherent",
    maximumBytes: 0,
    measuredBandwidthBytesPerSecond: null,
    measuredLatencyMicroseconds: null,
    supportsAsync: false,
    supportsCancellation: false,
    supportsIntegrityValidation: false,
    availabilityState: "untested",
  }
}

/**
 * Update the availability state of a transport edge.
 * Returns a new edge reference.
 */
export function updateEdgeAvailability(
  edge: PrismMemoryTransportEdge,
  state: TransportEdgeState,
): PrismMemoryTransportEdge {
  return { ...edge, availabilityState: state }
}

/**
 * Check whether a transport edge is currently usable.
 */
export function isEdgeAvailable(edge: PrismMemoryTransportEdge): boolean {
  return edge.availabilityState === "available" || edge.availabilityState === "degraded"
}

/**
 * Check whether a transport edge can transfer a given number of bytes.
 * An edge with maximumBytes === 0 is considered unlimited (no constraint known).
 * Edges that are unavailable always return false.
 */
export function canEdgeTransportBytes(
  edge: PrismMemoryTransportEdge,
  bytes: number,
): boolean {
  if (!isEdgeAvailable(edge)) {
    return false
  }
  if (edge.maximumBytes === 0) {
    return true
  }
  return bytes <= edge.maximumBytes
}

/**
 * Classify a transport kind into a high-level transport mechanism category.
 */
export function classifyTransportKind(
  kind: PrismMemoryTransportKind,
): "shared" | "copy" | "import" | "unsupported" {
  switch (kind) {
    case "direct_shared_access":
    case "zero_copy_mapped_access":
      return "shared"
    case "managed_memory_migration":
    case "pinned_host_copy":
    case "backend_device_copy":
    case "peer_device_copy":
    case "local_host_shared_memory_copy":
    case "serialized_payload_copy":
      return "copy"
    case "dma_buf_import":
      return "import"
    case "unsupported":
      return "unsupported"
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}
