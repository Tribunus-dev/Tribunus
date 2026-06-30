/**
 * Dharma Federation Runtime — Event Validator
 *
 * Validation pipeline for incoming events.
 * Checks schema version, event type, signature, and causal parent rules.
 */

import type { DharmaEventEnvelope, EventValidation, EventValidationState } from "./types"
import { EVENT_TYPES, GOVERNANCE_EVENT_TYPES, DHARMA_EVENT_SCHEMA_VERSION } from "./types"
import { verifyEventSignature } from "./event-codec"

// ── Types --------------------------------------------------------------------

export interface ValidationResult {
  state: EventValidationState
  reason: string | null
}

// ── Pipeline -----------------------------------------------------------------

/** Run the full validation pipeline. Returns the final validation state. */
export function validateEvent(event: DharmaEventEnvelope): ValidationResult {
  // 1. Schema version
  const versionResult = validateSchemaVersion(event.schemaVersion)
  if (versionResult.state !== "accepted") {
    return versionResult
  }

  // 2. Event type
  const typeResult = validateEventType(event.eventType)
  if (typeResult.state !== "accepted") {
    return typeResult
  }

  // 3. Signature
  const sigResult = validateSignature(event)
  if (sigResult.state !== "accepted") {
    return sigResult
  }

  // 4. Causal parents (governance events)
  const parentResult = validateCausalParents(event)
  if (parentResult.state !== "accepted") {
    return parentResult
  }

  return { state: "accepted", reason: null }
}

// ── Individual Checks --------------------------------------------------------

/** Check that event type is in the known set */
export function validateEventType(eventType: string): ValidationResult {
  if ((EVENT_TYPES as readonly string[]).includes(eventType)) {
    return { state: "accepted", reason: null }
  }
  return { state: "rejected", reason: `Unknown event type: ${eventType}` }
}

/** Check that schema version is compatible */
export function validateSchemaVersion(version: number): ValidationResult {
  if (version === DHARMA_EVENT_SCHEMA_VERSION) {
    return { state: "accepted", reason: null }
  }
  return { state: "rejected", reason: `Unsupported schema version: ${version}, expected: ${DHARMA_EVENT_SCHEMA_VERSION}` }
}

/** Check that signature is valid */
export function validateSignature(event: DharmaEventEnvelope): ValidationResult {
  if (verifyEventSignature(event)) {
    return { state: "accepted", reason: null }
  }
  return { state: "rejected", reason: "Event signature verification failed" }
}

/** Check that causal parents are present for governance events */
export function validateCausalParents(event: DharmaEventEnvelope): ValidationResult {
  const isGovernance = (GOVERNANCE_EVENT_TYPES as readonly string[]).includes(event.eventType)
  if (isGovernance && event.causalParents.length === 0) {
    return { state: "quarantined", reason: `Governance event ${event.eventType} requires at least one causal parent` }
  }
  return { state: "accepted", reason: null }
}

// ── Records ------------------------------------------------------------------

/** Create an EventValidation record from result */
export function createValidationRecord(
  eventId: string,
  result: ValidationResult,
  policyDigest?: string,
): EventValidation {
  return {
    eventId,
    validationState: result.state,
    validationReason: result.reason,
    validatedAt: new Date().toISOString(),
    policyDigest: policyDigest ?? null,
    validatorVersion: DHARMA_EVENT_SCHEMA_VERSION,
  }
}
