/**
 * Prism Heterogeneous Memory Fabric — Placement Planner
 *
 * Main placement engine that enumerates candidates, scores them, and selects
 * the best placement within the fabric memory budget.
 */

import type {
  PrismTopologyGraph,
  PrismFabricPlacementRequest,
  PrismFabricPlacementDecision,
  PrismFabricMemoryBudget,
  PrismComputeDevice,
  PrismMemoryTransportEdge,
  PrismMemoryDomainInfo,
} from "./fabric-types"

import { PlacementError } from "./fabric-errors"
import {
  scoreDeviceForWorkload,
  scoreMemoryDomain,
  scoreTransferCost,
  scoreKvLocality,
} from "./placement-scorer"

// ── Scoring Weights ───────────────────────────────────────────────────────────

const WEIGHT_DEVICE = 0.25
const WEIGHT_DOMAIN = 0.25
const WEIGHT_TRANSFER = 0.3
const WEIGHT_KV = 0.2

// ── Candidate Enumeration ─────────────────────────────────────────────────────

/**
 * Enumerate all viable placement decisions for a request given the topology.
 *
 * A candidate is created for every device that passes `isDeviceAllowed` and
 * has at least one associated memory domain in the topology.
 */
export function enumerateCandidatePlacements(
  graph: PrismTopologyGraph,
  request: PrismFabricPlacementRequest,
): PrismFabricPlacementDecision[] {
  const decisions: PrismFabricPlacementDecision[] = []

  for (const device of graph.devices) {
    if (!isDeviceAllowed(request, device.deviceId, graph.devices)) {
      continue
    }

    const deviceDomains = graph.memoryDomains.filter(d =>
      d.deviceIds.includes(device.deviceId),
    )

    if (deviceDomains.length === 0) continue

    // Pick the domain with most free space.
    const bestDomain = deviceDomains.reduce((a, b) => {
      const aFree = a.totalBytes - a.usedBytes - a.reservedBytes
      const bFree = b.totalBytes - b.usedBytes - b.reservedBytes
      return aFree >= bFree ? a : b
    })

    // Find transport edges reaching this domain.
    const transportPath = findTransportPath(graph.transportEdges, bestDomain.domainId)

    // Estimate costs.
    const transferBytes =
      (request.inputTokenCount + request.requestedOutputTokens) * 512 // rough byte-per-token
    const estTransferCost = estimateMovementCost(transferBytes, transportPath[0] ?? null)
    const estExecCost = estimateExecutionCost(
      request.inputTokenCount,
      request.requestedOutputTokens,
      false,
    )

    const decision: PrismFabricPlacementDecision = {
      decisionId: `decision-${request.requestId}-${device.deviceId}`,
      selectedDeviceId: device.deviceId,
      selectedMemoryDomainId: bestDomain.domainId,
      selectedTransportPath: transportPath,
      sourceResidency: null,
      destinationResidency: bestDomain.domainKind,
      estimatedTransferCost: estTransferCost,
      estimatedExecutionCost: estExecCost,
      expectedKvReuse: false,
      fallbackDecisionIds: [],
      policyBasis: "enumerate",
      decisionReason: `Candidate on ${device.deviceClass} device ${device.deviceId}`,
    }

    decisions.push(decision)
  }

  return decisions
}

// ── Device Allowance Check ────────────────────────────────────────────────────

/**
 * Check whether a device is allowed for a placement request.
 *
 * Respects `allowedDevices` (empty = allow all) and `forbiddenDevices`.
 */
export function isDeviceAllowed(
  request: PrismFabricPlacementRequest,
  deviceId: string,
  devices: PrismComputeDevice[],
): boolean {
  // Explicitly forbidden.
  if (request.forbiddenDevices.includes(deviceId)) return false

  // Explicitly allowed (non-empty list).
  if (request.allowedDevices.length > 0) {
    return request.allowedDevices.includes(deviceId)
  }

  // No explicit constraints → default allowed.
  return true
}

// ── Placement Selection ───────────────────────────────────────────────────────

/**
 * Select the best placement decision for a request within the memory budget.
 *
 * Returns `null` when no viable placement exists (callers should use
 * `makeFallbackDecision`).
 */
export function selectPlacement(
  graph: PrismTopologyGraph,
  request: PrismFabricPlacementRequest,
  budget: PrismFabricMemoryBudget,
): PrismFabricPlacementDecision | null {
  const candidates = enumerateCandidatePlacements(graph, request)

  if (candidates.length === 0) return null

  // Score and filter by budget.
  const scored = candidates
    .map(d => ({ decision: d, score: scorePlacement(d, request) }))
    .filter(({ decision }) => {
      // Check that the selected domain has capacity.
      const domain = graph.memoryDomains.find(
        m => m.domainId === decision.selectedMemoryDomainId,
      )
      if (!domain) return false
      const usedFrac =
        (domain.usedBytes + domain.reservedBytes) / Math.max(domain.totalBytes, 1)
      return usedFrac < budget.emergencyReclaimThreshold
    })
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return null

  const best = scored[0].decision
  best.policyBasis = "scored"
  best.decisionReason = `Selected device ${best.selectedDeviceId} with score ${scored[0].score.toFixed(3)}`
  return best
}

// ── Cost Estimation ───────────────────────────────────────────────────────────

/**
 * Estimate the cost of moving `transferBytes` across a transport edge.
 *
 * Returns a dimensionless cost where higher = more expensive.
 */
export function estimateMovementCost(
  transferBytes: number,
  edge: PrismMemoryTransportEdge | null,
): number {
  if (edge === null) return transferBytes / (1024 * 1024) // fallback: per-MB cost

  if (edge.availabilityState === "unavailable") return Infinity

  const bw = edge.measuredBandwidthBytesPerSecond
  const lat = edge.measuredLatencyMicroseconds ?? 0

  if (bw !== null && bw > 0) {
    // Time-based cost: transfer time (seconds * 1000) + latency penalty (us / 10)
    return (transferBytes / bw) * 1000 + lat / 10
  }

  // No bandwidth measurement → linear byte cost scaled down.
  return transferBytes / (1024 * 1024)
}

/**
 * Estimate the cost of executing a request on a device.
 *
 * Returns a dimensionless cost where higher = more expensive.
 */
export function estimateExecutionCost(
  inputTokens: number,
  outputTokens: number,
  hasKvReuse: boolean,
): number {
  const kvReuseFactor = hasKvReuse ? 0.6 : 1.0
  // Prefill costs ~0.5 per input token; decode costs ~1.0 per output token.
  return (inputTokens * 0.5 + outputTokens * 1.0) * kvReuseFactor
}

// ── Scored Ranking ────────────────────────────────────────────────────────────

/**
 * Produce a composite score for a placement decision.
 *
 * Combines device suitability, memory domain quality, transport cost
 * (inverted), and KV locality.  Higher score = better placement.
 */
export function scorePlacement(
  decision: PrismFabricPlacementDecision,
  request: PrismFabricPlacementRequest,
): number {
  // We don't have the full device/domain objects inside a decision, so we
  // derive scores from the decision's own fields.
  const transferCostScore = clamp01(
    1.0 - (decision.estimatedTransferCost > 0 ? decision.estimatedTransferCost / 5000 : 0),
  )
  const execCostScore = clamp01(
    1.0 - (decision.estimatedExecutionCost > 0 ? decision.estimatedExecutionCost / 10000 : 0),
  )
  const kvScore = scoreKvLocality(decision.expectedKvReuse, true)

  return (
    execCostScore * WEIGHT_DEVICE +
    transferCostScore * WEIGHT_DOMAIN +
    transferCostScore * WEIGHT_TRANSFER +
    kvScore * WEIGHT_KV
  )
}

// ── Fallback ──────────────────────────────────────────────────────────────────

/**
 * Create a fallback placement decision when no candidate passes all checks.
 *
 * The fallback targets CPU system memory as the safest default domain.
 */
export function makeFallbackDecision(reason: string): PrismFabricPlacementDecision {
  return {
    decisionId: "fallback-cpu",
    selectedDeviceId: "cpu-fallback",
    selectedMemoryDomainId: "cpu-system-memory-fallback",
    selectedTransportPath: [],
    sourceResidency: null,
    destinationResidency: "cpu_system_memory",
    estimatedTransferCost: 0,
    estimatedExecutionCost: 0,
    expectedKvReuse: false,
    fallbackDecisionIds: [],
    policyBasis: "fallback",
    decisionReason: reason,
  }
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * Find the transport path to a domain — the first available edge targeting it.
 */
function findTransportPath(
  edges: PrismMemoryTransportEdge[],
  targetDomainId: string,
): PrismMemoryTransportEdge[] {
  const direct = edges.filter(
    e =>
      (e.sourceDomainId === targetDomainId || e.destinationDomainId === targetDomainId) &&
      e.availabilityState !== "unavailable",
  )
  return direct.slice(0, 1)
}
