/**
 * Prism llm-d Worker — Drain Behavior
 *
 * Pure functions for managing the drain lifecycle of a Prism worker.
 * Drain is a controlled shutdown process: new requests are rejected,
 * inflight requests complete, then the worker stops.
 */

/**
 * Begin the drain sequence.
 * Returns a snapshot of the drain state.
 */
export function beginDrain(): { newRequestsRejected: boolean; inflightCount: number } {
  return { newRequestsRejected: true, inflightCount: 0 }
}

/**
 * Check whether all inflight work has completed.
 * A fully drained state means all requests have finished.
 */
export function isDrained(inflightCount: number): boolean {
  return inflightCount <= 0
}

/**
 * Compute the ISO-8601 deadline for drain completion.
 * @param startedAt — ISO-8601 string when drain began
 * @param deadlineMs — maximum milliseconds allowed for drain
 */
export function getDrainDeadline(startedAt: string, deadlineMs: number): string {
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) {
    throw new RangeError(`Invalid startedAt timestamp: ${startedAt}`)
  }
  if (deadlineMs <= 0) {
    throw new RangeError(`deadlineMs must be positive, got ${deadlineMs}`)
  }
  return new Date(start + deadlineMs).toISOString()
}
