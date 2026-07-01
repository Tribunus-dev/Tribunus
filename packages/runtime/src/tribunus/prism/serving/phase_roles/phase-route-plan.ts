/**
 * Prism Prefill/Decode Role Separation — Route Planner
 *
 * Creates and validates route plans that enforce same-worker execution
 * pinning for prefill→decode phase sequencing.
 *
 * Same-worker invariant: prefillWorkerId === decodeWorkerId. No KV transfer
 * between distinct workers — execution pins are co-located on one instance.
 */

import { ulid } from "ulid"
import type {
  PrismRoutePlan,
  PhaseCoLocationPolicy,
  PrismWorkerCompatibilityEnvelopeV2,
  PrismPhaseCapacitySnapshot,
} from "./phase-role-types"
import type { RouterWorkerState, SelectionWeights } from "../multi_worker/router-types"

// ── Route Plan Construction -------------------------------------------------

export function createRoutePlan(
  requestId: string,
  candidates: string[],
  selectedWorkerId: string,
  prefillReason: string,
  decodeReason: string,
): PrismRoutePlan {
  const now = new Date().toISOString()
  return {
    routeId: ulid(),
    requestId,
    modelArtifactDigest: "",
    tokenizerDigest: "",
    candidateWorkers: candidates,
    selectedWorkerId,
    prefillWorkerId: selectedWorkerId,
    decodeWorkerId: selectedWorkerId,
    executionPinningPolicy: "same_worker_required",
    prefillSelectionReason: prefillReason,
    decodeSelectionReason: decodeReason,
    prefixAffinitySummary: "",
    prefillLoadSummary: "",
    decodeLoadSummary: "",
    phaseBudgetSummary: "",
    createdAt: now,
  }
}

// ── Route Plan Validation ---------------------------------------------------

export function validateRoutePlan(
  plan: PrismRoutePlan,
): { valid: boolean; reason: string | null } {
  if (!plan.routeId || plan.routeId.length === 0) {
    return { valid: false, reason: "routeId must be non-empty" }
  }
  if (!plan.requestId || plan.requestId.length === 0) {
    return { valid: false, reason: "requestId must be non-empty" }
  }
  if (!plan.selectedWorkerId || plan.selectedWorkerId.length === 0) {
    return { valid: false, reason: "selectedWorkerId must be non-empty" }
  }
  if (!plan.prefillWorkerId || plan.prefillWorkerId.length === 0) {
    return { valid: false, reason: "prefillWorkerId must be non-empty" }
  }
  if (!plan.decodeWorkerId || plan.decodeWorkerId.length === 0) {
    return { valid: false, reason: "decodeWorkerId must be non-empty" }
  }
  if (plan.candidateWorkers.length === 0) {
    return { valid: false, reason: "candidateWorkers must not be empty" }
  }
  if (!plan.candidateWorkers.includes(plan.selectedWorkerId)) {
    return { valid: false, reason: "selectedWorkerId must be in candidateWorkers" }
  }
  try {
    const d = new Date(plan.createdAt)
    if (isNaN(d.getTime())) {
      return { valid: false, reason: "createdAt must be a valid ISO timestamp" }
    }
  } catch {
    return { valid: false, reason: "createdAt must be a valid ISO timestamp" }
  }
  return { valid: true, reason: null }
}

// ── Same-Worker Check -------------------------------------------------------

export function isRoutePlanSameWorker(plan: PrismRoutePlan): boolean {
  return plan.prefillWorkerId === plan.decodeWorkerId
}

// ── Worker Scoring ----------------------------------------------------------

/**
 * Score a candidate worker for phase routing.
 *
 * Combines health, load, drain state, cache affinity, and error history into
 * a single score. Higher is better. The caller should normalize or compare
 * scores across candidates.
 *
 * Component scoring (each 0..1, multiplied by its weight):
 *   health:      1.0 if healthy and ready, 0.5 if healthy not ready, 0.0 unhealthy
 *   load:        fraction of remaining capacity (1 - activeRequests/maxConcurrent)
 *   drain:       1.0 not draining, 0.0 draining (binary penalty)
 *   cacheAffinity: prefixAffinity clamped to 0..1 (passed in)
 *   errors:      1.0 if no lastError, 0.5 if lastError exists
 */
export function scorePhaseWorker(
  worker: RouterWorkerState,
  env: PrismWorkerCompatibilityEnvelopeV2,
  capacity: PrismPhaseCapacitySnapshot | null,
  prefixAffinity: number,
  weights: SelectionWeights,
): number {
  let score = 0

  // Health component
  const healthScore = worker.healthy ? (worker.ready ? 1.0 : 0.5) : 0.0
  score += weights.healthWeight * healthScore

  // Load component (fraction of remaining capacity)
  const loadScore =
    worker.maxConcurrentRequests > 0
      ? 1 - Math.min(worker.activeRequests / worker.maxConcurrentRequests, 1)
      : 0.0
  score += weights.loadWeight * loadScore

  // Drain component (binary: not draining = good)
  const drainScore = worker.draining ? 0.0 : 1.0
  score += weights.drainWeight * drainScore

  // Cache affinity component (clamped 0..1)
  const affinityScore = Math.max(0, Math.min(1, prefixAffinity))
  score += weights.cacheAffinityWeight * affinityScore

  // Error component (inverse: fewer recent errors = higher score)
  const errorScore = worker.lastError ? 0.5 : 1.0
  score += weights.errorWeight * errorScore

  return score
}
