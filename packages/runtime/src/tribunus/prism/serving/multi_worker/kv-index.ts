/**
 * Prism Multi-Worker Router — KV Index
 *
 * Pure functions for building and querying a KV index that tracks
 * which worker has cached prefix state for prefix-affinity routing.
 */

import type { RouterKvIndexEntry } from "./router-types"

/**
 * Create a new KV index entry for a worker's prefix state.
 */
export function createKvIndexEntry(
  workerId: string,
  prefixDigest: string,
  state: string,
): RouterKvIndexEntry {
  return {
    workerId,
    prefixDigest,
    sequenceNumber: Date.now(),
    state,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Add an entry to the index, bounded by maxSize.
 * Drops the oldest entry when exceeding maxSize.
 * Returns a new array (immutable).
 */
export function addToIndex(
  index: RouterKvIndexEntry[],
  entry: RouterKvIndexEntry,
  maxSize: number,
): RouterKvIndexEntry[] {
  const next = [...index, entry]
  while (next.length > maxSize) {
    next.shift()
  }
  return next
}

/**
 * Get all index entries for a specific worker.
 */
export function getEntriesForWorker(
  index: RouterKvIndexEntry[],
  workerId: string,
): RouterKvIndexEntry[] {
  return index.filter((e) => e.workerId === workerId)
}

/**
 * Get the latest (most recent) index entry for a worker, or undefined if none.
 */
export function getLatestEntryForWorker(
  index: RouterKvIndexEntry[],
  workerId: string,
): RouterKvIndexEntry | undefined {
  const entries = getEntriesForWorker(index, workerId)
  if (entries.length === 0) return undefined

  return entries.reduce((latest, current) =>
    current.sequenceNumber > latest.sequenceNumber ? current : latest,
  )
}

/**
 * Invalidate (mark as evicted) all entries for a given worker.
 * Returns a new array — original is unmodified.
 */
export function invalidateWorkerEntries(
  index: RouterKvIndexEntry[],
  workerId: string,
): RouterKvIndexEntry[] {
  return index.map((e) =>
    e.workerId === workerId ? { ...e, state: "evicted" } : e,
  )
}
