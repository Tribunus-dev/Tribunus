/**
 * Prism Phase Role Separation — Phase-Aware Readiness
 *
 * Pure functions that combine phase subsystem health and capacity signals
 * into a unified readiness assessment.
 */

import type { PrismWorkerReadiness } from "./phase-role-types"

/**
 * Assess overall phase readiness from individual prefill and decode signals.
 *
 * A worker is considered phase-ready when both prefill and decode subsystems
 * report ready AND their respective capacity indicators are available.
 */
export function assessPhaseReadiness(
  prefillReady: boolean,
  decodeReady: boolean,
  prefillCap: boolean,
  decodeCap: boolean,
): PrismWorkerReadiness {
  const prefillOk = prefillReady && prefillCap
  const decodeOk = decodeReady && decodeCap

  return {
    workerId: "",
    overallReady: prefillOk && decodeOk,
    prefillReady: prefillOk,
    decodeReady: decodeOk,
    admittedModelCount: 0,
    prefillCapacityAvailable: prefillCap,
    decodeCapacityAvailable: decodeCap,
    drainState: "none",
    observedAt: new Date().toISOString(),
  }
}

/**
 * Determine whether a worker with the given readiness assessment can
 * handle a request requiring the specified phases.
 *
 * @param readiness - the worker's current phase readiness
 * @param requiresPrefill - whether the request needs prefill
 * @param requiresDecode - whether the request needs decode
 */
export function isWorkerPhaseReady(
  readiness: PrismWorkerReadiness,
  requiresPrefill: boolean,
  requiresDecode: boolean,
): boolean {
  if (requiresPrefill && !readiness.prefillReady) return false
  if (requiresDecode && !readiness.decodeReady) return false
  return true
}
