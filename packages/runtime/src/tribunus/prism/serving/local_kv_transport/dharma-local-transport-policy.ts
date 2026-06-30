/**
 * Prism Local-Host KV Transport — Dharma Policy
 *
 * Pure policy functions that govern when and how local-host real transport
 * is permitted.
 */

import type { DharmaLocalTransportPolicy } from "./local-transport-types"

/**
 * Create a strict default policy that permits only simulated handoffs.
 * Every real transport flag is off; budgets are set to zero so that
 * `isHandoffWithinPolicy` denies by default.
 */
export function createDefaultLocalTransportPolicy(): DharmaLocalTransportPolicy {
  return {
    allowSimulatedHandoff: true,
    allowLocalHostRealTransport: false,
    allowFutureNetworkTransport: false,
    allowedTransportBackends: [],
    maximumHandoffBytes: 0,
    maximumHandoffDurationMs: 0,
    maximumConcurrentHandoffs: 0,
    requireSameHostAuthorityDomain: true,
    requireStrictRepresentationCompatibility: true,
    requireDestinationSignature: true,
    requireSourceCleanupReceipt: true,
  }
}

/**
 * Create a permissive policy that allows local-host real transport with
 * generous (but bounded) budgets.
 */
export function createPermissiveLocalTransportPolicy(): DharmaLocalTransportPolicy {
  return {
    allowSimulatedHandoff: true,
    allowLocalHostRealTransport: true,
    allowFutureNetworkTransport: false,
    allowedTransportBackends: ["linux_unix_socket_shared_memory"],
    maximumHandoffBytes: 512 * 1024 * 1024, // 512 MiB
    maximumHandoffDurationMs: 60_000,        // 60 seconds
    maximumConcurrentHandoffs: 8,
    requireSameHostAuthorityDomain: true,
    requireStrictRepresentationCompatibility: true,
    requireDestinationSignature: true,
    requireSourceCleanupReceipt: true,
  }
}

/**
 * Return true when the policy permits real (non-simulated) local-host
 * transport.  Checks `allowLocalHostRealTransport` and that there is at
 * least one allowed backend.
 */
export function isRealTransportPermitted(policy: DharmaLocalTransportPolicy): boolean {
  return policy.allowLocalHostRealTransport && policy.allowedTransportBackends.length > 0
}

/**
 * Check whether a specific handoff falls within the policy's budget.
 *
 * Returns `{ allowed: true, reason: null }` when all constraints are met.
 */
export function isHandoffWithinPolicy(
  policy: DharmaLocalTransportPolicy,
  bytes: number,
  durationMs: number,
  concurrent: number,
): { allowed: boolean; reason: string | null } {
  if (bytes > policy.maximumHandoffBytes) {
    return { allowed: false, reason: `handoff bytes (${bytes}) exceed policy maximum (${policy.maximumHandoffBytes})` }
  }
  if (durationMs > policy.maximumHandoffDurationMs) {
    return { allowed: false, reason: `handoff duration (${durationMs}ms) exceeds policy maximum (${policy.maximumHandoffDurationMs}ms)` }
  }
  if (concurrent > policy.maximumConcurrentHandoffs) {
    return { allowed: false, reason: `concurrent handoffs (${concurrent}) exceed policy maximum (${policy.maximumConcurrentHandoffs})` }
  }
  return { allowed: true, reason: null }
}
