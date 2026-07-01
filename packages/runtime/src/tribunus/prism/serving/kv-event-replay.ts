/**
 * Prism llm-d Worker — KV Event Replay Buffer
 *
 * Pure functions for managing an ordered, bounded replay buffer
 * of KV event batches with gap detection.
 */

import type { PrismKvEventBatch } from "./worker-types"

/**
 * Add a batch to the replay buffer, assigning the next sequence number.
 * Drops the oldest batch when buffer exceeds maxSize.
 * Returns a new array (immutable).
 */
export function addToReplayBuffer(
  buffer: PrismKvEventBatch[],
  batch: PrismKvEventBatch,
  maxSize: number,
): PrismKvEventBatch[] {
  const nextSeq = buffer.length > 0 ? buffer[buffer.length - 1]!.sequenceNumber + 1 : 1
  const stamped: PrismKvEventBatch = {
    ...batch,
    sequenceNumber: nextSeq,
  }
  const next = [...buffer, stamped]
  while (next.length > maxSize) {
    next.shift()
  }
  return next
}

/**
 * Return all batches whose sequence number is strictly greater than `sequence`.
 */
export function getEventsAfter(buffer: PrismKvEventBatch[], sequence: number): PrismKvEventBatch[] {
  return buffer.filter((b) => b.sequenceNumber > sequence)
}

/**
 * Return the latest sequence number in the buffer, or 0 if empty.
 */
export function getLatestSequence(buffer: PrismKvEventBatch[]): number {
  if (buffer.length === 0) return 0
  return buffer[buffer.length - 1]!.sequenceNumber
}

/**
 * Detect gaps relative to an expected sequence number.
 * Returns whether a gap exists and the list of missing sequence values.
 */
export function detectGap(
  buffer: PrismKvEventBatch[],
  expectedSequence: number,
): { hasGap: boolean; missingSequences: number[] } {
  if (buffer.length === 0) {
    return { hasGap: true, missingSequences: [expectedSequence] }
  }

  const sorted = [...buffer].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const firstSeq = sorted[0]!.sequenceNumber
  const lastSeq = sorted[sorted.length - 1]!.sequenceNumber

  // If expected is before our earliest, that's a gap
  if (expectedSequence < firstSeq) {
    const missing: number[] = []
    for (let s = expectedSequence; s < firstSeq; s++) {
      missing.push(s)
    }
    return { hasGap: true, missingSequences: missing }
  }

  // If expected is after our latest, that's a gap
  if (expectedSequence > lastSeq) {
    return { hasGap: true, missingSequences: [expectedSequence] }
  }

  // Build set of present sequences
  const present = new Set(sorted.map((b) => b.sequenceNumber))

  // Check within range
  const missing: number[] = []
  for (let s = expectedSequence; s <= lastSeq; s++) {
    if (!present.has(s)) {
      missing.push(s)
    }
  }

  return { hasGap: missing.length > 0, missingSequences: missing }
}
