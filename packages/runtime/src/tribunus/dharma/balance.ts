/**
 * Dharma Federation Runtime — Balance Projection Logic
 *
 * Pure functions for computing and applying dharma balance
 * changes from accepted/disputed/voided receipts.
 */

import type {
  DharmaBalance,
  BalanceEntry,
  BalanceCategory,
  ContributionReceipt,
} from "./types";
import { randomUUID } from "node:crypto"
import { sha256Hex } from "./types";

// ── Balance Computation ──────────────────────────────────────────────────────

/** Compute or recompute a Dharma balance from a list of accepted receipts */
export function computeBalance(
  identityId: string,
  federationId: string,
  acceptedReceipts: ContributionReceipt[],
  disputedReceiptIds: Set<string>,
  voidedReceiptIds: Set<string>,
): DharmaBalance {
  const now = new Date().toISOString();
  let confirmedDharma = 0;
  let disputedDharma = 0;

  for (const receipt of acceptedReceipts) {
    if (voidedReceiptIds.has(receipt.receiptId)) {
      // Voided receipts are deducted from confirmed
      // (i.e., subtract their amount if it was previously counted)
      // Since voided means "this receipt's contribution is reversed"
      confirmedDharma -= receipt.dharmaAmount;
    } else if (disputedReceiptIds.has(receipt.receiptId)) {
      disputedDharma += receipt.dharmaAmount;
    } else {
      confirmedDharma += receipt.dharmaAmount;
    }
  }

  return {
    identityId,
    federationId,
    provisionalDharma: 0,
    confirmedDharma: Math.max(0, confirmedDharma),
    disputedDharma,
    lastUpdated: now,
  };
}

/** Create an empty balance for an identity */
export function createEmptyBalance(identityId: string, federationId: string): DharmaBalance {
  return {
    identityId,
    federationId,
    provisionalDharma: 0,
    confirmedDharma: 0,
    disputedDharma: 0,
    lastUpdated: new Date().toISOString(),
  };
}

/** Apply a single receipt to a balance, returning the updated balance */
export function applyReceiptToBalance(
  balance: DharmaBalance,
  receipt: ContributionReceipt,
): DharmaBalance {
  const amount = receipt.dharmaAmount;
  let confirmed = balance.confirmedDharma;
  let disputed = balance.disputedDharma;

  switch (receipt.status) {
    case "accepted":
    case "confirmed":
      confirmed += amount;
      break;
    case "disputed":
      disputed += amount;
      break;
    case "voided":
      confirmed = Math.max(0, confirmed - amount);
      break;
    default:
      // provisional receipts are not yet confirmed
      break;
  }

  return {
    ...balance,
    provisionalDharma: balance.provisionalDharma,
    confirmedDharma: confirmed,
    disputedDharma: disputed,
    lastUpdated: new Date().toISOString(),
  };
}

/** Create a balance entry from a receipt */
export function createBalanceEntry(
  identityId: string,
  federationId: string,
  receipt: ContributionReceipt,
  category: BalanceCategory,
): BalanceEntry {
  const now = new Date().toISOString();
  const entryId = sha256Hex(
    `balance-entry:${federationId}:${identityId}:${receipt.receiptId}:${now}:${randomUUID()}`,
  );

  return {
    entryId,
    identityId,
    federationId,
    receiptId: receipt.receiptId,
    amount: receipt.dharmaAmount,
    category,
    recordedAt: now,
  };
}
