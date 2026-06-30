/**
 * Prism Multi-Worker Router — Drain Manager
 *
 * Manages worker drain lifecycle: request, complete, resume, and query.
 * A draining worker stops receiving new requests but allows in-flight
 * requests to finish naturally.
 */

import type { RouterWorkerState } from "./router-types"
import { DrainError } from "./router-errors"

/**
 * Request drain on a worker. Sets the draining flag and prevents new selection.
 * Throws if the worker is not in a drainable state (already draining, not healthy, not ready).
 */
export function requestDrain(workerId: string, workers: RouterWorkerState[]): RouterWorkerState[] {
  return workers.map((w) => {
    if (w.workerId !== workerId) return w

    if (w.draining) {
      throw new DrainError(`Worker ${workerId} is already draining`)
    }
    if (!w.healthy) {
      throw new DrainError(`Worker ${workerId} is unhealthy and cannot be drained gracefully`)
    }
    if (!w.ready) {
      throw new DrainError(`Worker ${workerId} is not ready and cannot be drained`)
    }

    return { ...w, draining: true }
  })
}

/**
 * Complete drain on a worker. Marks the worker as not draining and not ready.
 * Intended for shutdown or removal from the pool. Throws if the worker is not draining.
 */
export function completeDrain(workerId: string, workers: RouterWorkerState[]): RouterWorkerState[] {
  let found = false
  const updated = workers.map((w) => {
    if (w.workerId !== workerId) return w
    if (!w.draining) {
      throw new DrainError(`Worker ${workerId} is not currently draining`)
    }
    found = true
    return { ...w, draining: false, ready: false, healthy: false }
  })
  if (!found) {
    throw new DrainError(`Worker ${workerId} not found`)
  }
  return updated
}

/**
 * Resume a draining worker. Cancels the drain and restores the worker to active duty.
 * Throws if the worker is not draining.
 */
export function resumeWorker(workerId: string, workers: RouterWorkerState[]): RouterWorkerState[] {
  let found = false
  const updated = workers.map((w) => {
    if (w.workerId !== workerId) return w
    if (!w.draining) {
      throw new DrainError(`Worker ${workerId} is not draining and cannot be resumed`)
    }
    found = true
    return { ...w, draining: false }
  })
  if (!found) {
    throw new DrainError(`Worker ${workerId} not found`)
  }
  return updated
}

/**
 * Check whether a worker is currently draining.
 */
export function isWorkerDraining(worker: RouterWorkerState): boolean {
  return worker.draining
}

/**
 * Get all workers currently in draining state.
 */
export function getDrainingWorkers(workers: RouterWorkerState[]): RouterWorkerState[] {
  return workers.filter((w) => w.draining)
}
