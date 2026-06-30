/**
 * Dharma Federation Runtime — Contribution Receipt Tests
 */

import { describe, test, expect } from "bun:test";
import {
  createReceipt,
  isValidReceiptTransition,
  getDefaultDisclosureLevel,
} from "../receipt";

// ── Receipt Creation ────────────────────────────────────────────────────────

describe("createReceipt", () => {
  const baseConfig = {
    federationId: "fed-1",
    issuerPublicKey: "pubkey-issuer",
    beneficiaryPublicKey: "pubkey-beneficiary",
    localReceiptHash: "hash-abc123",
    contributionClass: "implementation" as const,
    dharmaAmount: 50,
    evidenceDigest: "evidence-digest-xyz",
  };

  test("sets all required fields", () => {
    const receipt = createReceipt(baseConfig);

    expect(receipt.receiptId).toBeTruthy();
    expect(typeof receipt.receiptId).toBe("string");
    expect(receipt.federationId).toBe("fed-1");
    expect(receipt.issuerPublicKey).toBe("pubkey-issuer");
    expect(receipt.beneficiaryPublicKey).toBe("pubkey-beneficiary");
    expect(receipt.localReceiptHash).toBe("hash-abc123");
    expect(receipt.contributionClass).toBe("implementation");
    expect(receipt.dharmaAmount).toBe(50);
    expect(receipt.evidenceDigest).toBe("evidence-digest-xyz");
    expect(receipt.issuedAt).toBeTruthy();
    expect(receipt.status).toBe("draft");

    // Defaults
    expect(receipt.workOfferId).toBeNull();
    expect(receipt.expirationAt).toBeNull();
    expect(receipt.revocationPolicy).toBe("");
    expect(receipt.disclosureLevel).toBe("federation_only");
  });

  test("accepts optional workOfferId, expirationAt, disclosureLevel, revocationPolicy", () => {
    const receipt = createReceipt({
      ...baseConfig,
      workOfferId: "offer-42",
      expirationAt: "2028-01-01T00:00:00Z",
      disclosureLevel: "public_evidence",
      revocationPolicy: "no-revoke",
    });

    expect(receipt.workOfferId).toBe("offer-42");
    expect(receipt.expirationAt).toBe("2028-01-01T00:00:00Z");
    expect(receipt.disclosureLevel).toBe("public_evidence");
    expect(receipt.revocationPolicy).toBe("no-revoke");
  });

  test("generates a unique receiptId per call", () => {
    const a = createReceipt(baseConfig);
    const b = createReceipt(baseConfig);
    expect(a.receiptId).not.toBe(b.receiptId);
  });
});

// ── Receipt Transitions ─────────────────────────────────────────────────────

describe("isValidReceiptTransition", () => {
  test("draft → locally_durable is valid", () => {
    expect(isValidReceiptTransition("draft", "locally_durable")).toBe(true);
  });

  test("draft → confirmed is invalid (skips steps)", () => {
    expect(isValidReceiptTransition("draft", "confirmed")).toBe(false);
  });

  test("recipient_pending → accepted is valid", () => {
    expect(isValidReceiptTransition("recipient_pending", "accepted")).toBe(true);
  });

  test("recipient_pending → rejected is valid", () => {
    expect(isValidReceiptTransition("recipient_pending", "rejected")).toBe(true);
  });

  test("accepted → disputed is valid", () => {
    expect(isValidReceiptTransition("accepted", "disputed")).toBe(true);
  });

  test("accepted → voided is valid", () => {
    expect(isValidReceiptTransition("accepted", "voided")).toBe(true);
  });

  test("disputed → confirmed is valid", () => {
    expect(isValidReceiptTransition("disputed", "confirmed")).toBe(true);
  });

  test("voided → anything is invalid (terminal)", () => {
    expect(isValidReceiptTransition("voided", "draft")).toBe(false);
  });
});

// ── Default Disclosure Level ────────────────────────────────────────────────

describe("getDefaultDisclosureLevel", () => {
  test("returns 'federation_only'", () => {
    expect(getDefaultDisclosureLevel()).toBe("federation_only");
  });
});
