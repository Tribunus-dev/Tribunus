/**
 * Dharma Replication — Federated Event Importer
 *
 * Reads ordered events from the Autobase view, validates through
 * the Phase A validation pipeline, and persists to PGlite.
 * Must be idempotent — duplicate imports are no-ops.
 */

import { createHash } from "node:crypto"
import { canonicalJson, deriveEventId, DHARMA_EVENT_SCHEMA_VERSION } from "../types"
import type { DharmaEventEnvelope, EventValidation } from "../types"
import { validateEvent } from "../event-validator"
import type { ImporterCursorType, ReplicatedDharmaEvent } from "./protocol"
import {
  DEPENDENCY_WAIT_BUDGET_MS,
  DEPENDENCY_RETRY_INTERVAL_MS,
  MAX_DEPENDENCY_DEPTH,
  MAX_UNRESOLVED_EVENTS,
} from "./protocol"
import { ImporterError } from "./errors"
import { b4a } from "./encoding"

// ── Types --------------------------------------------------------------------

export interface ImportCursor {
  federationId: string
  cursorType: ImporterCursorType
  autobaseLength: number
  lastEventId: string | null
  lastEventTimestamp: string | null
  importedCount: number
  updatedAt: string
}

export interface PendingDependency {
  dependencyId: string
  federationId: string
  eventId: string
  missingParentIds: string[]
  depth: number
  discoveredAt: string
  lastRetryAt: string | null
  retryCount: number
  status: "pending" | "resolved" | "timed_out" | "budget_exceeded"
}

// ── Importer -----------------------------------------------------------------

/**
 * FederationEventImporter reads ordered events from Autobase view,
 * validates through Phase A pipeline, and persists to PGlite.
 * Must be idempotent — duplicate imports are no-ops.
 */
export class FederationEventImporter {
  private importedIds: Set<string> = new Set()
  private importCursor: ImportCursor
  private pendingDependencies: Map<string, PendingDependency> = new Map()

  constructor(private federationId: string) {
    this.importCursor = {
      federationId,
      cursorType: "provisional",
      autobaseLength: 0,
      lastEventId: null,
      lastEventTimestamp: null,
      importedCount: 0,
      updatedAt: new Date().toISOString(),
    }
  }

  /**
   * Import a single event from the Autobase view.
   * Full pipeline: decode -> verify hash -> verify federation -> validate -> persist
   */
  async importEvent(
    eventId: string,
    envelopeBytes: Uint8Array,
  ): Promise<EventValidation> {
    // 1. Idempotency check
    if (this.isAlreadyImported(eventId)) {
      return {
        eventId,
        validationState: "accepted",
        validationReason: "already imported (duplicate)",
        validatedAt: new Date().toISOString(),
        policyDigest: null,
        validatorVersion: DHARMA_EVENT_SCHEMA_VERSION,
      }
    }

    // 2. Decode and verify
    const envelope = this.decodeAndVerify(eventId, envelopeBytes)

    // 3. Verify federation ID matches
    if (envelope.federationId !== this.federationId) {
      throw new ImporterError(
        `Event federationId mismatch: expected ${this.federationId}, got ${envelope.federationId}`,
      )
    }

    // 4. Handle dependencies
    const depsOk = await this.handleDependencies(envelope)
    if (!depsOk) {
      return {
        eventId,
        validationState: "pending_dependencies",
        validationReason: "Dependencies not yet available",
        validatedAt: new Date().toISOString(),
        policyDigest: null,
        validatorVersion: DHARMA_EVENT_SCHEMA_VERSION,
      }
    }

    // 5. Validate envelope
    const { validation, accepted } = this.validateEnvelope(envelope)

    if (!accepted) {
      return validation
    }

    // 6. Record imported
    this.importedIds.add(eventId)

    // 7. Advance cursor
    this.advanceCursor(eventId, "provisional")

    return validation
  }

  /**
   * Decode envelope bytes and verify hash integrity.
   */
  decodeAndVerify(eventId: string, envelopeBytes: Uint8Array): DharmaEventEnvelope {
    let envelope: DharmaEventEnvelope
    try {
      const text = new TextDecoder().decode(envelopeBytes)
      envelope = JSON.parse(text) as DharmaEventEnvelope
    } catch (err) {
      throw new ImporterError(`Failed to decode event envelope bytes`, err)
    }

    // Verify eventId matches derived ID
    const derivedId = deriveEventId(
      envelope.federationId,
      envelope.eventType,
      envelope.actorPublicKey,
      envelope.logicalClock,
      envelope.causalParents,
      envelope.createdAt,
      envelope.payloadHash,
    )

    if (derivedId !== eventId) {
      throw new ImporterError(
        `Event ID mismatch: expected ${eventId}, derived ${derivedId}`,
      )
    }

    if (derivedId !== envelope.eventId) {
      throw new ImporterError(
        `Event envelope eventId mismatch: envelope says ${envelope.eventId}, derived ${derivedId}`,
      )
    }

    // Verify payload hash
    const canonicalPayload = canonicalJson(envelope.payload)
    const computedHash = createHash("sha256").update(canonicalPayload).digest("hex")
    if (computedHash !== envelope.payloadHash) {
      throw new ImporterError(
        `Payload hash mismatch: expected ${envelope.payloadHash}, computed ${computedHash}`,
      )
    }

    return envelope
  }

  /**
   * Check if an event has already been imported (idempotency guard).
   */
  isAlreadyImported(eventId: string): boolean {
    return this.importedIds.has(eventId)
  }

  /**
   * Run Phase A validation pipeline on a decoded envelope.
   */
  validateEnvelope(envelope: DharmaEventEnvelope): {
    validation: EventValidation
    accepted: boolean
  } {
    const result = validateEvent(envelope)
    const validation: EventValidation = {
      eventId: envelope.eventId,
      validationState: result.state,
      validationReason: result.reason,
      validatedAt: new Date().toISOString(),
      policyDigest: null,
      validatorVersion: DHARMA_EVENT_SCHEMA_VERSION,
    }
    return { validation, accepted: result.state === "accepted" }
  }

  /**
   * Check dependencies and register pending if missing.
   */
  async handleDependencies(envelope: DharmaEventEnvelope): Promise<boolean> {
    const parents = envelope.causalParents
    if (!parents || parents.length === 0) {
      return true
    }

    const missing: string[] = []
    for (const parentId of parents) {
      if (!this.importedIds.has(parentId)) {
        missing.push(parentId)
      }
    }

    if (missing.length === 0) {
      return true
    }

    // Check if we've exceeded the max unresolved events limit
    if (this.pendingDependencies.size >= MAX_UNRESOLVED_EVENTS) {
      throw new ImporterError(
        `Max unresolved events (${MAX_UNRESOLVED_EVENTS}) reached for federation ${this.federationId}`,
      )
    }

    const now = new Date().toISOString()
    const dep: PendingDependency = {
      dependencyId: `${envelope.eventId}::pending`,
      federationId: this.federationId,
      eventId: envelope.eventId,
      missingParentIds: missing,
      depth: 1,
      discoveredAt: now,
      lastRetryAt: null,
      retryCount: 0,
      status: "pending",
    }
    this.pendingDependencies.set(dep.dependencyId, dep)
    return false
  }

  /**
   * Advance the import cursor after successful import.
   */
  advanceCursor(eventId: string, cursorType: ImporterCursorType): void {
    this.importCursor.cursorType = cursorType
    this.importCursor.lastEventId = eventId
    this.importCursor.lastEventTimestamp = new Date().toISOString()
    this.importCursor.autobaseLength += 1
    this.importCursor.importedCount += 1
    this.importCursor.updatedAt = new Date().toISOString()
  }

  /**
   * Retry pending dependencies that are due.
   */
  async retryDependencies(): Promise<string[]> {
    const resolved: string[] = []
    const now = Date.now()

    for (const [depId, dep] of this.pendingDependencies) {
      if (dep.status !== "pending") continue

      // Check budget
      const discoveredAt = new Date(dep.discoveredAt).getTime()
      if (now - discoveredAt > DEPENDENCY_WAIT_BUDGET_MS) {
        dep.status = "budget_exceeded"
        continue
      }

      // Check depth
      if (dep.depth > MAX_DEPENDENCY_DEPTH) {
        dep.status = "timed_out"
        continue
      }

      // Re-check missing parents
      const stillMissing: string[] = []
      for (const parentId of dep.missingParentIds) {
        if (!this.importedIds.has(parentId)) {
          stillMissing.push(parentId)
        }
      }

      dep.lastRetryAt = new Date().toISOString()
      dep.retryCount += 1

      if (stillMissing.length === 0) {
        dep.status = "resolved"
        resolved.push(dep.eventId)
        // Clean up the pending dependency
        this.pendingDependencies.delete(depId)
      } else {
        dep.missingParentIds = stillMissing
      }
    }

    return resolved
  }

  /**
   * Get current cursor position.
   */
  getCursor(cursorType: ImporterCursorType): ImportCursor {
    return { ...this.importCursor, cursorType }
  }

  /**
   * Get pending dependency count.
   */
  getPendingDependencyCount(): number {
    let count = 0
    for (const dep of this.pendingDependencies.values()) {
      if (dep.status === "pending") count++
    }
    return count
  }

  /**
   * Set cursor from persisted state (restore on startup).
   */
  restoreCursor(cursor: ImportCursor): void {
    this.importCursor = { ...cursor }
  }

  /**
   * Set imported IDs from persisted state.
   */
  restoreImportedIds(eventIds: string[]): void {
    this.importedIds = new Set(eventIds)
  }
}
