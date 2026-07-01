/**
 * Prism Multi-Worker Router — Load Scoring
 *
 * Pure functions scoring worker fitness based on load, health, errors, and drain state.
 * Lower scores are better (preferred for selection).
 */

import type { RouterWorkerState } from "./router-types"

/**
 * Score the current load fraction. Normalized 0–1 where 0 = idle, 1 = full.
 */
export function scoreLoad(worker: RouterWorkerState): number {
  if (worker.maxConcurrentRequests <= 0) return 1
  return worker.activeRequests / worker.maxConcurrentRequests
}

/**
 * Fraction of remaining capacity (0 = none, 1 = fully available).
 */
export function getLoadHeadroom(worker: RouterWorkerState): number {
  if (worker.maxConcurrentRequests <= 0) return 0
  return Math.max(0, (worker.maxConcurrentRequests - worker.activeRequests) / worker.maxConcurrentRequests)
}

/**
 * Score health state: 0 = fully healthy, 0.5 = degraded, 1 = unhealthy.
 */
export function scoreHealth(worker: RouterWorkerState): number {
  if (!worker.healthy) return 1
  if (!worker.ready) return 0.5
  if (worker.lastError !== null) return 0.3
  return 0
}

/**
 * Score based on recent errors: higher when lastError is recent/has content.
 */
export function scoreErrors(worker: RouterWorkerState): number {
  if (worker.lastError === null) return 0
  // If the error is a non-null string, score proportional to its severity indicator
  if (worker.lastError.length > 0) return Math.min(1, worker.lastError.length / 200)
  return 0
}

/**
 * Score drain state: 0 = not draining, 0.5 = draining (soft penalty even though filter already excludes).
 */
export function scoreDrain(worker: RouterWorkerState): number {
  return worker.draining ? 0.5 : 0
}
