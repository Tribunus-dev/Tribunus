/**
 * Prism llm-d Worker — Health and Readiness Assessment
 *
 * Pure functions for evaluating worker health and readiness
 * based on lifecycle state, model states, and inflight load.
 */

import type { PrismModelWorker, PrismWorkerModel, WorkerHealthState } from "./worker-types"

/**
 * Assess overall worker health from lifecycle, model states, and inflight count.
 *
 * - draining lifecycle always yields "draining"
 * - failed lifecycle always yields "unhealthy"
 * - zero loaded models yields "unhealthy"
 * - inflight >= max (derived from caps default 64) yields "degraded"
 * - no available models yields "degraded"
 * - otherwise "healthy"
 */
export function assessHealth(
  worker: PrismModelWorker,
  models: PrismWorkerModel[],
  inflight: number,
): WorkerHealthState {
  if (worker.lifecycleState === "draining") return "draining"
  if (worker.lifecycleState === "failed" || worker.lifecycleState === "stopped") return "unhealthy"

  const loadedModels = models.filter((m) => m.modelState === "loaded")
  if (loadedModels.length === 0) return "unhealthy"

  if (inflight >= 64) return "degraded"

  return "healthy"
}

/**
 * Determine whether the worker is ready to accept requests.
 * Requires a lifecycle state that can serve and at least one loaded model.
 */
export function isReady(worker: PrismModelWorker, models: PrismWorkerModel[]): boolean {
  const acceptStates: Set<string> = new Set(["ready", "serving", "degraded"])
  if (!acceptStates.has(worker.lifecycleState)) return false

  return models.some((m) => m.modelState === "loaded")
}
