/**
 * Prism Heterogeneous Memory Fabric — Transport Capability
 *
 * Domain-aware transport kind resolution and capability extraction.
 */

import {
  type PrismMemoryDomainKind,
  type PrismMemoryTransportKind,
  type PrismComputeDevice,
} from "./fabric-types"

/**
 * Determine the closest (most efficient) transport kind between two memory domain kinds.
 *
 * The resolution matrix captures the optimal transport for common pairings:
 *   host -> shared       → direct_shared_access
 *   shared -> shared     → direct_shared_access / zero_copy_mapped_access
 *   host -> device       → pinned_host_copy (or managed_memory_migration)
 *   device -> device     → peer_device_copy
 *   shared -> device     → backend_device_copy
 *   device -> host       → backend_device_copy
 *   persistent domains   → serialized_payload_copy (or managed_memory_migration)
 *   unknown pairings     → unsupported
 */
export function getClosestTransportKind(
  sourceKind: PrismMemoryDomainKind,
  destKind: PrismMemoryDomainKind,
): PrismMemoryTransportKind {
  // Same domain kind — direct shared access when applicable
  if (sourceKind === destKind) {
    switch (sourceKind) {
      case "cpu_system_memory":
      case "apu_shared_memory":
      case "npu_shared_memory":
      case "shared_memory_segment":
        return "direct_shared_access"
      case "discrete_gpu_vram":
      case "accelerator_device_dram":
        return "peer_device_copy"
      case "pinned_host_memory":
      case "managed_memory":
      case "durable_local_cache":
      case "integrated_gpu_local_alias":
        return "direct_shared_access"
      default: {
        const _exhaustive: never = sourceKind
        return _exhaustive as never
      }
    }
  }

  // CPU system memory to/from shared memory
  if (
    sourceKind === "cpu_system_memory" &&
    (destKind === "apu_shared_memory" || destKind === "npu_shared_memory" || destKind === "integrated_gpu_local_alias")
  ) {
    return "direct_shared_access"
  }
  if (
    destKind === "cpu_system_memory" &&
    (sourceKind === "apu_shared_memory" || sourceKind === "npu_shared_memory" || sourceKind === "integrated_gpu_local_alias")
  ) {
    return "direct_shared_access"
  }

  // Shared to shared
  if (isSharedKind(sourceKind) && isSharedKind(destKind)) {
    return "direct_shared_access"
  }

  // Host to discrete device — pinned copy is the baseline
  if (sourceKind === "cpu_system_memory" && destKind === "discrete_gpu_vram") {
    return "pinned_host_copy"
  }
  if (sourceKind === "pinned_host_memory" && destKind === "discrete_gpu_vram") {
    return "backend_device_copy"
  }
  if (sourceKind === "cpu_system_memory" && destKind === "accelerator_device_dram") {
    return "pinned_host_copy"
  }
  if (sourceKind === "pinned_host_memory" && destKind === "accelerator_device_dram") {
    return "backend_device_copy"
  }

  // Discrete device back to host
  if (
    (sourceKind === "discrete_gpu_vram" || sourceKind === "accelerator_device_dram") &&
    (destKind === "cpu_system_memory" || destKind === "pinned_host_memory")
  ) {
    return "backend_device_copy"
  }

  // Device to device (dGPU ↔ dGPU or accelerator ↔ dGPU)
  if (isDeviceKind(sourceKind) && isDeviceKind(destKind)) {
    return "peer_device_copy"
  }

  // Shared memory domain to device domain
  // APU shared memory and iGPU local alias act as host-visible memory for discrete GPUs
  if (
    (sourceKind === "apu_shared_memory" || sourceKind === "integrated_gpu_local_alias") &&
    (destKind === "discrete_gpu_vram" || destKind === "accelerator_device_dram")
  ) {
    return "pinned_host_copy"
  }
  if (
    (sourceKind === "discrete_gpu_vram" || sourceKind === "accelerator_device_dram") &&
    (destKind === "apu_shared_memory" || destKind === "integrated_gpu_local_alias")
  ) {
    return "backend_device_copy"
  }

  // Other shared (NPU, shared_memory_segment) to device
  if (isSharedKind(sourceKind) && isDeviceKind(destKind)) {
    return "backend_device_copy"
  }

  if (isDeviceKind(sourceKind) && isSharedKind(destKind)) {
    return "backend_device_copy"
  }

  // Anything involving persistent/durable — serialized or managed
  if (sourceKind === "managed_memory" || destKind === "managed_memory") {
    return "managed_memory_migration"
  }
  if (sourceKind === "durable_local_cache" || destKind === "durable_local_cache") {
    return "serialized_payload_copy"
  }

  // Fallback
  return "unsupported"
}

/**
 * Extract the required transport capabilities for a set of devices.
 * Returns capability string descriptors that summarize what transports
 * the device collection needs.
 */
export function getRequiredCapabilities(devices: PrismComputeDevice[]): string[] {
  const capabilities = new Set<string>()

  for (const device of devices) {
    switch (device.deviceClass) {
      case "cpu":
        if (device.memoryDomainIds.length > 0) {
          capabilities.add("host_memory_access")
        }
        break
      case "integrated_gpu":
        capabilities.add("shared_memory_access")
        capabilities.add("zero_copy_transport")
        break
      case "discrete_gpu":
        capabilities.add("device_memory_access")
        capabilities.add("pinned_host_transfer")
        capabilities.add("peer_device_transfer")
        break
      case "npu":
        capabilities.add("shared_memory_access")
        capabilities.add("npu_shared_access")
        break
      case "accelerator":
      case "tpu":
        capabilities.add("device_memory_access")
        capabilities.add("dma_buf_import")
        break
      case "fpga":
        capabilities.add("pinned_host_transfer")
        break
      case "virtual":
        capabilities.add("host_memory_access")
        break
      default: {
        const _exhaustive: never = device.deviceClass
        break
      }
    }
  }

  return [...capabilities]
}

// ── Internal Helpers ────────────────────────────────────────────────────────

function isSharedKind(kind: PrismMemoryDomainKind): boolean {
  return (
    kind === "apu_shared_memory" ||
    kind === "npu_shared_memory" ||
    kind === "integrated_gpu_local_alias" ||
    kind === "shared_memory_segment"
  )
}

function isDeviceKind(kind: PrismMemoryDomainKind): boolean {
  return kind === "discrete_gpu_vram" || kind === "accelerator_device_dram"
}
