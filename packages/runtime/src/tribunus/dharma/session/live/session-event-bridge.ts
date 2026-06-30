/**
 * Dharma Live Sandbox — Durable Event Bridge to Phase 2
 *
 * Connects live sandbox lifecycle events to the Dharma event system.
 * Each local record (session state change, grant issuance, etc.) creates
 * a SessionEventLink that tracks replication state through pending →
 * published → confirmed, enabling durable delivery guarantees.
 */

import { randomUUID } from "node:crypto"
import type { SessionEventLink } from "./live-types"

// ── Lifecycle Events to Bridge ----------------------------------------------

/**
 * Session lifecycle events that should be bridged to the Dharma event system.
 * These events represent the full lifecycle of a live sandbox session.
 */
export const SESSION_LIFECYCLE_EVENTS: string[] = [
  "session.created",
  "session.materialized",
  "session.activated",
  "session.member_invited",
  "session.member_joined",
  "session.grant_issued",
  "session.grant_revoked",
  "session.key_epoch_rotated",
  "session.command_requested",
  "session.command_completed",
  "session.command_rejected",
  "session.command_failed",
  "session.workspace_mutation_proposed",
  "session.workspace_mutation_accepted",
  "session.workspace_mutation_rejected",
  "session.sealed",
  "session.aggregate_emitted",
]

/**
 * Subset of lifecycle events that are mandatory for session integrity.
 * These must be reliably delivered and acknowledged before proceeding.
 */
export const SESSION_REQUIRED_EVENTS: string[] = [
  "session.created",
  "session.activated",
  "session.sealed",
  "session.aggregate_emitted",
]

// ── Event Link Creation -----------------------------------------------------

/**
 * Create an event link record.
 *
 * An event link ties a local record (e.g., a grant issuance, a state transition)
 * to a pending event that should be published to the Dharma event system.
 * The link tracks the event through its replication lifecycle.
 */
export function createEventLink(
  sessionId: string,
  localRecordType: string,
  localRecordId: string,
): SessionEventLink {
  return {
    linkId: randomUUID(),
    sessionId,
    localRecordType,
    localRecordId,
    dharmaEventId: null,
    replicationState: "pending",
    outboxEntryId: null,
    publishedAt: null,
    confirmedAt: null,
  }
}

// ── State Transitions -------------------------------------------------------

/**
 * Mark event link as published.
 *
 * Transitions the link from "pending" to "published" state, recording
 * the Dharma event ID and timestamp. Throws if the link is in an invalid
 * state for this transition.
 */
export function markEventPublished(
  link: SessionEventLink,
  dharmaEventId: string,
): SessionEventLink {
  if (link.replicationState !== "pending") {
    throw new Error(
      `Cannot publish event link in state "${link.replicationState}": expected "pending"`,
    )
  }

  return {
    ...link,
    dharmaEventId,
    replicationState: "published",
    publishedAt: new Date().toISOString(),
  }
}

/**
 * Mark event link as confirmed.
 *
 * Transitions the link from "published" to "confirmed" state, indicating
 * the target event system has acknowledged receipt. Throws if the link
 * is in an invalid state for this transition.
 */
export function markEventConfirmed(link: SessionEventLink): SessionEventLink {
  if (link.replicationState !== "published") {
    throw new Error(
      `Cannot confirm event link in state "${link.replicationState}": expected "published"`,
    )
  }

  return {
    ...link,
    replicationState: "confirmed",
    confirmedAt: new Date().toISOString(),
  }
}
