/**
 * Prism Prefill/Decode Role Separation — Route Validator
 *
 * Validates the same-worker execution invariant for route plans and
 * checks worker phase capabilities under the co-location policy.
 *
 * Same-worker invariant: prefill and decode phases MUST execute on the
 * same worker instance. No cross-worker KV transfer path exists in the
 * phase-role architecture.
 */

import type { PrismRoutePlan, PrismWorkerCompatibilityEnvelopeV2 } from "./phase-role-types"
import { SameWorkerInvariantError } from "./phase-role-errors"

// ── Same-Worker Invariant Check --------------------------------------------

export function checkSameWorkerInvariant(
  plan: PrismRoutePlan,
): { passed: boolean; reason: string | null } {
  if (plan.prefillWorkerId !== plan.decodeWorkerId) {
    return {
      passed: false,
      reason: `Same-worker invariant violated: prefill on ${plan.prefillWorkerId}, decode on ${plan.decodeWorkerId}`,
    }
  }
  return { passed: true, reason: null }
}

// ── Worker Phase Capability Check ------------------------------------------

/**
 * Check whether a worker's compatibility envelope can serve the requested
 * prefill and/or decode phases.
 *
 * A unified worker can handle both. A prefill-only worker can only handle
 * prefill. A decode-only worker can only handle decode.
 */
export function checkWorkerPhaseCapability(
  env: PrismWorkerCompatibilityEnvelopeV2,
  requiresPrefill: boolean,
  requiresDecode: boolean,
): { passed: boolean; reason: string | null } {
  const roles = env.workerRoles
  const hasPrefillCapability =
    roles.includes("unified") ||
    roles.includes("prefill_preferred") ||
    roles.includes("prefill_only")
  const hasDecodeCapability =
    roles.includes("unified") ||
    roles.includes("decode_preferred") ||
    roles.includes("decode_only")

  if (requiresPrefill && !hasPrefillCapability) {
    return {
      passed: false,
      reason: `Worker ${env.workerId} lacks prefill capability (roles: ${roles.join(", ")})`,
    }
  }
  if (requiresDecode && !hasDecodeCapability) {
    return {
      passed: false,
      reason: `Worker ${env.workerId} lacks decode capability (roles: ${roles.join(", ")})`,
    }
  }
  if (!requiresPrefill && !requiresDecode) {
    return {
      passed: false,
      reason: "At least one of requiresPrefill or requiresDecode must be true",
    }
  }
  return { passed: true, reason: null }
}

// ── Phase Co-Location Policy Check -----------------------------------------

/**
 * Check that the worker's phase co-location policy supports the same-worker
 * execution model required by the phase-role architecture.
 */
export function checkPhaseCoLocation(
  env: PrismWorkerCompatibilityEnvelopeV2,
): { passed: boolean; reason: string | null } {
  const policy = env.phaseCoLocationPolicy
  if (policy === "same_worker_required" || policy === "future_transfer_capable") {
      return { passed: true, reason: null }
  }
  if (policy === "not_supported") {
      return {
        passed: false,
        reason: `Worker ${env.workerId} does not support phase co-location (policy: not_supported)`,
    }
  }
  // Exhaustive check: policy is typed as PhaseCoLocationPolicy
  // so if we get here with a valid union member it's a value not covered above
      return {
        passed: false,
    reason: `Worker ${env.workerId} has unknown phase co-location policy: ${policy}`,
  }
}
