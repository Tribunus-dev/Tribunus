/**
 * Dharma Federation Runtime — Balance Projection Tests
 */

import { describe, test, expect } from "bun:test";
import {
  computeBalance,
  createEmptyBalance,
  applyReceiptToBalance,
  createBalanceEntry,
} from "../balance";
import type { ContributionReceipt, ReceiptStatus, DharmaBalance } from "../types";

// Helpers
function makeReceipt(
  overrides: Partial<ContributionReceipt> & { status: ReceiptStatus; receiptId: string; dharmaAmount: number },
): ContributionReceipt {
  return {
    receiptId: overrides.receiptId,
    federationId: "fed-1",
    issuerPublicKey: "issuer-1",
    beneficiaryPublicKey: "beneficiary-1",
    workOfferId: null,
    localReceiptHash: "hash",
    contributionClass: "implementation",
    dharmaAmount: overrides.dharmaAmount,
    evidenceDigest: "evidence",
    issuedAt: "2026-01-01T00:00:00Z",
    expirationAt: null,
    revocationPolicy: "",
    disclosureLevel: "federation_only",
    status: overrides.status,
  };
}

// ── Empty Balance ───────────────────────────────────────────────────────────

describe("createEmptyBalance", () => {
  test("starts at 0", () => {
    const bal = createEmptyBalance("identity-1", "fed-1");

    expect(bal.identityId).toBe("identity-1");
    expect(bal.federationId).toBe("fed-1");
    expect(bal.provisionalDharma).toBe(0);
    expect(bal.confirmedDharma).toBe(0);
    expect(bal.disputedDharma).toBe(0);
    expect(bal.lastUpdated).toBeTruthy();
  });
});

// ── Compute Balance ─────────────────────────────────────────────────────────

describe("computeBalance", () => {
  test("with empty list returns zeros", () => {
    const bal = computeBalance("identity-1", "fed-1", [], new Set(), new Set());

    expect(bal.confirmedDharma).toBe(0);
    expect(bal.disputedDharma).toBe(0);
    expect(bal.provisionalDharma).toBe(0);
  });

  test("with one accepted receipt sets confirmedDharma", () => {
    const receipts = [
      makeReceipt({ receiptId: "r1", dharmaAmount: 100, status: "accepted" }),
    ];
    const bal = computeBalance("identity-1", "fed-1", receipts, new Set(), new Set());

    expect(bal.confirmedDharma).toBe(100);
    expect(bal.disputedDharma).toBe(0);
  });

  test("with disputed receipt sets disputedDharma", () => {
    const receipts = [
      makeReceipt({ receiptId: "r1", dharmaAmount: 50, status: "accepted" }),
      makeReceipt({ receiptId: "r2", dharmaAmount: 30, status: "accepted" }),
    ];
    const bal = computeBalance("identity-1", "fed-1", receipts, new Set(["r2"]), new Set());

    expect(bal.confirmedDharma).toBe(50);
    expect(bal.disputedDharma).toBe(30);
  });

  test("with voided receipt deducts from confirmed", () => {
    const receipts = [
      makeReceipt({ receiptId: "r1", dharmaAmount: 100, status: "accepted" }),
      makeReceipt({ receiptId: "r2", dharmaAmount: 30, status: "accepted" }),
    ];
    const bal = computeBalance("identity-1", "fed-1", receipts, new Set(), new Set(["r2"]));

    // r1=100 confirmed, r2=30 voided → confirmed is 100-30=70
    expect(bal.confirmedDharma).toBe(70);
    expect(bal.disputedDharma).toBe(0);
  });

  test("confirmed balance never goes below 0 with excessive voided", () => {
    const receipts = [
      makeReceipt({ receiptId: "r1", dharmaAmount: 10, status: "accepted" }),
    ];
    const bal = computeBalance("identity-1", "fed-1", receipts, new Set(), new Set(["r1"]));

    // r1=10, voided → confirmed is max(0, 10-10) = 0
    expect(bal.confirmedDharma).toBe(0);
  });
});

// ── Apply Receipt to Balance ────────────────────────────────────────────────

describe("applyReceiptToBalance", () => {
  test("adds accepted receipt amount to confirmedDharma", () => {
    const bal: DharmaBalance = {
      identityId: "id-1",
      federationId: "fed-1",
      provisionalDharma: 0,
      confirmedDharma: 100,
      disputedDharma: 0,
      lastUpdated: "2026-01-01T00:00:00Z",
    };
    const receipt = makeReceipt({ receiptId: "r1", dharmaAmount: 50, status: "accepted" });
    const result = applyReceiptToBalance(bal, receipt);

    expect(result.confirmedDharma).toBe(150);
    expect(result.disputedDharma).toBe(0);
  });

  test("adds disputed receipt amount to disputedDharma", () => {
    const bal: DharmaBalance = {
      identityId: "id-1",
      federationId: "fed-1",
      provisionalDharma: 0,
      confirmedDharma: 100,
      disputedDharma: 0,
      lastUpdated: "2026-01-01T00:00:00Z",
    };
    const receipt = makeReceipt({ receiptId: "r1", dharmaAmount: 30, status: "disputed" });
    const result = applyReceiptToBalance(bal, receipt);

    expect(result.confirmedDharma).toBe(100);
    expect(result.disputedDharma).toBe(30);
  });

  test("deducts voided receipt from confirmedDharma", () => {
    const bal: DharmaBalance = {
      identityId: "id-1",
      federationId: "fed-1",
      provisionalDharma: 0,
      confirmedDharma: 100,
      disputedDharma: 0,
      lastUpdated: "2026-01-01T00:00:00Z",
    };
    const receipt = makeReceipt({ receiptId: "r1", dharmaAmount: 40, status: "voided" });
    const result = applyReceiptToBalance(bal, receipt);

    expect(result.confirmedDharma).toBe(60);
  });

  test("confirmed balance floor at 0 for voided exceeding balance", () => {
    const bal: DharmaBalance = {
      identityId: "id-1",
      federationId: "fed-1",
      provisionalDharma: 0,
      confirmedDharma: 10,
      disputedDharma: 0,
      lastUpdated: "2026-01-01T00:00:00Z",
    };
    const receipt = makeReceipt({ receiptId: "r1", dharmaAmount: 100, status: "voided" });
    const result = applyReceiptToBalance(bal, receipt);

    expect(result.confirmedDharma).toBe(0);
  });

  test("draft status does not change balance amounts", () => {
    const bal: DharmaBalance = {
      identityId: "id-1",
      federationId: "fed-1",
      provisionalDharma: 0,
      confirmedDharma: 50,
      disputedDharma: 0,
      lastUpdated: "2026-01-01T00:00:00Z",
    };
    const receipt = makeReceipt({ receiptId: "r1", dharmaAmount: 20, status: "draft" });
    const result = applyReceiptToBalance(bal, receipt);

    expect(result.confirmedDharma).toBe(50);
    expect(result.disputedDharma).toBe(0);
  });
});

// ── Create Balance Entry ────────────────────────────────────────────────────

describe("createBalanceEntry", () => {
  test("creates a balance entry from a receipt", () => {
    const receipt = makeReceipt({ receiptId: "r1", dharmaAmount: 100, status: "accepted" });
    const entry = createBalanceEntry("identity-1", "fed-1", receipt, "confirmed");

    expect(entry.entryId).toBeTruthy();
    expect(typeof entry.entryId).toBe("string");
    expect(entry.identityId).toBe("identity-1");
    expect(entry.federationId).toBe("fed-1");
    expect(entry.receiptId).toBe("r1");
    expect(entry.amount).toBe(100);
    expect(entry.category).toBe("confirmed");
    expect(entry.recordedAt).toBeTruthy();
  });
});
