/**
 * Prism Heterogeneous Memory Fabric — KV Residency Policy
 *
 * Pure functions for managing KV cache residency policies across memory domains.
 */

import type { PrismKvResidencyPolicy, PrismDeviceClass, PrismMemoryDomainKind } from "./fabric-types"

// ── Policy Factories ──────────────────────────────────────────────────────────

/**
 * Create a default (conservative) KV residency policy.
 *
 * Default policy allows APU shared and local-host handoff but disallows
 * dGPU VRAM residency and export to staging by default.
 */
export function createDefaultKvResidencyPolicy(): PrismKvResidencyPolicy {
  return {
    preferExistingLocality: true,
    allowApuSharedResidency: true,
    allowDgpuResidency: false,
    allowExportToStaging: false,
    allowLocalHostHandoff: true,
    allowBackendNativeImport: false,
    maximumStagingBytes: 256 * 1024 * 1024, // 256 MB
    retentionDurationMs: 300_000,           // 5 minutes
    migrationThreshold: 0.7,                // migrate when similarity drops below 70%
  }
}

/**
 * Create an permissive KV residency policy that allows all locations.
 */
export function createAllowAllResidencyPolicy(): PrismKvResidencyPolicy {
  return {
    preferExistingLocality: true,
    allowApuSharedResidency: true,
    allowDgpuResidency: true,
    allowExportToStaging: true,
    allowLocalHostHandoff: true,
    allowBackendNativeImport: true,
    maximumStagingBytes: 1 * 1024 * 1024 * 1024, // 1 GB
    retentionDurationMs: 900_000,                  // 15 minutes
    migrationThreshold: 0.5,
  }
}

// ── Device Class Mapping ──────────────────────────────────────────────────────

/**
 * Check whether a device class is permitted by the residency policy.
 */
export function canResideOnDevice(
  policy: PrismKvResidencyPolicy,
  deviceClass: PrismDeviceClass,
): boolean {
  switch (deviceClass) {
    case "cpu":
      return true // CPU system memory is always allowed
    case "integrated_gpu":
    case "npu":
      return policy.allowApuSharedResidency
    case "discrete_gpu":
      return policy.allowDgpuResidency
    case "accelerator":
    case "tpu":
    case "fpga":
      return policy.allowExportToStaging
    case "virtual":
      return policy.allowLocalHostHandoff
    default:
      return true
  }
}

// ── Migration Decision ────────────────────────────────────────────────────────

/**
 * Determine whether KV should migrate away from the given domain kind based
 * on policy.
 *
 * Currently migration is only considered for APU-shared memory (the most
 * contended domain); in practice the decision also depends on actual
 * memory-pressure, but that is the caller's responsibility.
 */
export function shouldMigrateKv(
  currentDomainKind: PrismMemoryDomainKind,
  policy: PrismKvResidencyPolicy,
): boolean {
  // If the policy disallows residency in the current kind, always migrate.
  const mappedClass = domainKindToDeviceClass(currentDomainKind)
  if (mappedClass !== null && !canResideOnDevice(policy, mappedClass)) {
    return true
  }

  // For APU shared memory, migrate if policy threshold is low enough to
  // indicate willingness to move.
  if (currentDomainKind === "apu_shared_memory") {
    return policy.migrationThreshold <= 0.6
  }

  // Default: don't migrate.
  return false
}

// ── Internal Helper ───────────────────────────────────────────────────────────

function domainKindToDeviceClass(kind: PrismMemoryDomainKind): PrismDeviceClass | null {
  switch (kind) {
    case "cpu_system_memory":
      return "cpu"
    case "apu_shared_memory":
    case "integrated_gpu_local_alias":
      return "integrated_gpu"
    case "npu_shared_memory":
      return "npu"
    case "discrete_gpu_vram":
      return "discrete_gpu"
    case "accelerator_device_dram":
      return "accelerator"
    case "pinned_host_memory":
    case "managed_memory":
    case "shared_memory_segment":
    case "durable_local_cache":
      return null
  }
}
