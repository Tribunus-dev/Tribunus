/**
 * Prism Multi-Worker Router — Worker Registry
 *
 * In-memory registry that tracks all known workers, provides filtered
 * lookups (eligible, by artifact), and supports bulk reconciliation.
 *
 * @module worker-registry
 */

import type { RouterWorkerState } from "./router-types.ts"

// ── Registry ────────────────────────────────────────────────────────────────

export class WorkerRegistry {
  #workers: Map<string, RouterWorkerState> = new Map()

  // ── Mutators ────────────────────────────────────────────────────────────

  /**
   * Register (add or overwrite) a worker in the registry.
   */
  registerWorker(state: RouterWorkerState): void {
    this.#workers.set(state.workerId, state)
  }

  /**
   * Remove a worker by its `workerId`.  Safe to call for an unknown id.
   */
  removeWorker(workerId: string): void {
    this.#workers.delete(workerId)
  }

  // ── Accessors ───────────────────────────────────────────────────────────

  /**
   * Look up a single worker by its `workerId`.
   */
  getWorker(workerId: string): RouterWorkerState | undefined {
    return this.#workers.get(workerId)
  }

  /**
   * Return every known worker (shallow snapshot).
   */
  listWorkers(): RouterWorkerState[] {
    return Array.from(this.#workers.values())
  }

  // ── Filtered Queries ────────────────────────────────────────────────────

  /**
   * Return workers that are ready to accept requests:
   * - healthy
   * - not draining
   * - ready
   */
  getEligibleWorkers(): RouterWorkerState[] {
    return this.listWorkers().filter(
      (w) => w.healthy && !w.draining && w.ready,
    )
  }

  /**
   * Return workers whose compatibility envelope matches the given model
   * artifact digest.  Workers without a compatibility envelope are excluded.
   */
  getWorkersByArtifact(artifactDigest: string): RouterWorkerState[] {
    return this.listWorkers().filter(
      (w) => w.compatibility?.modelArtifactDigest === artifactDigest,
    )
  }

  // ── Targeted Updates ────────────────────────────────────────────────────

  /**
   * Convenience: flip the `healthy` flag on a single worker.
   * No-op when the worker is unknown (not registered).
   */
  updateWorkerHealth(workerId: string, healthy: boolean): void {
    const existing = this.#workers.get(workerId)
    if (existing === undefined) return
    this.#workers.set(workerId, {
      ...existing,
      healthy,
      lastError: healthy ? null : existing.lastError,
    })
  }

  /**
   * Apply a partial update to a single worker.
   * No-op when the worker is unknown.
   */
  updateWorkerState(
    workerId: string,
    updates: Partial<RouterWorkerState>,
  ): void {
    const existing = this.#workers.get(workerId)
    if (existing === undefined) return
    this.#workers.set(workerId, { ...existing, ...updates })
  }

  /**
   * Return the total number of registered workers.
   */
  getWorkerCount(): number {
    return this.#workers.size
  }

  /**
   * Replace all registry contents with the given worker states.
   * Useful after a full re-discovery or re-sync from an external source.
   */
  reconcileAll(workers: RouterWorkerState[]): void {
    const next = new Map<string, RouterWorkerState>()
    for (const w of workers) {
      next.set(w.workerId, w)
    }
    this.#workers = next
  }
}
