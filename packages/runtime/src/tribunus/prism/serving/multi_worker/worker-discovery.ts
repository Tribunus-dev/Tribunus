/**
 * Prism Multi-Worker Router — Worker Discovery & Inventory
 *
 * Pure functions that create, remove, and reconcile `RouterWorkerState`
 * values.  They represent the stateless discovery/inventory logic that
 * the `WorkerRegistry` class then uses as its backing.
 *
 * @module worker-discovery
 */

import type { PrismWorkerCompatibilityEnvelope, RouterWorkerState } from "./router-types.ts"
import { WorkerDiscoveryError } from "./router-errors.ts"

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * Create a fresh `RouterWorkerState` from worker identity and its
 * compatibility envelope.
 *
 * Throws `WorkerDiscoveryError` when `workerId` and `envelope.workerId`
 * disagree — catches misrouted data early.
 */
export function discoverWorker(
  workerId: string,
  instanceId: string,
  env: PrismWorkerCompatibilityEnvelope,
): RouterWorkerState {
  if (workerId !== env.workerId) {
    throw new WorkerDiscoveryError(
      `Worker ID mismatch: envelope has "${env.workerId}" but discovery call used "${workerId}"`,
    )
  }

  return {
    workerId,
    instanceId,
    compatibility: env,
    healthy: true,
    ready: true,
    draining: false,
    activeRequests: 0,
    maxConcurrentRequests: env.maximumConcurrentRequests,
    lastHealthCheck: null,
    lastError: null,
    lastKvEventSequence: 0,
    kvEventFreshness: null,
  }
}

// ── Removal ─────────────────────────────────────────────────────────────────

/**
 * Remove a worker from the list by its `workerId`.
 * Returns a new array; the original is not mutated.
 */
export function removeWorker(
  workers: RouterWorkerState[],
  workerId: string,
): RouterWorkerState[] {
  return workers.filter((w) => w.workerId !== workerId)
}

// ── State Reconciliation ────────────────────────────────────────────────────

/**
 * Reconcile a worker's runtime state with the latest health, readiness and
 * inflight-request count reported by the liveness layer.
 *
 * Returns a **new** object; the original is not mutated so that reducer-like
 * callers get referential stability for changed checks.
 */
export function reconcileWorkerState(
  worker: RouterWorkerState,
  health: boolean,
  ready: boolean,
  inflight: number,
): RouterWorkerState {
  return {
    ...worker,
    healthy: health,
    ready: ready && !worker.draining,
    activeRequests: inflight,
    lastHealthCheck: new Date().toISOString(),
    lastError: null,
  }
}
