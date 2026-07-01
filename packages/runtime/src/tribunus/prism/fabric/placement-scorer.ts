/**
 * Prism Heterogeneous Memory Fabric — Placement Scoring Heuristics
 *
 * Pure scoring functions used by the placement planner to rank candidates.
 * Higher scores = more preferred.
 */

import type {
  PrismComputeDevice,
  PrismFabricPlacementRequest,
  PrismMemoryDomainInfo,
  PrismMemoryTransportEdge,
  PrismDeviceClass,
  WorkloadClass,
} from "./fabric-types"

// ── Constants ─────────────────────────────────────────────────────────────────

const APU_WORKLOAD_PREFERENCE: Partial<Record<WorkloadClass, number>> = {
  prefill: 0.9,
  decode: 0.8,
  embedding: 0.9,
  tokenization: 1.0,
  postprocessing: 1.0,
  static_subgraph: 0.7,
}

const DGPU_WORKLOAD_PREFERENCE: Partial<Record<WorkloadClass, number>> = {
  prefill: 0.8,
  decode: 0.95,
  attention: 0.95,
  mlp: 0.9,
  classification_head: 0.95,
  vision_encoder: 1.0,
  audio_feature: 1.0,
}

const CPU_WORKLOAD_PREFERENCE: Partial<Record<WorkloadClass, number>> = {
  tokenization: 0.9,
  postprocessing: 0.9,
  static_subgraph: 0.6,
  embedding: 0.5,
}

const NPU_WORKLOAD_PREFERENCE: Partial<Record<WorkloadClass, number>> = {
  prefill: 0.5,
  decode: 0.5,
  attention: 0.9,
  mlp: 0.8,
  norm: 0.8,
}

// ── Device-Class Affinity Tables ──────────────────────────────────────────────

const DEVICE_CLASS_BASE_SCORES: Record<PrismDeviceClass, number> = {
  cpu: 0.2,
  integrated_gpu: 0.7,
  discrete_gpu: 0.85,
  npu: 0.6,
  accelerator: 0.9,
  tpu: 0.85,
  fpga: 0.5,
  virtual: 0.1,
}

const DEVICE_CLASS_WORKLOAD_TABLE: Record<
  PrismDeviceClass,
  Partial<Record<WorkloadClass, number>>
> = {
  cpu: CPU_WORKLOAD_PREFERENCE,
  integrated_gpu: APU_WORKLOAD_PREFERENCE,
  discrete_gpu: DGPU_WORKLOAD_PREFERENCE,
  npu: NPU_WORKLOAD_PREFERENCE,
  accelerator: { prefill: 0.9, decode: 0.9, attention: 0.95, mlp: 0.9, norm: 0.85 },
  tpu: { prefill: 0.9, decode: 0.85, attention: 1.0, mlp: 0.9, norm: 0.85 },
  fpga: { static_subgraph: 0.8 },
  virtual: {},
}

// ── Memory Domain Base Scores per Kind ────────────────────────────────────────

const MEMORY_DOMAIN_BASE_SCORES: Record<string, number> = {
  cpu_system_memory: 0.3,
  apu_shared_memory: 0.7,
  integrated_gpu_local_alias: 0.65,
  npu_shared_memory: 0.5,
  discrete_gpu_vram: 0.8,
  accelerator_device_dram: 0.85,
  pinned_host_memory: 0.4,
  managed_memory: 0.5,
  shared_memory_segment: 0.6,
  durable_local_cache: 0.55,
}

// ── Health Score Multipliers ──────────────────────────────────────────────────

const HEALTH_MULTIPLIERS: Record<string, number> = {
  healthy: 1.0,
  degraded: 0.5,
  unhealthy: 0.0,
  unreachable: 0.0,
}

// ── Scoring Functions ─────────────────────────────────────────────────────────

/**
 * Score a compute device for how well it matches a placement request.
 *
 * Factors: base device-class score, workload affinity, health, and
 * available-memory headroom.
 *
 * Returns a score in [0, 1].
 */
export function scoreDeviceForWorkload(
  device: PrismComputeDevice,
  request: PrismFabricPlacementRequest,
): number {
  const baseScore = DEVICE_CLASS_BASE_SCORES[device.deviceClass] ?? 0.1
  const workloadPref = DEVICE_CLASS_WORKLOAD_TABLE[device.deviceClass]?.[request.workloadClass] ?? 0.3
  const healthMult = HEALTH_MULTIPLIERS[device.healthState] ?? 0.0

  // Memory headroom: at least 10% free → no penalty; below → linear drop.
  const freeFrac =
    device.availableMemoryBytes / Math.max(device.availableMemoryBytes + device.reservedMemoryBytes, 1)
  const memoryScore = freeFrac >= 0.1 ? 1.0 : freeFrac / 0.1

  return baseScore * 0.25 + workloadPref * 0.35 + healthMult * 0.25 + memoryScore * 0.15
}

/**
 * Score a memory domain for a placement request.
 *
 * Factors: domain-kind base score, capacity headroom.
 *
 * Returns a score in [0, 1].
 */
export function scoreMemoryDomain(
  domain: PrismMemoryDomainInfo,
  request: PrismFabricPlacementRequest,
): number {
  const baseScore = MEMORY_DOMAIN_BASE_SCORES[domain.domainKind] ?? 0.3
  const freeFrac =
    (domain.totalBytes - domain.usedBytes - domain.reservedBytes) /
    Math.max(domain.totalBytes, 1)
  const capacityScore = Math.min(freeFrac * 2, 1.0)

  return baseScore * 0.5 + capacityScore * 0.5
}

/**
 * Score a transport edge for a transfer of `bytes`.
 *
 * Lower latency and higher bandwidth produce a higher score.
 * Returns a score in [0, 1] where higher = better (lower cost).
 */
export function scoreTransferCost(
  edge: PrismMemoryTransportEdge,
  bytes: number,
): number {
  if (edge.availabilityState === "unavailable") return 0.0
  if (edge.availabilityState === "untested") return 0.3

  // Bandwidth score: 0 if unknown, else fraction of 100 GB/s ceiling.
  const bw = edge.measuredBandwidthBytesPerSecond
  const bwScore = bw !== null ? Math.min(bw / 100_000_000_000, 1.0) : 0.5

  // Latency penalty: 1 at 0 us → 0 at >= 100 us.
  const lat = edge.measuredLatencyMicroseconds
  const latPenalty = lat !== null ? Math.max(1.0 - lat / 100, 0.0) : 0.5

  // Degraded edges lose half value.
  const availMult = edge.availabilityState === "degraded" ? 0.5 : 1.0

  const base = bwScore * 0.5 + latPenalty * 0.5
  return base * availMult
}

/**
 * Score KV locality for a request.
 *
 * If existing KV cache is already in the target domain, `preferLocality` gives a
 * full bonus (1.0).  Otherwise locality is neutral (0.5).
 *
 * Returns a score in [0, 1].
 */
export function scoreKvLocality(
  hasExistingKv: boolean,
  preferLocality: boolean,
): number {
  if (hasExistingKv && preferLocality) return 1.0
  if (hasExistingKv) return 0.8
  return 0.5
}
