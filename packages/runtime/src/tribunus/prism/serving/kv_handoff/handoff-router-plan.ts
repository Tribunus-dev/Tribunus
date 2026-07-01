/**
 * Prism Disaggregated Route Plan — creation and predicates
 */

import type {
  PrismDisaggregatedRoutePlan,
  PhaseCoLocationPolicy,
} from "./handoff-types"

// ── Route Plan Factories ────────────────────────────────────────────────────

/**
 * Creates a route plan with same-worker pinning (prefill + decode on one worker).
 */
export function createSameWorkerRoutePlan(
  requestId: string,
  workerId: string,
): PrismDisaggregatedRoutePlan {
  return {
    routeId: `route-${workerId}-${requestId}`,
    requestId,
    prefillWorkerId: workerId,
    decodeWorkerId: workerId,
    executionPinningPolicy: "same_worker_required" as PhaseCoLocationPolicy,
    handoffRequired: false,
    handoffId: null,
    handoffMode: null,
    compatibilityResult: "compatible_same_worker",
    sourceRetentionPolicy: "retain_until_destination_commit",
    handoffDeadlineAt: null,
    prefillSelectionReason: "single_worker_optimization",
    decodeSelectionReason: "single_worker_optimization",
    handoffSelectionReason: null,
    routeState: "same_worker_pinned",
  }
}

/**
 * Creates a route plan with simulated disaggregation (two workers, no real transport).
 */
export function createSimulatedHandoffRoutePlan(
  requestId: string,
  prefillWorkerId: string,
  decodeWorkerId: string,
  handoffId: string,
): PrismDisaggregatedRoutePlan {
  return {
    routeId: `route-dag-${prefillWorkerId}-${decodeWorkerId}`,
    requestId,
    prefillWorkerId,
    decodeWorkerId,
    executionPinningPolicy: "simulated_handoff_required" as PhaseCoLocationPolicy,
    handoffRequired: true,
    handoffId,
    handoffMode: "simulation_only",
    compatibilityResult: "compatible_simulation",
    sourceRetentionPolicy: "retain_until_destination_commit",
    handoffDeadlineAt: new Date(Date.now() + 30_000).toISOString(),
    prefillSelectionReason: "simulated_handoff_prefill_worker",
    decodeSelectionReason: "simulated_handoff_decode_worker",
    handoffSelectionReason: "simulation_mode_eligible",
    routeState: "handoff_required",
  }
}

// ── Predicates ──────────────────────────────────────────────────────────────

/**
 * Returns true when the route plan requires cross-worker KV handoff (disaggregated).
 */
export function isRoutePlanDisaggregated(
  plan: PrismDisaggregatedRoutePlan,
): boolean {
  return plan.prefillWorkerId !== plan.decodeWorkerId
}

/**
 * Returns true when the route plan can be or is already routed through a handoff.
 */
export function canRouteToHandoff(
  plan: PrismDisaggregatedRoutePlan,
): boolean {
  return (
    plan.handoffRequired === true &&
    plan.handoffId !== null &&
    plan.executionPinningPolicy !== "not_supported"
  )
}
