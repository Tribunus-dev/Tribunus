/**
 * Dharma Multi-Peer Result Convergence — Artifact Access & Delivery
 *
 * Pure functions for requesting artifact access and issuing access decisions.
 */

import type { ArtifactAccessRequest, ArtifactAccessDecision } from "./multi-peer-types";
import { randomUUID } from "node:crypto";
import { ArtifactAccessError } from "./multi-peer-errors";

// ── Access Request ──────────────────────────────────────────────────────────

/**
 * Create a new artifact access request.
 *
 * @param config - Request configuration
 * @param config.sessionId - The session this request belongs to
 * @param config.artifactDigest - Digest identifying the requested artifact
 * @param config.requesterMembershipId - Membership ID of the requester
 * @param config.purpose - Optional human-readable purpose
 * @returns A fully populated ArtifactAccessRequest
 */
export function createAccessRequest(config: {
  sessionId: string;
  artifactDigest: string;
  requesterMembershipId: string;
  purpose?: string;
}): ArtifactAccessRequest {
  return {
    requestId: randomUUID(),
    sessionId: config.sessionId,
    artifactDigest: config.artifactDigest,
    requesterMembershipId: config.requesterMembershipId,
    requestedPurpose: config.purpose ?? "",
    requestedAt: new Date().toISOString(),
    signature: "",
  };
}

// ── Access Decision ─────────────────────────────────────────────────────────

/**
 * Create an access decision (grant or deny) in response to a request.
 *
 * @param config - Decision configuration
 * @param config.requestId - The ID of the request being decided
 * @param config.sessionId - The session the request belongs to
 * @param config.decision - "granted" or "denied"
 * @param config.decidedBy - Identity public key of the decider
 * @param config.deliveryRef - Optional delivery reference for granted requests
 * @param config.expiresAt - Optional ISO expiry timestamp for the grant
 * @returns A fully populated ArtifactAccessDecision
 * @throws {ArtifactAccessError} If the decision value is invalid
 */
export function createAccessDecision(config: {
  requestId: string;
  sessionId: string;
  decision: "granted" | "denied";
  decidedBy: string;
  deliveryRef?: string;
  expiresAt?: string;
}): ArtifactAccessDecision {
  if (config.decision !== "granted" && config.decision !== "denied") {
    throw new ArtifactAccessError(
      `Invalid decision "${config.decision}". Must be "granted" or "denied".`,
    );
  }

  return {
    requestId: config.requestId,
    decision: config.decision,
    allowedScope: config.decision === "granted" ? "read" : "",
    expiresAt: config.expiresAt ?? null,
    artifactDeliveryReference: config.decision === "granted" ? (config.deliveryRef ?? null) : null,
    decidedByIdentityPublicKey: config.decidedBy,
    signature: "",
  };
}

// ── Decision Inspection ─────────────────────────────────────────────────────

/**
 * Check whether an access decision is a grant.
 *
 * @param decision - The access decision
 * @returns `true` if the decision is "granted"
 */
export function isAccessGranted(decision: ArtifactAccessDecision): boolean {
  return decision.decision === "granted";
}

/**
 * Check whether an access decision has expired.
 *
 * A decision with null `expiresAt` never expires.
 *
 * @param decision - The access decision
 * @returns `true` if the decision has expired
 */
export function isAccessExpired(decision: ArtifactAccessDecision): boolean {
  if (decision.expiresAt === null) {
    return false;
  }
  return new Date(decision.expiresAt).getTime() <= Date.now();
}
