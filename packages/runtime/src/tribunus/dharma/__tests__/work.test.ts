/**
 * Dharma Federation Runtime — Work Offer & Claim Tests
 */

import { describe, test, expect } from "bun:test";
import {
  createWorkOffer,
  createWorkClaim,
  isValidWorkOfferTransition,
  isValidWorkClaimTransition,
} from "../work";

// ── Work Offer ──────────────────────────────────────────────────────────────

describe("createWorkOffer", () => {
  const baseConfig = {
    federationId: "fed-1",
    creatorIdentity: "creator-1",
    title: "Implement auth module",
    summary: "Build the authentication and authorization module",
    category: "implementation",
    requestedOutcome: "Working auth module with tests",
    artifactScope: "src/auth/",
    maxEffortBand: "m" as const,
    dharmaOfferAmount: 100,
    expiresAt: "2027-01-01T00:00:00Z",
  };

  test("sets all required fields with defaults", () => {
    const offer = createWorkOffer(baseConfig);

    expect(offer.offerId).toBeTruthy();
    expect(typeof offer.offerId).toBe("string");
    expect(offer.federationId).toBe("fed-1");
    expect(offer.creatorIdentity).toBe("creator-1");
    expect(offer.title).toBe("Implement auth module");
    expect(offer.summary).toBe("Build the authentication and authorization module");
    expect(offer.category).toBe("implementation");
    expect(offer.requestedOutcome).toBe("Working auth module with tests");
    expect(offer.artifactScope).toBe("src/auth/");
    expect(offer.maxEffortBand).toBe("m");
    expect(offer.dharmaOfferAmount).toBe(100);
    expect(offer.expiresAt).toBe("2027-01-01T00:00:00Z");

    // Defaults
    expect(offer.visibility).toBe("federation_only");
    expect(offer.requiredRoles).toEqual([]);
    expect(offer.capabilityClass).toBe("analysis");
    expect(offer.cancellationPolicy).toBe("");
    expect(offer.status).toBe("draft");
    expect(offer.revision).toBe(1);
    expect(offer.priorEventId).toBeNull();
  });

  test("accepts custom visibility, roles, and capabilityClass", () => {
    const offer = createWorkOffer({
      ...baseConfig,
      visibility: "public_summary",
      requiredRoles: ["contributor", "reviewer"],
      capabilityClass: "code_review",
    });

    expect(offer.visibility).toBe("public_summary");
    expect(offer.requiredRoles).toEqual(["contributor", "reviewer"]);
    expect(offer.capabilityClass).toBe("code_review");
  });

  test("generates a unique offerId per call", () => {
    const a = createWorkOffer(baseConfig);
    const b = createWorkOffer(baseConfig);
    // Due to timestamp in seed, ids should differ
    expect(a.offerId).not.toBe(b.offerId);
  });
});

// ── Work Offer Transitions ──────────────────────────────────────────────────

describe("isValidWorkOfferTransition", () => {
  test("draft → published is valid", () => {
    expect(isValidWorkOfferTransition("draft", "published")).toBe(true);
  });

  test("draft → settled is invalid (skips steps)", () => {
    expect(isValidWorkOfferTransition("draft", "settled")).toBe(false);
  });

  test("published → cancelled is valid", () => {
    expect(isValidWorkOfferTransition("published", "cancelled")).toBe(true);
  });

  test("published → claimed is valid", () => {
    expect(isValidWorkOfferTransition("published", "claimed")).toBe(true);
  });

  test("claimed → released is valid", () => {
    expect(isValidWorkOfferTransition("claimed", "released")).toBe(true);
  });

  test("claimed → expired is valid", () => {
    expect(isValidWorkOfferTransition("claimed", "expired")).toBe(true);
  });

  test("settled → anything is invalid (terminal state)", () => {
    expect(isValidWorkOfferTransition("settled", "draft")).toBe(false);
    expect(isValidWorkOfferTransition("settled", "published")).toBe(false);
  });
});

// ── Work Claim ──────────────────────────────────────────────────────────────

describe("createWorkClaim", () => {
  test("generates valid claim with required fields", () => {
    const claim = createWorkClaim({
      offerId: "offer-1",
      federationId: "fed-1",
      claimantIdentity: "claimant-1",
    });

    expect(claim.claimId).toBeTruthy();
    expect(typeof claim.claimId).toBe("string");
    expect(claim.offerId).toBe("offer-1");
    expect(claim.federationId).toBe("fed-1");
    expect(claim.claimantIdentity).toBe("claimant-1");
    expect(claim.claimedAt).toBeTruthy();
    expect(claim.status).toBe("active");
    expect(claim.releasedAt).toBeNull();
    expect(claim.expiresAt).toBeNull();
  });

  test("accepts optional expiresAt", () => {
    const claim = createWorkClaim({
      offerId: "offer-2",
      federationId: "fed-1",
      claimantIdentity: "claimant-2",
      expiresAt: "2027-01-01T00:00:00Z",
    });

    expect(claim.expiresAt).toBe("2027-01-01T00:00:00Z");
  });
});

// ── Work Claim Transitions ──────────────────────────────────────────────────

describe("isValidWorkClaimTransition", () => {
  test("active → released is valid", () => {
    expect(isValidWorkClaimTransition("active", "released")).toBe(true);
  });

  test("active → expired is valid", () => {
    expect(isValidWorkClaimTransition("active", "expired")).toBe(true);
  });

  test("active → completed is valid", () => {
    expect(isValidWorkClaimTransition("active", "completed")).toBe(true);
  });

  test("completed → active is invalid (terminal)", () => {
    expect(isValidWorkClaimTransition("completed", "active")).toBe(false);
  });

  test("expired → anything is invalid (terminal)", () => {
    expect(isValidWorkClaimTransition("expired", "active")).toBe(false);
  });
});
