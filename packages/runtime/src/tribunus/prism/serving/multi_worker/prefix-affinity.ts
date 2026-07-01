/**
 * Prism Multi-Worker Router — KV Locality Prefix Affinity
 *
 * Computes affinity scores between workers and request prefixes based on
 * the KV index. Workers with recent/prefetching/resident cache entries
 * for the requested prefix are preferred, reducing KV cache transfer cost.
 */

import type { PrefixAffinityResult, RouterKvIndexEntry, SelectionWeights } from "./router-types"
import { PrefixAffinityError } from "./router-errors"

const DEFAULT_TOKEN_BLOCK_SIZE = 256

/**
 * Compute prefix affinity for a single worker given the full KV index.
 * Returns the affinity result with scoring fields, or throws if the worker
 * has no entries in the index.
 */
export function computePrefixAffinity(
  workerId: string,
  prefixDigest: string,
  kvIndex: RouterKvIndexEntry[],
  weights: SelectionWeights,
): PrefixAffinityResult {
  const entries = kvIndex.filter(
    (e) => e.workerId === workerId && e.prefixDigest === prefixDigest,
  )
  if (entries.length === 0) {
    throw new PrefixAffinityError(
      `No KV index entries for worker ${workerId} with prefix ${prefixDigest}`,
    )
  }

  const totalTokens = entries.length * DEFAULT_TOKEN_BLOCK_SIZE
  const totalBlocks = entries.length

  // Longest consecutive run based on sorted sequence numbers
  const sorted = [...entries].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  let longestRun = 1
  let currentRun = 1
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].sequenceNumber === sorted[i - 1].sequenceNumber + 1) {
      currentRun++
      if (currentRun > longestRun) longestRun = currentRun
    } else if (sorted[i].sequenceNumber !== sorted[i - 1].sequenceNumber) {
      currentRun = 1
    }
  }

  // Residency weight: prefer entries in "touched" / "reused" / "stored" over "evicted"
  const stateWeights: Record<string, number> = {
    reused: 1.0,
    stored: 0.8,
    touched: 0.6,
    evicted: 0.1,
    invalidated: 0.0,
    released: 0.0,
  }
  const totalResidencyWeight = entries.reduce(
    (sum, e) => sum + (stateWeights[e.state] ?? 0.2),
    0,
  )
  const residencyWeight = entries.length > 0 ? totalResidencyWeight / entries.length : 0

  // Most recent timestamp
  const timestamps = entries.map((e) => e.timestamp).filter(Boolean)
  const eventFreshness = timestamps.length > 0
    ? timestamps.reduce((latest, ts) => (ts > latest ? ts : latest))
    : null

  // Composite affinity score (higher is better)
  const coverageFactor = Math.min(1, totalBlocks / 10) // up to 10 blocks = full coverage
  const consecutiveBonus = Math.min(1, longestRun / 5)  // up to 5 consecutive = full bonus
  const affinityScore =
    weights.cacheAffinityWeight * coverageFactor +
    weights.cacheAffinityWeight * 0.5 * consecutiveBonus +
    weights.cacheAffinityWeight * 0.3 * residencyWeight

  return {
    workerId,
    matchedPrefixTokens: totalTokens,
    matchedPrefixBlocks: totalBlocks,
    longestConsecutivePrefixBlocks: longestRun,
    residencyWeight,
    affinityScore,
    eventFreshness,
  }
}

/**
 * Find the best prefix affinity among eligible workers.
 * Returns null when no eligible worker has an affinity entry.
 */
export function getBestAffinity(
  prefixDigest: string,
  kvIndex: RouterKvIndexEntry[],
  eligibleWorkers: string[],
  weights: SelectionWeights,
): PrefixAffinityResult | null {
  const eligibleSet = new Set(eligibleWorkers)
  const candidateEntries = kvIndex.filter(
    (e) => e.prefixDigest === prefixDigest && eligibleSet.has(e.workerId),
  )
  if (candidateEntries.length === 0) return null

  // Group by worker, compute affinity for each
  const workerIds = [...new Set(candidateEntries.map((e) => e.workerId))]
  const results: PrefixAffinityResult[] = []
  for (const wid of workerIds) {
    try {
      const result = computePrefixAffinity(wid, prefixDigest, kvIndex, weights)
      results.push(result)
    } catch {
      // Worker had no entries after filtering — skip
    }
  }

  if (results.length === 0) return null
  return results.reduce((best, cur) => (cur.affinityScore > best.affinityScore ? cur : best))
}

/**
 * Compute a scalar affinity score from a result using the given weights.
 * This is a convenience wrapper; the result already carries affinityScore.
 */
export function computeAffinityScore(
  result: PrefixAffinityResult,
  weights: SelectionWeights,
): number {
  const coverageFactor = Math.min(1, result.matchedPrefixBlocks / 10)
  const consecutiveBonus = Math.min(1, result.longestConsecutivePrefixBlocks / 5)
  return (
    weights.cacheAffinityWeight * coverageFactor +
    weights.cacheAffinityWeight * 0.5 * consecutiveBonus +
    weights.cacheAffinityWeight * 0.3 * result.residencyWeight
  )
}
