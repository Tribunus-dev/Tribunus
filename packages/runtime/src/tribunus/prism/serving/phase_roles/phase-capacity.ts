/**
 * Prism Phase Role Separation — Phase Capacity Accounting
 *
 * Pure functions for computing headroom, admission decisions, and
 * worker eligibility based on phase capacity snapshots.
 */

import type { PrismPhaseCapacitySnapshot } from "./phase-role-types"

/**
 * Create a typed PrismPhaseCapacitySnapshot with the current timestamp.
 */
export function createPhaseCapacitySnapshot(
  workerId: string,
  prefillActive: number,
  prefillMax: number,
  decodeActive: number,
  decodeMax: number,
  decodeKv: number,
  decodeKvMax: number,
): PrismPhaseCapacitySnapshot {
  return {
    workerId,
    observedAt: new Date().toISOString(),
    prefillActiveOperations: prefillActive,
    prefillMaximumOperations: prefillMax,
    prefillPendingOperations: 0,
    prefillMemoryBytesInUse: 0,
    prefillMemoryBytesLimit: 0,
    decodeActiveOperations: decodeActive,
    decodeMaximumOperations: decodeMax,
    decodePendingOperations: 0,
    decodeActiveKvNamespaces: decodeKv,
    decodeMaximumKvNamespaces: decodeKvMax,
    decodeMemoryBytesInUse: 0,
    decodeMemoryBytesLimit: 0,
  }
}

/**
 * How many additional prefill operations this worker can accept.
 * Negative values indicate over-capacity.
 */
export function getPrefillHeadroom(snapshot: PrismPhaseCapacitySnapshot): number {
  return snapshot.prefillMaximumOperations - snapshot.prefillActiveOperations
}

/**
 * How many additional decode operations this worker can accept.
 * Negative values indicate over-capacity.
 */
export function getDecodeHeadroom(snapshot: PrismPhaseCapacitySnapshot): number {
  return snapshot.decodeMaximumOperations - snapshot.decodeActiveOperations
}

/**
 * Combined headroom is the lesser of prefill and decode headroom.
 * A worker must have room in BOTH phases to accept an end-to-end request.
 */
export function getCombinedHeadroom(snapshot: PrismPhaseCapacitySnapshot): number {
  return Math.min(getPrefillHeadroom(snapshot), getDecodeHeadroom(snapshot))
}

/**
 * Whether a prefill unit can be admitted.
 *
 * @param snapshot - current capacity
 * @param requiredOps - estimated operations needed (default 1)
 */
export function canAdmitPrefill(
  snapshot: PrismPhaseCapacitySnapshot,
  requiredOps: number = 1,
): boolean {
  return getPrefillHeadroom(snapshot) >= requiredOps
}

/**
 * Whether a decode unit can be admitted.
 *
 * @param snapshot - current capacity
 * @param requiredNs - estimated namespace slots needed (default 1)
 */
export function canAdmitDecode(
  snapshot: PrismPhaseCapacitySnapshot,
  requiredNs: number = 1,
): boolean {
  return getDecodeHeadroom(snapshot) >= requiredNs
}

/**
 * Determine whether a worker is eligible by capacity given what phases
 * the request requires.
 *
 * Returns `{ eligible: true, reason: null }` when all required phases
 * have sufficient headroom, or a descriptive reason when they do not.
 */
export function isWorkerEligibleByCapacity(
  snapshot: PrismPhaseCapacitySnapshot,
  requiresPrefill: boolean,
  requiresDecode: boolean,
): { eligible: boolean; reason: string | null } {
  if (requiresPrefill) {
    const headroom = getPrefillHeadroom(snapshot)
    if (headroom <= 0) {
      return {
        eligible: false,
        reason: `Prefill capacity exhausted: ${snapshot.prefillActiveOperations}/${snapshot.prefillMaximumOperations} active`,
      }
    }
  }

  if (requiresDecode) {
    const headroom = getDecodeHeadroom(snapshot)
    if (headroom <= 0) {
      return {
        eligible: false,
        reason: `Decode capacity exhausted: ${snapshot.decodeActiveOperations}/${snapshot.decodeMaximumOperations} active`,
      }
    }
  }

  return { eligible: true, reason: null }
}
