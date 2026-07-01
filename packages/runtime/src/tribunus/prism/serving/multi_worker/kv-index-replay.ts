/**
 * Prism Multi-Worker Router — KV Index Replay
 *
 * Pure functions for replaying KV index events, detecting gaps,
 * and reporting replay status across multi-worker deployments.
 */

import type { RouterKvIndexEntry } from "./router-types"

/**
 * Return all index entries whose sequence number is strictly greater
 * than the given sequence (i.e., events that occurred after it).
 */
export function getEntriesSince(
  index: RouterKvIndexEntry[],
  sequence: number,
): RouterKvIndexEntry[] {
  return index.filter((e) => e.sequenceNumber > sequence)
}

/**
 * Detect gaps in the index for a set of expected sequence numbers.
 * Useful for verifying that a replay arrived in order.
 */
export function detectIndexGap(
  index: RouterKvIndexEntry[],
  expectedSequences: number[],
): { hasGap: boolean; missing: number[] } {
  const present = new Set(index.map((e) => e.sequenceNumber))
  const missing: number[] = []

  for (const seq of expectedSequences) {
    if (!present.has(seq)) {
      missing.push(seq)
    }
  }

  return { hasGap: missing.length > 0, missing }
}

/**
 * Get the overall replay status of the KV index:
 * total entries, latest sequence number, and oldest timestamp.
 */
export function getReplayStatus(
  index: RouterKvIndexEntry[],
): { total: number; latestSequence: number; oldestTimestamp: string | null } {
  if (index.length === 0) {
    return { total: 0, latestSequence: 0, oldestTimestamp: null }
  }

  // Sort by sequence number to find boundaries reliably
  const sorted = [...index].sort((a, b) => a.sequenceNumber - b.sequenceNumber)

  return {
    total: index.length,
    latestSequence: sorted[sorted.length - 1]!.sequenceNumber,
    oldestTimestamp: sorted[0]!.timestamp,
  }
}
