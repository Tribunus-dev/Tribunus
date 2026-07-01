/**
 * Prism KV Handoff Protocol Simulation — Authorization Checks
 */

import type { PrismKvHandoffRequest, HandoffMode } from "./handoff-types"

/**
 * Checks that the handoff requester is among the set of allowed requesters.
 *
 * Returns `{ authorized: true, reason: null }` on success, or
 * `{ authorized: false, reason: … }` on denial.
 */
export function authorizeHandoff(
  req: PrismKvHandoffRequest,
  allowedRequesters: string[],
): { authorized: boolean; reason: string | null } {
  if (allowedRequesters.includes(req.requestedBy)) {
    return { authorized: true, reason: null }
  }
  return {
    authorized: false,
    reason: `Requester "${req.requestedBy}" is not in the allowed list`,
  }
}

/**
 * Validates a handoff mode against the simulation-only environment.
 *
 * - `"simulation_only"` is valid when `simulationEnabled` is true.
 * - `"future_transport_required"` is never valid in simulation — it requires
 *   a real transport layer not yet implemented.
 */
export function validateHandoffMode(
  mode: HandoffMode,
  simulationEnabled: boolean,
): { valid: boolean; reason: string | null } {
  if (mode === "simulation_only") {
    if (simulationEnabled) {
      return { valid: true, reason: null }
    }
    return { valid: false, reason: "Simulation is not enabled" }
  }

  // future_transport_required
  return {
    valid: false,
    reason: `Mode "${mode}" requires real transport which is not available in simulation`,
  }
}

/**
 * Checks whether a lease permits a handoff to proceed.
 *
 * When the lease explicitly allows the handoff, the answer is always true.
 * When it does not, only `"simulation_only"` mode bypasses the lease guard.
 */
export function checkLeaseAllowsHandoff(
  leaseAllows: boolean,
  mode: HandoffMode,
): boolean {
  if (leaseAllows) return true
  return mode === "simulation_only"
}
