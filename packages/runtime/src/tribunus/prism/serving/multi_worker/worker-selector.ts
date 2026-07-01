/**
 * Prism Multi-Worker Router — Deterministic Worker Selection
 *
 * Combines eligibility filtering, prefix affinity, and load scoring to
 * select the optimal worker for a request.
 */

import type {
  RouterWorkerState,
  PrefixAffinityResult,
  RouterKvIndexEntry,
  PrismWorkerCompatibilityEnvelope,
  SelectionWeights,
} from "./router-types"
import { DEFAULT_SELECTION_WEIGHTS } from "./router-types"
import { NoEligibleWorkerError } from "./router-errors"
import { scoreLoad, scoreHealth, scoreErrors, scoreDrain } from "./load-scorer"
import { getBestAffinity, computeAffinityScore } from "./prefix-affinity"
import { filterEligibleWorkers, type CandidateFilterConfig } from "./candidate-filter"

export interface SelectionInput {
  eligibleWorkers: RouterWorkerState[]
  prefixDigest: string | null
  kvIndex: RouterKvIndexEntry[]
  envelopes: Map<string, PrismWorkerCompatibilityEnvelope>
  weights?: SelectionWeights
  dharmaLeaseId?: string
}

export interface SelectionOutput {
  workerId: string
  reason: string
  affinity: PrefixAffinityResult | null
  loadScore: number
}

/**
 * Select the best worker from the eligible set given affinity and load scores.
 * Returns the worker with the highest composite score.
 *
 * Composite score = baseEligibility + affinity bonus - load penalty.
 * Higher is better.
 */
export function selectWorker(input: SelectionInput): SelectionOutput {
  const weights = input.weights ?? DEFAULT_SELECTION_WEIGHTS
  const { eligibleWorkers, prefixDigest, kvIndex, envelopes } = input

  if (eligibleWorkers.length === 0) {
    throw new NoEligibleWorkerError()
  }

  // Check that at least one worker has a compatibility envelope
  const hasAnyEnvelope = eligibleWorkers.some((w) => envelopes.has(w.workerId))
  if (!hasAnyEnvelope) {
    throw new NoEligibleWorkerError()
  }

  // Resolve prefix affinity if a digest is provided
  let bestAffinity: PrefixAffinityResult | null = null
  if (prefixDigest !== null) {
    const eligibleIds = eligibleWorkers.map((w) => w.workerId)
    bestAffinity = getBestAffinity(prefixDigest, kvIndex, eligibleIds, weights)
  }

  // Score each eligible worker
  let bestScore = -Infinity
  let bestWorker: RouterWorkerState | null = null
  let bestAffinityResult: PrefixAffinityResult | null = null
  let bestLoadScore = 0

  for (const worker of eligibleWorkers) {
    const load = scoreLoad(worker)
    const health = scoreHealth(worker)
    const err = scoreErrors(worker)
    const drain = scoreDrain(worker)

    // Base score from load, health, errors, drain (lower weighted scores = better)
    const baseScore =
      -(weights.loadWeight * load) -
      weights.healthWeight * health -
      weights.errorWeight * err -
      weights.drainWeight * drain

    // Affinity bonus if this worker is the best affine candidate
    let affinityBonus = 0
    let workerAffinity: PrefixAffinityResult | null = null
    if (bestAffinity !== null && bestAffinity.workerId === worker.workerId) {
      workerAffinity = bestAffinity
      affinityBonus = bestAffinity.affinityScore
    }

    const composite = baseScore + affinityBonus
    if (composite > bestScore) {
      bestScore = composite
      bestWorker = worker
      bestAffinityResult = workerAffinity
      bestLoadScore = load
    }
  }

  if (bestWorker === null) {
    throw new NoEligibleWorkerError()
  }

  const reason = bestAffinityResult !== null
    ? `affinity_${bestAffinityResult.workerId}`
    : "lowest_load"

  return {
    workerId: bestWorker.workerId,
    reason,
    affinity: bestAffinityResult,
    loadScore: bestLoadScore,
  }
}

/**
 * Score a single worker given its affinity result and weights.
 * Returns a composite score where higher is better.
 */
export function scoreWorker(
  worker: RouterWorkerState,
  affinity: PrefixAffinityResult | null,
  weights: SelectionWeights,
): number {
  const load = scoreLoad(worker)
  const health = scoreHealth(worker)
  const err = scoreErrors(worker)
  const drain = scoreDrain(worker)

  const baseScore =
    -(weights.loadWeight * load) -
    weights.healthWeight * health -
    weights.errorWeight * err -
    weights.drainWeight * drain

  let affinityBonus = 0
  if (affinity !== null) {
    affinityBonus = computeAffinityScore(affinity, weights)
  }

  return baseScore + affinityBonus
}
