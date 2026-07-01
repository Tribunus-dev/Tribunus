/**
 * Dharma Replication — Durable Event Outbox Manager
 *
 * Manages the local event outbox for Phase 2 replication.
 * All locally-authored Dharma events enter the outbox before being
 * appended to the local writer core, providing crash recovery and
 * retry semantics.
 */

import { randomUUID } from "node:crypto"
import type { OutboxEntryState } from "./protocol"
import { OutboxError } from "./errors"
import type { DharmaEventEnvelope } from "../types"
import { canonicalJson } from "../types"

// ── Types --------------------------------------------------------------------

export interface OutboxEntry {
  outboxId: string
  federationId: string
  eventId: string
  eventEnvelope: Record<string, unknown>
  state: OutboxEntryState
  attemptCount: number
  nextAttemptAt: string | null
  writerCoreKey: string | null
  appendedSequence: number | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

// ── State Machine ------------------------------------------------------------

/** Valid outbox state transitions */
export const VALID_OUTBOX_TRANSITIONS: Record<OutboxEntryState, readonly OutboxEntryState[]> = {
  created: ["ready"],
  ready: ["appending", "retry_wait"],
  appending: ["appended", "retry_wait"],
  appended: ["observed_in_view"],
  observed_in_view: ["imported"],
  imported: ["complete"],
  complete: [],
  retry_wait: ["ready", "failed_terminal"],
  failed_terminal: [],
}

export function isValidOutboxTransition(
  current: OutboxEntryState,
  next: OutboxEntryState,
): boolean {
  const allowed = VALID_OUTBOX_TRANSITIONS[current]
  if (!allowed) return false
  return allowed.includes(next)
}

// ── Manager ------------------------------------------------------------------

/**
 * OutboxManager manages the durable event outbox.
 * All local Dharma events enter the outbox before being appended
 * to the local writer core.
 */
export class OutboxManager {
  private entries: Map<string, OutboxEntry> = new Map()

  constructor(private federationId: string) {}

  /** Create a new outbox entry (step 3 in spec: after PGlite tx) */
  createEntry(event: DharmaEventEnvelope): OutboxEntry {
    const now = new Date().toISOString()
    const entry: OutboxEntry = {
      outboxId: randomUUID(),
      federationId: this.federationId,
      eventId: event.eventId,
      eventEnvelope: JSON.parse(canonicalJson(event)) as Record<string, unknown>,
      state: "created",
      attemptCount: 0,
      nextAttemptAt: null,
      writerCoreKey: null,
      appendedSequence: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }
    this.entries.set(entry.outboxId, entry)
    return entry
  }

  /** Mark entry as ready for appending */
  markReady(outboxId: string): void {
    this.transition(outboxId, "ready")
  }

  /** Mark entry as currently being appended to writer core */
  markAppending(outboxId: string): void {
    this.transition(outboxId, "appending")
  }

  /** Mark entry as appended (record sequence) */
  markAppended(outboxId: string, sequence: number, writerCoreKey: string): void {
    const entry = this.getOrThrow(outboxId)
    this.transition(outboxId, "appended")
    entry.appendedSequence = sequence
    entry.writerCoreKey = writerCoreKey
    entry.updatedAt = new Date().toISOString()
  }

  /** Mark entry as observed in Autobase view */
  markObserved(outboxId: string): void {
    this.transition(outboxId, "observed_in_view")
  }

  /** Mark entry as imported and complete */
  markComplete(outboxId: string): void {
    this.transition(outboxId, "imported")
    this.transition(outboxId, "complete")
  }

  /** Schedule entry for retry */
  scheduleRetry(outboxId: string, error: string, delayMs: number = 5_000): void {
    const entry = this.getOrThrow(outboxId)
    const currentState = entry.state
    // Allow both ready and appending to go to retry_wait
    if (!isValidOutboxTransition(currentState, "retry_wait")) {
      throw new OutboxError(
        `Cannot schedule retry from state ${currentState}; allowed from ready, appending`,
      )
    }
    entry.state = "retry_wait"
    entry.attemptCount += 1
    entry.lastError = error
    entry.nextAttemptAt = new Date(Date.now() + delayMs).toISOString()
    entry.updatedAt = new Date().toISOString()
  }

  /** Mark entry as terminally failed */
  markFailed(outboxId: string, error: string): void {
    const entry = this.getOrThrow(outboxId)
    if (!isValidOutboxTransition(entry.state, "failed_terminal")) {
      throw new OutboxError(
        `Cannot mark failed from state ${entry.state}; allowed from retry_wait`,
      )
    }
    entry.state = "failed_terminal"
    entry.lastError = error
    entry.updatedAt = new Date().toISOString()
  }

  /** Get pending entries ready for appending (sorted by createdAt) */
  getPendingEntries(): OutboxEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => e.state === "ready" || e.state === "retry_wait")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** Get entries in retry_wait that are due for retry */
  getDueRetries(): OutboxEntry[] {
    const now = new Date().toISOString()
    return Array.from(this.entries.values())
      .filter((e) => e.state === "retry_wait" && e.nextAttemptAt !== null && e.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** Reset a pending or retry_wait entry back to ready for re-processing.
   *  For retry_wait entries, they transition back to ready (clearing retry metadata).
   *  For ready entries, this is a no-op.
   *  Used during crash recovery to replay unconfirmed entries. */
  retry(outboxId: string): void {
    const entry = this.getOrThrow(outboxId)
    if (entry.state === "ready") return // already pending, nothing to do
    if (!isValidOutboxTransition(entry.state, "ready")) {
      throw new OutboxError(
        `Cannot retry entry ${outboxId} from state ${entry.state}; expected retry_wait or ready`,
      )
  }
    entry.state = "ready"
    entry.attemptCount = 0
    entry.lastError = null
    entry.nextAttemptAt = null
    entry.updatedAt = new Date().toISOString()
  }

  /** Get entry by ID */
  getEntry(outboxId: string): OutboxEntry | undefined {
    return this.entries.get(outboxId)
  }

  /** Get all entries */
  getAllEntries(): OutboxEntry[] {
    return Array.from(this.entries.values())
  }

  /** Get pending count */
  getPendingCount(): number {
    return this.getPendingEntries().length
  }

  /** Restore from stored entries (called on startup) */
  restore(entries: OutboxEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.outboxId, { ...entry })
    }
  }

  // ── Private Helpers --------------------------------------------------------

  private getOrThrow(outboxId: string): OutboxEntry {
    const entry = this.entries.get(outboxId)
    if (!entry) {
      throw new OutboxError(`Outbox entry not found: ${outboxId}`)
    }
    return entry
  }

  private transition(outboxId: string, nextState: OutboxEntryState): void {
    const entry = this.getOrThrow(outboxId)
    const currentState = entry.state
    if (!isValidOutboxTransition(currentState, nextState)) {
      throw new OutboxError(
        `Invalid outbox transition: ${currentState} → ${nextState}`,
      )
    }
    entry.state = nextState
    entry.updatedAt = new Date().toISOString()
  }
}
