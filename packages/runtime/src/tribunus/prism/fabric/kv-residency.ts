/**
 * Prism Heterogeneous Memory Fabric — KV Residency Location Tracking
 *
 * Pure functions for resolving KV cache residency targets across handoffs.
 */

import type {
  PrismMemoryDomainKind,
  PrismDeviceClass,
  PrismMemoryTransportEdge,
  PrismMemoryDomainInfo,
} from "./fabric-types"

// ── Preferred Residency Mapping ───────────────────────────────────────────────

const DEVICE_CLASS_TO_DOMAIN: Record<PrismDeviceClass, PrismMemoryDomainKind> = {
  cpu: "cpu_system_memory",
  integrated_gpu: "apu_shared_memory",
  discrete_gpu: "discrete_gpu_vram",
  npu: "npu_shared_memory",
  accelerator: "accelerator_device_dram",
  tpu: "accelerator_device_dram",
  fpga: "pinned_host_memory",
  virtual: "shared_memory_segment",
}

/**
 * Return the most natural memory domain kind for a device class.
 */
export function getPreferredResidency(deviceClass: PrismDeviceClass): PrismMemoryDomainKind {
  return DEVICE_CLASS_TO_DOMAIN[deviceClass]
}

// ── Handoff Residency Resolution ──────────────────────────────────────────────

/**
 * Resolve the KV residency domain kind after a handoff from `sourceKind` to
 * `destKind`.
 *
 * Examines transport edges to determine whether a viable path to the
 * destination domain kind exists, falling back to pinned host memory as a
 * staging area when no direct path is found.
 */
export function resolveKvResidencyAfterHandoff(
  sourceKind: PrismMemoryDomainKind,
  destKind: PrismMemoryDomainKind,
  transportEdges: PrismMemoryTransportEdge[],
  memoryDomains: PrismMemoryDomainInfo[],
): PrismMemoryDomainKind {
  // Collect domain IDs matching the destination kind.
  const destDomainIds = new Set(
    memoryDomains
      .filter(d => d.domainKind === destKind)
      .map(d => d.domainId),
  )

  // Check if any edge leads to a domain of the destination kind.
  const hasDirectPath = transportEdges.some(
    e =>
      destDomainIds.has(e.destinationDomainId) &&
      e.sourceDomainId !== e.destinationDomainId &&
      e.transportKind !== "unsupported" &&
      e.availabilityState !== "unavailable",
  )

  if (hasDirectPath) {
    return destKind
  }

  // No direct path → fall back to pinned host memory as staging area when
  // some transport edge is still viable.
  if (transportEdges.some(e => e.availabilityState !== "unavailable")) {
    return "pinned_host_memory"
  }

  // No viable edges at all → stay at source.
  return sourceKind
}
