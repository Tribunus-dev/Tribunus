/**
 * Prism Local-Host KV Transport — Coordinator Bridge
 *
 * Pure decision functions that map capability negotiation and lease state
 * to a concrete transport backend selection.
 */

import type { PrismLocalHostKvTransportCapability } from "./local-transport-types"

/**
 * Select a transport backend given source and destination capabilities and
 * whether the lease allows real (non-simulated) transport.
 *
 * Returns `{ backend: null, reason: "…" }` when no suitable backend is
 * available.
 */
export function selectTransportBackend(
  capSource: PrismLocalHostKvTransportCapability,
  capDest: PrismLocalHostKvTransportCapability,
  leaseAllows: boolean,
): { backend: string | null; reason: string | null } {
  // Both must support real transport on the same backend kind.
  if (!capSource.supported || !capDest.supported) {
    return { backend: null, reason: "source or destination does not support local-host transport" }
  }
  if (capSource.backendKind !== capDest.backendKind) {
    return { backend: null, reason: "source and destination backend kinds do not match" }
  }
  if (!leaseAllows) {
    return { backend: null, reason: "lease does not permit real transport" }
  }
  if (capSource.protocolVersion !== capDest.protocolVersion) {
    return { backend: null, reason: "protocol version mismatch between source and destination" }
  }

  return { backend: capSource.backendKind, reason: null }
}

/**
 * Determine whether a real (non-simulated) transport can proceed between
 * source and destination, based on capability flags and host locality.
 */
export function canProceedWithRealTransport(
  sourceCap: boolean,
  destCap: boolean,
  sameHost: boolean,
  leaseAllows: boolean,
): boolean {
  return sourceCap && destCap && sameHost && leaseAllows
}
