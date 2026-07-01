/**
 * Prism Heterogeneous Memory Fabric — Memory Domain
 *
 * Pure functions for memory domain lifecycle and introspection.
 */

import {
  type PrismMemoryDomainInfo,
  type PrismMemoryDomainKind,
} from "./fabric-types"

/**
 * Create a memory domain with the given identity, kind, and capacity.
 * Initial usedBytes and reservedBytes are 0.
 */
export function createMemoryDomain(
  id: string,
  kind: PrismMemoryDomainKind,
  totalBytes: number,
): PrismMemoryDomainInfo {
  return {
    domainId: id,
    domainKind: kind,
    deviceIds: [],
    totalBytes,
    usedBytes: 0,
    reservedBytes: 0,
    allocationGranularity: 4096,
  }
}

/**
 * Update the used bytes of a memory domain.
 * Returns a new domain reference; clamps usedBytes to [0, totalBytes].
 */
export function updateMemoryUsage(
  domain: PrismMemoryDomainInfo,
  usedBytes: number,
): PrismMemoryDomainInfo {
  const clamped = Math.max(0, Math.min(usedBytes, domain.totalBytes))
  return { ...domain, usedBytes: clamped }
}

/**
 * Get the number of available (unused) bytes in a domain.
 */
export function getAvailableBytes(domain: PrismMemoryDomainInfo): number {
  return Math.max(0, domain.totalBytes - domain.usedBytes - domain.reservedBytes)
}

/**
 * Check whether a memory domain is fully utilized (no available bytes).
 */
export function isDomainFull(domain: PrismMemoryDomainInfo): boolean {
  return getAvailableBytes(domain) <= 0
}

/**
 * Classify a memory domain kind into a broad residency category.
 */
export function classifyMemoryDomain(
  kind: PrismMemoryDomainKind,
): "host" | "shared" | "device" | "persistent" {
  switch (kind) {
    case "cpu_system_memory":
      return "host"
    case "pinned_host_memory":
      return "host"
    case "apu_shared_memory":
      return "shared"
    case "integrated_gpu_local_alias":
      return "shared"
    case "npu_shared_memory":
      return "shared"
    case "shared_memory_segment":
      return "shared"
    case "discrete_gpu_vram":
      return "device"
    case "accelerator_device_dram":
      return "device"
    case "managed_memory":
      return "persistent"
    case "durable_local_cache":
      return "persistent"
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}
