/**
 * Prism Multi-Worker Router — Candidate Filter
 *
 * Filters eligible workers by compatibility, health, capacity, and drain status.
 */

import type { RouterWorkerState, PrismWorkerCompatibilityEnvelope } from "./router-types"

export interface CandidateFilterConfig {
  requiredArtifactDigest: string
  requiredWorkloadClass: string
  requiredStreaming: boolean
  requiredTokens: number
  dharmaLeaseConstraints: Record<string, unknown> | null
}

/**
 * Filter a list of workers down to those eligible for the given request.
 */
export function filterEligibleWorkers(
  workers: RouterWorkerState[],
  config: CandidateFilterConfig,
  envelopes: Map<string, PrismWorkerCompatibilityEnvelope>,
): RouterWorkerState[] {
  return workers.filter((w) => {
    if (!checkWorkerHealth(w)) return false
    if (!checkWorkerCapacity(w)) return false
    if (!checkWorkerDrain(w)) return false
    // Must have a compatibility envelope
    const env = envelopes.get(w.workerId)
    if (!env) return false
    // Model artifact digest must match
    if (env.modelArtifactDigest !== config.requiredArtifactDigest) return false
    // Workload class must be supported
    if (!env.workloadClasses.includes(config.requiredWorkloadClass)) return false
    // Streaming requirement
    if (config.requiredStreaming && !env.supportsStreaming) return false
    // Token capacity: max output tokens must accommodate request
    if (config.requiredTokens > env.maximumOutputTokens) return false
    // Dharma lease correlation support when constraints are present
    if (config.dharmaLeaseConstraints !== null && !env.supportsDharmaCorrelation) return false
    return true
  })
}

/**
 * Check if a worker is healthy and ready.
 */
export function checkWorkerHealth(worker: RouterWorkerState): boolean {
  return worker.healthy && worker.ready
}

/**
 * Check if a worker has available capacity for new requests.
 */
export function checkWorkerCapacity(worker: RouterWorkerState): boolean {
  return worker.activeRequests < worker.maxConcurrentRequests
}

/**
 * Check that the worker is not draining.
 */
export function checkWorkerDrain(worker: RouterWorkerState): boolean {
  return !worker.draining
}
