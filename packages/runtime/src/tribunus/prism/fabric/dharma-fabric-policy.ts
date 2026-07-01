/**
 * Prism Heterogeneous Memory Fabric — Dharma-Compatible Fabric Policy
 *
 * Pure functions for creating and querying Dharma-compatible fabric policies
 * that govern device-class eligibility, offload permissions, transport budgets,
 * and NPU admission within the heterogeneous memory fabric.
 */

import type { DharmaPrismFabricPolicy, PrismDeviceClass } from "./fabric-types"

// ── Policy Factories ────────────────────────────────────────────────────────

/**
 * Create a permissive default Dharma fabric policy that allows all standard
 * device classes and transport mechanisms.
 */
export function createDefaultDharmaFabricPolicy(): DharmaPrismFabricPolicy {
  return {
    allowedDeviceClasses: [
      "cpu",
      "integrated_gpu",
      "discrete_gpu",
      "npu",
      "accelerator",
      "tpu",
      "fpga",
      "virtual",
    ],
    forbiddenDeviceClasses: [],
    allowApuSharedMemory: true,
    allowDgpuOffload: true,
    allowManagedMemoryMigration: true,
    allowDmaBufImport: true,
    allowLocalHostKvTransport: true,
    allowNpuSubgraphs: true,
    maximumTransferBytes: 1_073_741_824, // 1 GiB
    maximumTransferDurationMs: 30_000, // 30 s
    requireResidencyReceipt: true,
    requireSameHostAuthorityDomain: false,
  }
}

/**
 * Create a restrictive Dharma fabric policy that limits execution to CPU and
 * integrated GPU only, disallowing dGPU offload, NPU subgraphs, DMA-BUF, and
 * managed-memory migration.
 */
export function createRestrictiveDharmaFabricPolicy(): DharmaPrismFabricPolicy {
  return {
    allowedDeviceClasses: ["cpu", "integrated_gpu"],
    forbiddenDeviceClasses: ["discrete_gpu", "npu", "accelerator", "tpu", "fpga", "virtual"],
    allowApuSharedMemory: true,
    allowDgpuOffload: false,
    allowManagedMemoryMigration: false,
    allowDmaBufImport: false,
    allowLocalHostKvTransport: true,
    allowNpuSubgraphs: false,
    maximumTransferBytes: 268_435_456, // 256 MiB
    maximumTransferDurationMs: 10_000, // 10 s
    requireResidencyReceipt: true,
    requireSameHostAuthorityDomain: true,
  }
}

// ── Device Class Checks ─────────────────────────────────────────────────────

/**
 * Check whether a device class is allowed under the given policy.
 * A class is allowed if it is in `allowedDeviceClasses` and NOT in
 * `forbiddenDeviceClasses`.
 */
export function isDeviceClassAllowed(
  policy: DharmaPrismFabricPolicy,
  deviceClass: string,
): boolean {
  const dc = deviceClass as PrismDeviceClass
  if (policy.forbiddenDeviceClasses.includes(dc)) return false
  return policy.allowedDeviceClasses.includes(dc)
}

/**
 * Check whether offload to the given device class is permitted.
 * Offload is considered permitted when the class is allowed and the
 * policy's offload flag is on.
 */
export function isOffloadPermitted(
  policy: DharmaPrismFabricPolicy,
  deviceClass: string,
): boolean {
  if (!isDeviceClassAllowed(policy, deviceClass)) return false
  if (deviceClass === "discrete_gpu" && !policy.allowDgpuOffload) return false
  // For all offload-capable classes, offload is allowed if the class itself
  // is allowed and not explicitly a CPU-only execution.
  return true
}

// ── Transport Budget Check ──────────────────────────────────────────────────

/**
 * Check whether a transport of the given kind and byte size is within the
 * policy's constraints.
 */
export function isTransportWithinPolicy(
  policy: DharmaPrismFabricPolicy,
  transportKind: string,
  bytes: number,
): boolean {
  if (bytes > policy.maximumTransferBytes) return false

  switch (transportKind) {
    case "managed_memory_migration":
      return policy.allowManagedMemoryMigration
    case "dma_buf_import":
      return policy.allowDmaBufImport
    case "local_host_shared_memory_copy":
      return policy.allowLocalHostKvTransport
    default:
      // Direct-shared, zero-copy, pinned-host, backend-copy, peer-copy,
      // serialized-payload, and unsupported are allowed unless blocked by
      // byte limit (checked above).
      return true
  }
}

// ── NPU Check ───────────────────────────────────────────────────────────────

/**
 * Check whether NPU subgraph execution is allowed by the policy.
 */
export function isNpuAllowed(policy: DharmaPrismFabricPolicy): boolean {
  return (
    policy.allowNpuSubgraphs &&
    policy.allowedDeviceClasses.includes("npu" as PrismDeviceClass) &&
    !policy.forbiddenDeviceClasses.includes("npu" as PrismDeviceClass)
  )
}
