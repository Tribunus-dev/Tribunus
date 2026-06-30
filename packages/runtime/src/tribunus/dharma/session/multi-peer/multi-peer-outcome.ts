/**
 * Dharma Multi-Peer Result Convergence — Canonical Outcome Chaining
 *
 * Pure functions for creating canonical session outcomes, chaining them
 * into a verifiable sequence, and verifying chain integrity.
 */

import type { CanonicalSessionOutcome } from "./multi-peer-types";
import { randomUUID } from "node:crypto";
import { CanonicalOutcomeError } from "./multi-peer-errors";

/**
 * Create the first canonical outcome in a session.
 *
 * The first outcome has no parent (`parentOutcomeDigest` is null).
 *
 * @param config - Outcome configuration
 * @param config.sessionId - The session this outcome belongs to
 * @param config.acceptedResultId - The ID of the accepted result
 * @param config.acceptedBy - Identity public key of the acceptor
 * @param config.sourceBasisDigest - The source basis digest this outcome confirms
 * @param config.canonicalOutcomeDigest - The canonical digest of the accepted state
 * @param config.changedPathDigests - Optional list of changed path digests
 * @returns A fully populated CanonicalSessionOutcome
 */
export function createFirstOutcome(config: {
  sessionId: string;
  acceptedResultId: string;
  acceptedBy: string;
  sourceBasisDigest: string;
  canonicalOutcomeDigest: string;
  changedPathDigests?: string[];
}): CanonicalSessionOutcome {
  const now = new Date().toISOString();

  return {
    outcomeId: randomUUID(),
    sessionId: config.sessionId,
    acceptedResultId: config.acceptedResultId,
    acceptedByIdentityPublicKey: config.acceptedBy,
    parentOutcomeDigest: null,
    sourceBasisDigest: config.sourceBasisDigest,
    canonicalOutcomeDigest: config.canonicalOutcomeDigest,
    changedPathDigests: config.changedPathDigests ?? [],
    verificationStatus: "verified",
    acceptanceReason: null,
    acceptedAt: now,
    signature: "",
  };
}

// ── Chain Extension ─────────────────────────────────────────────────────────

/**
 * Create the next canonical outcome in the chain, linked to a parent.
 *
 * @param previous - The previous canonical outcome (becomes the parent)
 * @param config - Outcome configuration
 * @param config.acceptedResultId - The ID of the accepted result
 * @param config.acceptedBy - Identity public key of the acceptor
 * @param config.canonicalOutcomeDigest - The canonical digest of the accepted state
 * @param config.changedPathDigests - Optional list of changed path digests
 * @returns A new CanonicalSessionOutcome linked to the previous one
 * @throws {CanonicalOutcomeError} If the parent session does not match
 */
export function createNextOutcome(
  previous: CanonicalSessionOutcome,
  config: {
    acceptedResultId: string;
    acceptedBy: string;
    canonicalOutcomeDigest: string;
    changedPathDigests?: string[];
  },
): CanonicalSessionOutcome {
  if (!previous.canonicalOutcomeDigest) {
    throw new CanonicalOutcomeError(
      "Previous outcome has no canonicalOutcomeDigest — cannot chain.",
    );
  }

  const now = new Date().toISOString();

  return {
    outcomeId: randomUUID(),
    sessionId: previous.sessionId,
    acceptedResultId: config.acceptedResultId,
    acceptedByIdentityPublicKey: config.acceptedBy,
    parentOutcomeDigest: previous.canonicalOutcomeDigest,
    sourceBasisDigest: previous.sourceBasisDigest,
    canonicalOutcomeDigest: config.canonicalOutcomeDigest,
    changedPathDigests: config.changedPathDigests ?? [],
    verificationStatus: "verified",
    acceptanceReason: null,
    acceptedAt: now,
    signature: "",
  };
}

// ── Chain Traversal ─────────────────────────────────────────────────────────

/**
 * Given a flat list of outcomes (any order), return them ordered as a chain
 * from first to last by following `parentOutcomeDigest` links.
 *
 * The first outcome (null parent) is the head, and each subsequent outcome
 * has its `parentOutcomeDigest` matching the previous outcome's
 * `canonicalOutcomeDigest`.
 *
 * @param outcomes - Flat list of canonical outcomes
 * @returns Outcomes ordered from first to last
 */
export function getOutcomeChain(
  outcomes: CanonicalSessionOutcome[],
): CanonicalSessionOutcome[] {
  if (outcomes.length === 0) {
    return [];
  }

  // Build a map from canonicalOutcomeDigest -> outcome
  const digestMap = new Map<string, CanonicalSessionOutcome>();
  for (const o of outcomes) {
    digestMap.set(o.canonicalOutcomeDigest, o);
  }

  // Find the head (parentOutcomeDigest === null)
  const head = outcomes.find((o) => o.parentOutcomeDigest === null);
  if (!head) {
    return []; // No chain head — orphaned or disconnected outcomes
  }

  const chain: CanonicalSessionOutcome[] = [head];
  let current = head;

  while (true) {
    const next = outcomes.find(
      (o) => o.parentOutcomeDigest === current.canonicalOutcomeDigest,
    );
    if (!next) {
      break;
    }
    chain.push(next);
    current = next;
  }

  return chain;
}

// ── Chain Verification ──────────────────────────────────────────────────────

/**
 * Verify the integrity of an outcome chain.
 *
 * Checks:
 * 1. The chain must have at least one outcome
 * 2. The first outcome must have a null parentOutcomeDigest
 * 3. Each outcome after the first must reference its predecessor's
 *    canonicalOutcomeDigest via parentOutcomeDigest
 * 4. All outcomes must belong to the same session
 *
 * @param outcomes - Outc
omes ordered as a chain (from first to last)
 * @returns Validation result with `valid` flag and optional `reason`
 */
export function verifyOutcomeChain(
  outcomes: CanonicalSessionOutcome[],
): { valid: boolean; reason: string | null } {
  if (outcomes.length === 0) {
    return { valid: false, reason: "Chain is empty." };
  }

  // First outcome must have null parent
  const first = outcomes[0];
  if (first.parentOutcomeDigest !== null) {
    return {
      valid: false,
      reason: "First outcome in chain must have null parentOutcomeDigest.",
    };
  }

  // All outcomes must share the same session ID
  const sessionId = first.sessionId;
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i].sessionId !== sessionId) {
      return {
        valid: false,
        reason: `Outcome at index ${i} has mismatched sessionId "${outcomes[i].sessionId}" (expected "${sessionId}").`,
      };
    }
  }

  // Verify parent/child link integrity
  for (let i = 1; i < outcomes.length; i++) {
    const prev = outcomes[i - 1];
    const curr = outcomes[i];
    if (curr.parentOutcomeDigest !== prev.canonicalOutcomeDigest) {
      return {
        valid: false,
        reason: `Outcome at index ${i} has parentOutcomeDigest "${curr.parentOutcomeDigest}" but expected "${prev.canonicalOutcomeDigest}" from index ${i - 1}.`,
      };
    }
  }

  return { valid: true, reason: null };
}
