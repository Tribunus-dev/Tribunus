/**
 * Dharma Federation Runtime — Contribution Receipt Helpers
 *
 * Pure functions for creating contribution receipts and validating
 * their lifecycle transitions per the Dharma v1 specification.
 */

import type {
  ContributionReceipt,
  ReceiptStatus,
  ContributionClass,
  DisclosureLevel,
} from "./types";
import { randomUUID } from "node:crypto"
import { sha256Hex } from "./types";

// ── Receipt Status Transitions ───────────────────────────────────────────────

/**
 * Valid status transitions for a contribution receipt.
 * From spec (forward): draft → locally_durable → exported → replicated →
 *   recipient_pending → accepted → confirmed
 * Also: recipient_pending → rejected; accepted → disputed → confirmed;
 *   accepted → voided
 */
export const VALID_RECEIPT_TRANSITIONS: Record<ReceiptStatus, readonly ReceiptStatus[]> = {
  draft: ["locally_durable"],
  locally_durable: ["exported"],
  exported: ["replicated"],
  replicated: ["recipient_pending"],
  recipient_pending: ["accepted", "rejected"],
  accepted: ["confirmed", "disputed", "voided"],
  rejected: [],
  confirmed: [],
  disputed: ["confirmed"],
  voided: [],
};

/** Check if a receipt status transition is valid */
export function isValidReceiptTransition(current: ReceiptStatus, next: ReceiptStatus): boolean {
  return VALID_RECEIPT_TRANSITIONS[current].includes(next);
}

// ── Receipt Creation ────────────────────────────────────────────────────────

/** Create a new contribution receipt */
export function createReceipt(config: {
  federationId: string;
  issuerPublicKey: string;
  beneficiaryPublicKey: string;
  workOfferId?: string;
  localReceiptHash: string;
  contributionClass: ContributionClass;
  dharmaAmount: number;
  evidenceDigest: string;
  disclosureLevel?: DisclosureLevel;
  expirationAt?: string;
  revocationPolicy?: string;
}): ContributionReceipt {
  const now = new Date().toISOString();
  const receiptId = sha256Hex(
    `receipt:${config.federationId}:${config.issuerPublicKey}:${config.beneficiaryPublicKey}:${now}:${randomUUID()}`,
  );

  return {
    receiptId,
    federationId: config.federationId,
    issuerPublicKey: config.issuerPublicKey,
    beneficiaryPublicKey: config.beneficiaryPublicKey,
    workOfferId: config.workOfferId ?? null,
    localReceiptHash: config.localReceiptHash,
    contributionClass: config.contributionClass,
    dharmaAmount: config.dharmaAmount,
    evidenceDigest: config.evidenceDigest,
    issuedAt: now,
    expirationAt: config.expirationAt ?? null,
    revocationPolicy: config.revocationPolicy ?? "",
    disclosureLevel: config.disclosureLevel ?? "federation_only",
    status: "draft",
  };
}

/** Compute the default disclosure level for a receipt */
export function getDefaultDisclosureLevel(): DisclosureLevel {
  return "federation_only";
}
