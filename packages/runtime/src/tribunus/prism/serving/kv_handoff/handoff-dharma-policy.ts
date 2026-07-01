/**
 * Prism Dharma Handoff Policy — defaults, simulation profiles, enforcement
 */

import type {
  DharmaPrismHandoffPolicy,
  PrismKvHandoffRequest,
  HandoffMode,
} from "./handoff-types"

// ── Policy Factories ────────────────────────────────────────────────────────

/**
 * Returns the default Dharma handoff policy (disallows simulation handoff).
 */
export function createDefaultDharmaHandoffPolicy(): DharmaPrismHandoffPolicy {
  return {
    allowSimulatedHandoff: false,
    allowFutureTransportHandoff: true,
    allowedSourceWorkers: [],
    allowedDestinationWorkers: [],
    requiredArtifactParityMode: "strict",
    requiredTransferRepresentation: null,
    maximumHandoffBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    maximumHandoffDurationMs: 60_000,               // 60 s
    sourceRetentionPolicy: "retain_until_destination_commit",
    requireHandoffReceipt: true,
    requireDestinationSignature: false,
  }
}

/**
 * Returns a simulation-friendly Dharma handoff policy.
 * Allows simulated handoff mode and a relaxed artifact parity mode.
 */
export function createSimulationDharmaHandoffPolicy(): DharmaPrismHandoffPolicy {
  return {
    ...createDefaultDharmaHandoffPolicy(),
    allowSimulatedHandoff: true,
    requiredArtifactParityMode: "evaluation",
  }
}

// ── Policy Enforcement ──────────────────────────────────────────────────────

/**
 * Checks whether the Dharma policy is satisfied for the given request.
 */
export function isHandoffPolicySatisfied(
  policy: DharmaPrismHandoffPolicy,
  request: PrismKvHandoffRequest,
): { satisfied: boolean; reason: string | null } {
  // Simulation-mode requests require allowSimulatedHandoff
  if (
    request.handoffMode === "simulation_only" &&
    !policy.allowSimulatedHandoff
  ) {
    return {
      satisfied: false,
      reason: "simulated_handoff_not_permitted_by_policy",
    }
  }

  // Future-transport requests require allowFutureTransportHandoff
  if (
    request.handoffMode === "future_transport_required" &&
    !policy.allowFutureTransportHandoff
  ) {
    return {
      satisfied: false,
      reason: "future_transport_handoff_not_permitted_by_policy",
    }
  }

  // Source worker whitelist check
  if (
    policy.allowedSourceWorkers.length > 0 &&
    !policy.allowedSourceWorkers.includes(request.sourceWorkerId)
  ) {
    return {
      satisfied: false,
      reason: `source_worker_not_allowed: ${request.sourceWorkerId}`,
    }
  }

  // Destination worker whitelist check
  if (
    policy.allowedDestinationWorkers.length > 0 &&
    !policy.allowedDestinationWorkers.includes(request.destinationWorkerId)
  ) {
    return {
      satisfied: false,
      reason: `destination_worker_not_allowed: ${request.destinationWorkerId}`,
    }
  }

  // Artifact parity check — evaluation mode skips digest matching
  if (
    policy.requiredArtifactParityMode === "strict" &&
    request.sourceComputeImageDigest !== request.destinationComputeImageDigest
  ) {
    return {
      satisfied: false,
      reason:
        "artifact_parity_mismatch: source and destination compute images differ",
    }
  }

  return { satisfied: true, reason: null }
}

/**
 * Checks whether a handoff is permitted under the policy for the given mode.
 */
export function isHandoffPermittedByLease(
  policy: DharmaPrismHandoffPolicy,
  mode: string,
): boolean {
  if (mode === "simulation_only") {
    return policy.allowSimulatedHandoff
  }
  if (mode === "future_transport_required") {
    return policy.allowFutureTransportHandoff
  }
  return false
}
