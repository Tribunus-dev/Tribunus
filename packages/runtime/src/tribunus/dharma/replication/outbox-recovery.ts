/**
 * Dharma Replication — Outbox Crash Recovery
 *
 * Provides crash-recovery functions for the durable event outbox.
 * On runtime restart, pending and retry_wait entries are replayed
 * to re-attempt appending to the local writer core.
 */

import type { OutboxManager } from "./outbox"

// ── Types --------------------------------------------------------------------

export interface OutboxRecoveryResult {
  /** Whether any entries were recovered (pending + retried > 0). */
  recovered: boolean
  /** Number of entries found in pending (ready) state. */
  pendingEntries: number
  /** Number of retry_wait entries reset to ready for re-processing. */
  retriedEntries: number
  /** Number of entries that could not be retried (invalid state). */
  failedEntries: number
  /** ISO-8601 timestamp when recovery ran. */
  recoveredAt: string
}

export interface OutboxStateCounts {
  /** Entries in ready state, ready for appending. */
  pending: number
  /** Entries in retry_wait state, awaiting retry. */
  retrying: number
  /** Entries in a terminal positive state (appended through complete). */
  confirmed: number
  /** Entries in failed_terminal state. */
  failed: number
}

// ── Recovery -----------------------------------------------------------------

/**
 * Recover the outbox after a crash or restart.
 *
 * 1. Finds all unconfirmed entries (ready or retry_wait).
 * 2. Resets retry_wait entries back to ready via outbox.retry().
 * 3. Returns a summary of the recovery operation.
 *
 * After this function completes, the runtime's normal append loop
 * will process the recovered entries through the standard ready → appending
 * → appended pipeline.
 *
 * @param outbox - The outbox manager to recover.
 * @returns A summary of the recovery operation.
 */
export function recoverOutbox(outbox: OutboxManager): OutboxRecoveryResult {
  const recoveredAt = new Date().toISOString()
  let retriedEntries = 0
  let failedEntries = 0

  const pending = outbox.getPendingEntries()
  for (const entry of pending) {
    if (entry.state === "retry_wait") {
      try {
        outbox.retry(entry.outboxId)
        retriedEntries++
      } catch {
        failedEntries++
      }
    }
  }

  // Re-query after retries to get accurate pending count
  const pendingEntries = pending.length
  const recovered = pendingEntries > 0
  return { recovered, pendingEntries, retriedEntries, failedEntries, recoveredAt }
}

// ── State Query --------------------------------------------------------------

/**
 * Get a snapshot of outbox state counts across all state categories.
 *
 * @param outbox - The outbox manager to query.
 * @returns Counts grouped by state category.
 */
export function getOutboxState(outbox: OutboxManager): OutboxStateCounts {
  const all = outbox.getAllEntries()

  let pending = 0
  let retrying = 0
  let confirmed = 0
  let failed = 0

  for (const entry of all) {
    switch (entry.state) {
      case "ready":
        pending++
        break
      case "retry_wait":
        retrying++
        break
      case "failed_terminal":
        failed++
        break
      case "appended":
      case "observed_in_view":
      case "imported":
      case "complete":
        confirmed++
        break
      // "created" and "appending" are transitional; not counted in categories
    }
  }

  return { pending, retrying, confirmed, failed }
}
