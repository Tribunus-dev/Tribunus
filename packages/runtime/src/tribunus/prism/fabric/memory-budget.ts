/**
 * Prism Heterogeneous Memory Fabric — Memory Budget Management
 *
 * Pure functions for creating, querying, and enforcing fabric memory budgets.
 */

import type {
  PrismFabricMemoryBudget,
  PrismMemoryDomainInfo,
  PrismMemoryDomainKind,
} from "./fabric-types"
import { BudgetError } from "./fabric-errors"

// ── Default Budget Constants ──────────────────────────────────────────────────

const DEFAULT_APU_SHARED_MEMORY_LIMIT = 8 * 1024 * 1024 * 1024   // 8 GB
const DEFAULT_APU_CPU_RESERVE = 512 * 1024 * 1024                // 512 MB
const DEFAULT_APU_IGPU_RESERVE = 2 * 1024 * 1024 * 1024          // 2 GB
const DEFAULT_APU_NPU_RESERVE = 512 * 1024 * 1024                // 512 MB
const DEFAULT_PINNED_HOST_STAGING_LIMIT = 1 * 1024 * 1024 * 1024 // 1 GB
const DEFAULT_MAX_INFLIGHT_TRANSFERS = 4
const DEFAULT_MAX_INFLIGHT_HANDOFFS = 2
const DEFAULT_EMERGENCY_RECLAIM_THRESHOLD = 0.9

// ── Budget Factory ────────────────────────────────────────────────────────────

/**
 * Create a fabric memory budget with sensible defaults.
 */
export function createFabricMemoryBudget(): PrismFabricMemoryBudget {
  return {
    apuSharedMemoryLimit: DEFAULT_APU_SHARED_MEMORY_LIMIT,
    apuCpuReserve: DEFAULT_APU_CPU_RESERVE,
    apuIntegratedGpuReserve: DEFAULT_APU_IGPU_RESERVE,
    apuNpuReserve: DEFAULT_APU_NPU_RESERVE,
    pinnedHostStagingLimit: DEFAULT_PINNED_HOST_STAGING_LIMIT,
    dGpuVramLimits: {},
    acceleratorDramLimits: {},
    maximumInflightTransfers: DEFAULT_MAX_INFLIGHT_TRANSFERS,
    maximumInflightHandoffs: DEFAULT_MAX_INFLIGHT_HANDOFFS,
    emergencyReclaimThreshold: DEFAULT_EMERGENCY_RECLAIM_THRESHOLD,
  }
}

// ── Domain-Limit Lookup ───────────────────────────────────────────────────────

function domainLimit(
  budget: PrismFabricMemoryBudget,
  domainKind: PrismMemoryDomainKind,
): number | null {
  switch (domainKind) {
    case "apu_shared_memory":
      return budget.apuSharedMemoryLimit
    case "npu_shared_memory":
      return budget.apuNpuReserve ?? null
    case "pinned_host_memory":
      return budget.pinnedHostStagingLimit
    case "discrete_gpu_vram": {
      // dGPU VRAM limits are per-device; return the highest known limit as a
      // ceiling for any dGPU domain when we don't have a device id.
      const vals = Object.values(budget.dGpuVramLimits)
      return vals.length > 0 ? Math.max(...vals) : null
    }
    case "accelerator_device_dram": {
      const vals = Object.values(budget.acceleratorDramLimits)
      return vals.length > 0 ? Math.max(...vals) : null
    }
    default:
      // cpu_system_memory, integrated_gpu_local_alias, managed_memory,
      // shared_memory_segment, durable_local_cache have no explicit budget cap.
      return null
  }
}

// ── Allocation Check ──────────────────────────────────────────────────────────

/**
 * Check whether an allocation of `bytes` in the given domain kind fits within
 * the fabric memory budget.
 */
export function checkAllocationWithinBudget(
  budget: PrismFabricMemoryBudget,
  domainKind: PrismMemoryDomainKind,
  bytes: number,
): { allowed: boolean; reason: string | null } {
  if (bytes <= 0) {
    return { allowed: false, reason: "Allocation must be positive" }
  }

  const limit = domainLimit(budget, domainKind)

  if (limit !== null && bytes > limit) {
    return {
      allowed: false,
      reason: `Allocation of ${bytes} bytes exceeds ${domainKind} limit of ${limit} bytes`,
    }
  }

  return { allowed: true, reason: null }
}

// ── Transfer Budget Check ─────────────────────────────────────────────────────

/**
 * Check whether the fabric has capacity for more inflight transfers or handoffs.
 */
export function checkTransferBudget(
  budget: PrismFabricMemoryBudget,
  inflightTransfers: number,
  inflightHandoffs: number,
): { allowed: boolean; reason: string | null } {
  if (inflightTransfers > budget.maximumInflightTransfers) {
    return {
      allowed: false,
      reason: `Inflight transfers (${inflightTransfers}) exceeds maximum (${budget.maximumInflightTransfers})`,
    }
  }
  if (inflightHandoffs > budget.maximumInflightHandoffs) {
    return {
      allowed: false,
      reason: `Inflight handoffs (${inflightHandoffs}) exceeds maximum (${budget.maximumInflightHandoffs})`,
    }
  }
  return { allowed: true, reason: null }
}

// ── Memory Pressure Check ─────────────────────────────────────────────────────

/**
 * Determine if a memory domain is under critical pressure.
 *
 * Critical pressure occurs when the ratio of (used + reserved) to total bytes
 * exceeds the given threshold.
 */
export function isMemoryPressureCritical(
  domain: PrismMemoryDomainInfo,
  threshold: number,
): boolean {
  const total = domain.totalBytes
  if (total <= 0) return true
  const pressure = (domain.usedBytes + domain.reservedBytes) / total
  return pressure >= threshold
}
