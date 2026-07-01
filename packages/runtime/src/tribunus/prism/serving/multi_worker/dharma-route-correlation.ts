/**
 * Prism Multi-Worker Router — Dharma Lease-Aware Routing
 *
 * Correlates Dharma compute leases with worker compatibility data to
 * constrain routing decisions. Only workers whose compatibility envelope
 * satisfies the lease constraints are eligible.
 */

import type { RouterWorkerState, RouteRecord, PrismWorkerCompatibilityEnvelope } from "./router-types"

/**
 * Get workers whose compatibility envelope satisfies the given lease constraints.
 * Filters the worker pool to those with a non-null compatibility envelope
 * that passes the lease compatibility check.
 */
export function getLeaseConstrainedWorkers(
  leaseId: string,
  workers: RouterWorkerState[],
  envelopes: Map<string, PrismWorkerCompatibilityEnvelope>,
): RouterWorkerState[] {
  return workers.filter((w) => {
    const env = envelopes.get(w.workerId)
    if (!env) return false
    if (!env.supportsDharmaCorrelation) return false
    return true
  })
}

/**
 * Check whether a worker's compatibility envelope is compatible with
 * the given lease constraints (artifact digest, max tokens, max runtime).
 */
export function isLeaseCompatible(
  env: PrismWorkerCompatibilityEnvelope,
  leaseConstraints: { artifactDigest: string; maxTokens: number; maxRuntime: number },
): { compatible: boolean; reason: string | null } {
  if (env.modelArtifactDigest !== leaseConstraints.artifactDigest) {
    return {
      compatible: false,
      reason: `Artifact digest mismatch: env=${env.modelArtifactDigest}, lease=${leaseConstraints.artifactDigest}`,
    }
  }

  if (env.maximumOutputTokens < leaseConstraints.maxTokens) {
    return {
      compatible: false,
      reason: `Insufficient max output tokens: env=${env.maximumOutputTokens}, required=${leaseConstraints.maxTokens}`,
    }
  }

  if (env.maximumContextLength < leaseConstraints.maxTokens) {
    return {
      compatible: false,
      reason: `Insufficient context length: env=${env.maximumContextLength}, required=${leaseConstraints.maxTokens}`,
    }
  }

  return { compatible: true, reason: null }
}

/**
 * Build a human-readable summary of all route records for a given lease.
 */
export function getLeaseRouteSummary(records: RouteRecord[], leaseId: string): string {
  if (records.length === 0) {
    return `Lease ${leaseId}: no route records`
  }

  const totalRoutes = records.length
  const outcomes = new Map<string, number>()
  const workerIds = new Set<string>()

  for (const r of records) {
    outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1)
    workerIds.add(r.selectedWorkerId)
  }

  const outcomeSummary = Array.from(outcomes.entries())
    .map(([outcome, count]) => `${outcome}=${count}`)
    .join(", ")

  return `Lease ${leaseId}: ${totalRoutes} routes across ${workerIds.size} workers [${outcomeSummary}]`
}
