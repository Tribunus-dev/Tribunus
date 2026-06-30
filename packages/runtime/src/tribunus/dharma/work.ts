/**
 * Dharma Federation Runtime — Work Offer & Claim State Machines
 *
 * Pure functions for creating work offers/claims and validating
 * their lifecycle transitions per the Dharma v1 specification.
 */

import type {
  WorkOffer,
  WorkOfferStatus,
  WorkClaim,
  WorkClaimStatus,
  EffortBand,
  CapabilityClass,
  WorkOfferVisibility,
  FederationRole,
} from "./types";
import { randomUUID } from "node:crypto"
import { sha256Hex } from "./types";

// ── Work Offer Status Transitions ────────────────────────────────────────────

/**
 * Valid status transitions for a work offer.
 * From spec (forward): draft → published → claimed → in_progress →
 *   completion_attested → receipt_issued → settled
 * Also: published → cancelled; claimed → released; claimed → expired
 */
export const VALID_WORK_OFFER_TRANSITIONS: Record<WorkOfferStatus, readonly WorkOfferStatus[]> = {
  draft: ["published"],
  published: ["claimed", "cancelled"],
  claimed: ["in_progress", "released", "expired"],
  in_progress: ["completion_attested"],
  completion_attested: ["receipt_issued"],
  receipt_issued: ["settled"],
  settled: [],
  cancelled: [],
  expired: [],
  released: [],
};

/** Check if a work offer status transition is valid */
export function isValidWorkOfferTransition(current: WorkOfferStatus, next: WorkOfferStatus): boolean {
  return VALID_WORK_OFFER_TRANSITIONS[current].includes(next);
}

// ── Work Claim Status Transitions ───────────────────────────────────────────

/**
 * Valid status transitions for a work claim.
 * From spec: active → released | expired | completed
 */
export const VALID_WORK_CLAIM_TRANSITIONS: Record<WorkClaimStatus, readonly WorkClaimStatus[]> = {
  active: ["released", "expired", "completed"],
  released: [],
  expired: [],
  completed: [],
};

/** Check if a work claim status transition is valid */
export function isValidWorkClaimTransition(current: WorkClaimStatus, next: WorkClaimStatus): boolean {
  return VALID_WORK_CLAIM_TRANSITIONS[current].includes(next);
}

// ── Work Offer Creation ─────────────────────────────────────────────────────

/** Create a new work offer */
export function createWorkOffer(config: {
  federationId: string;
  creatorIdentity: string;
  title: string;
  summary: string;
  category: string;
  requestedOutcome: string;
  artifactScope: string;
  maxEffortBand: EffortBand;
  dharmaOfferAmount: number;
  visibility?: WorkOfferVisibility;
  requiredRoles?: FederationRole[];
  capabilityClass?: CapabilityClass;
  expiresAt: string;
}): WorkOffer {
  const now = new Date().toISOString();
  const offerId = sha256Hex(`work-offer:${config.federationId}:${config.creatorIdentity}:${now}:${randomUUID()}`);

  return {
    offerId,
    federationId: config.federationId,
    creatorIdentity: config.creatorIdentity,
    title: config.title,
    summary: config.summary,
    category: config.category,
    requestedOutcome: config.requestedOutcome,
    artifactScope: config.artifactScope,
    maxEffortBand: config.maxEffortBand,
    dharmaOfferAmount: config.dharmaOfferAmount,
    visibility: config.visibility ?? "federation_only",
    requiredRoles: config.requiredRoles ?? [],
    capabilityClass: config.capabilityClass ?? "analysis",
    expiresAt: config.expiresAt,
    cancellationPolicy: "",
    status: "draft",
    revision: 1,
    priorEventId: null,
  };
}

// ── Work Claim Creation ─────────────────────────────────────────────────────

/** Create a work claim */
export function createWorkClaim(config: {
  offerId: string;
  federationId: string;
  claimantIdentity: string;
  expiresAt?: string;
}): WorkClaim {
  const now = new Date().toISOString();
  const claimId = sha256Hex(`work-claim:${config.offerId}:${config.claimantIdentity}:${now}:${randomUUID()}`);

  return {
    claimId,
    offerId: config.offerId,
    federationId: config.federationId,
    claimantIdentity: config.claimantIdentity,
    claimedAt: now,
    status: "active",
    releasedAt: null,
    expiresAt: config.expiresAt ?? null,
  };
}
