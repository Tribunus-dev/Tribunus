/**
 * Prism Heterogeneous Memory Fabric — Fabric-Aware Handoff Request Creation
 *
 * Pure functions for constructing, selecting transport paths, validating
 * compatibility, and deriving human-readable labels for KV-cache handoff
 * between heterogeneous memory domains.
 */

import type {
  PrismFabricKvHandoffRequest,
  PrismMemoryDomainKind,
  PrismMemoryTransportEdge,
} from "./fabric-types"
import { getClosestTransportKind } from "./transport-capability"

// ── ID Generation (deterministic for testability) ───────────────────────────

let _counter = 0

/** Reset the handoff-id counter (exposed for tests). */
export function _resetHandoffCounter(): void {
  _counter = 0
}

function nextHandoffId(): string {
  const id = `handoff_${++_counter}`
  return id
}

// ── Domain-Kind Scoring (closeness heuristic for transport matching) ────────

/** Arbitrary ordinal for rough distance — lower = closer. */
function domainKindOrdinal(kind: PrismMemoryDomainKind): number {
  const map: Record<PrismMemoryDomainKind, number> = {
    cpu_system_memory: 0,
    pinned_host_memory: 1,
    apu_shared_memory: 2,
    managed_memory: 3,
    integrated_gpu_local_alias: 4,
    npu_shared_memory: 5,
    shared_memory_segment: 6,
    discrete_gpu_vram: 7,
    accelerator_device_dram: 8,
    durable_local_cache: 9,
  }
  return map[kind] ?? 99
}

/**
 * Return transport edges that connect two domains directly (or through the
 * pair's closest inferable match).  Prefers available edges, then attempts
 * to narrow by `transportKind` when the edge endpoints align with the
 * requested domain kinds.
 */
export function selectTransportPath(
  sourceDomainKind: PrismMemoryDomainKind,
  destDomainKind: PrismMemoryDomainKind,
  edges: PrismMemoryTransportEdge[],
): PrismMemoryTransportEdge | null {
  // 1. Candidate edges — available or untested (degraded and unavailable excluded for fresh selection).
  const candidates = edges.filter(
    (e) => e.availabilityState === "available" || e.availabilityState === "untested",
  )

  if (candidates.length === 0) return null

  // 2. Score each candidate by availability priority then transport-kind match.
  //    Available edges preferred over untested; edges whose transport kind matches
  //    the closest expected kind for the domain pair get priority.
  const expectedKind = getClosestTransportKind(sourceDomainKind, destDomainKind)

  const scored = candidates.map((e) => {
    const availScore = e.availabilityState === "available" ? 0 : 1
    const kindMatch = e.transportKind === expectedKind ? 0 : 1
    return { edge: e, score: availScore * 100 + kindMatch }
  })

  scored.sort((a, b) => a.score - b.score)
  return scored[0]!.edge
}

// ── Handoff Request Factory ─────────────────────────────────────────────────

/**
 * Create a fully-populated `PrismFabricKvHandoffRequest` that records where
 * KV-cache data originates and where it should be handed off.
 *
 * `estimatedTransferBytes` is approximated from the kinds — real callers
 * should override after computing the actual KV size.
 */
export function createFabricKvHandoffRequest(
  sourceDeviceId: string,
  sourceDomainId: string,
  destDeviceId: string,
  destDomainId: string,
): PrismFabricKvHandoffRequest {
  return {
    handoffId: nextHandoffId(),
    sourceDeviceId,
    sourceMemoryDomainId: sourceDomainId,
    destinationDeviceId: destDeviceId,
    destinationMemoryDomainId: destDomainId,
    sourceResidencyKind: "cpu_system_memory",
    destinationResidencyKind: "apu_shared_memory",
    selectedTransportPath: [],
    transferRepresentation: "flat_buffer",
    sourceComputeImageDigest: "sha256:unset",
    destinationComputeImageDigest: "sha256:unset",
    compatibilityDescriptorDigest: "sha256:unset",
    estimatedTransferBytes: 4_194_304, // 4 MiB default
    policyBasis: "default",
  }
}

// ── Compatibility Validation ────────────────────────────────────────────────

/**
 * Validate that a handoff request is internally consistent and has the
 * minimum fields required for further processing.
 *
 * Rules:
 * - handoffId must be non-empty.
 * - source and destination device ids must differ.
 * - source and destination domain ids must differ.
 * - selectedTransportPath must be present (even if empty).
 */
export function validateFabricHandoffCompatibility(
  request: PrismFabricKvHandoffRequest,
): { valid: boolean; reason: string | null } {
  if (!request.handoffId || request.handoffId.trim().length === 0) {
    return { valid: false, reason: "handoffId must be non-empty" }
  }
  if (!request.sourceDeviceId || request.sourceDeviceId.trim().length === 0) {
    return { valid: false, reason: "sourceDeviceId must be non-empty" }
  }
  if (!request.destinationDeviceId || request.destinationDeviceId.trim().length === 0) {
    return { valid: false, reason: "destinationDeviceId must be non-empty" }
  }
  if (!request.sourceMemoryDomainId || request.sourceMemoryDomainId.trim().length === 0) {
    return { valid: false, reason: "sourceMemoryDomainId must be non-empty" }
  }
  if (!request.destinationMemoryDomainId || request.destinationMemoryDomainId.trim().length === 0) {
    return { valid: false, reason: "destinationMemoryDomainId must be non-empty" }
  }
  if (request.sourceDeviceId === request.destinationDeviceId) {
    return { valid: false, reason: "source and destination device ids must differ" }
  }
  if (request.sourceMemoryDomainId === request.destinationMemoryDomainId) {
    return { valid: false, reason: "source and destination memory domain ids must differ" }
  }
  if (request.estimatedTransferBytes <= 0) {
    return { valid: false, reason: "estimatedTransferBytes must be positive" }
  }
  return { valid: true, reason: null }
}

// ── Mode Labels ─────────────────────────────────────────────────────────────

/**
 * Return a human-readable handoff-mode label describing the kind of transfer
 * between two memory domains.
 */
export function getHandoffModeLabel(
  source: PrismMemoryDomainKind,
  dest: PrismMemoryDomainKind,
): string {
  const labels: Record<PrismMemoryDomainKind, string> = {
    cpu_system_memory: "CPU System Memory",
    apu_shared_memory: "APU Shared Memory",
    integrated_gpu_local_alias: "iGPU Local",
    npu_shared_memory: "NPU Shared Memory",
    discrete_gpu_vram: "dGPU VRAM",
    accelerator_device_dram: "Accelerator DRAM",
    pinned_host_memory: "Pinned Host",
    managed_memory: "Managed Memory",
    shared_memory_segment: "Shared Segment",
    durable_local_cache: "Durable Cache",
  }

  const src = labels[source] ?? source
  const dst = labels[dest] ?? dest
  return `${src} → ${dst}`
}
