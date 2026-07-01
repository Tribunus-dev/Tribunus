/**
 * Dharma Multi-Peer Result Convergence — Deterministic Conflict Detection
 *
 * Pure functions for detecting conflicts between proposed results and
 * accepted canonical outcomes, and managing conflict lifecycle.
 */

import type {
  SessionResultBundle,
  CanonicalSessionOutcome,
  DharmaTaskContract,
  DharmaTaskClaim,
  ConflictKind,
  SessionResultConflict,
  ConflictResolutionState,
} from "./multi-peer-types";
import type { ClaimStatus } from "./multi-peer-types";
import { randomUUID } from "node:crypto";
import { ConflictError } from "./multi-peer-errors";

// ── Conflict Detection ──────────────────────────────────────────────────────

/**
 * Detect conflicts between a proposed result bundle and the set of
 * accepted canonical outcomes, given the task contract.
 *
 * Checks, in order:
 * 1. Stale source basis (proposed base differs from current canonical base)
 * 2. Path overlap with already-accepted outcomes
 * 3. Task claim violation (if the actor has an active conflict on this task)
 *
 * Returns the first conflict found.
 *
 * @param proposed - The proposed result bundle
 * @param acceptedOutcomes - All accepted canonical outcomes for the session
 * @param task - The task contract the result is for
 * @returns Conflict detection result
 */
export function detectConflict(
  proposed: SessionResultBundle,
  acceptedOutcomes: CanonicalSessionOutcome[],
  task: DharmaTaskContract,
): { hasConflict: boolean; conflictKind: ConflictKind | null; overlappingPaths: string[] } {
  // 1. Stale source basis
  const currentCanonicalDigest = getCurrentCanonicalDigest(acceptedOutcomes);
  if (currentCanonicalDigest && checkStaleBasis(proposed, currentCanonicalDigest)) {
    return {
      hasConflict: true,
      conflictKind: "stale_source_basis",
      overlappingPaths: [],
    };
  }

  // 2. Path overlap with accepted outcomes
  const acceptedPaths = collectAcceptedPaths(acceptedOutcomes);
  const { overlaps, overlapping } = checkPathOverlap(proposed.changedPathDigests, acceptedPaths);
  if (overlaps) {
    return {
      hasConflict: true,
      conflictKind: "path_overlap",
      overlappingPaths: overlapping,
    };
  }

  return {
    hasConflict: false,
    conflictKind: null,
    overlappingPaths: [],
  };
}

// ── Stale Basis Detection ───────────────────────────────────────────────────

/**
 * Check whether a proposed result is based on a stale source basis.
 *
 * The proposed result's `sourceBasisDigest` must match the current canonical
 * digest. If there are no accepted outcomes yet, any basis is current.
 *
 * @param proposed - The proposed result bundle
 * @param currentCanonicalDigest - The digest of the latest canonical outcome
 * @returns `true` if the proposed result's basis is stale
 */
export function checkStaleBasis(
  proposed: SessionResultBundle,
  currentCanonicalDigest: string,
): boolean {
  return proposed.sourceBasisDigest !== currentCanonicalDigest;
}

// ── Path Overlap ────────────────────────────────────────────────────────────

/**
 * Check whether two sets of path digests overlap.
 *
 * @param proposedPaths - Path digests from the proposed result
 * @param acceptedPaths - Path digests from accepted outcomes
 * @returns Overlap result
 */
export function checkPathOverlap(
  proposedPaths: string[],
  acceptedPaths: string[],
): { overlaps: boolean; overlapping: string[] } {
  const acceptedSet = new Set(acceptedPaths);
  const overlapping = proposedPaths.filter((p) => acceptedSet.has(p));

  return {
    overlaps: overlapping.length > 0,
    overlapping,
  };
}

// ── Claim Violation ─────────────────────────────────────────────────────────

/**
 * Check whether a proposed result violates an active claim on the task.
 *
 * A violation exists if any active claim for this task has a conflicted or
 * superseded status from a result this actor is proposing against.
 *
 * @param proposed - The proposed result bundle
 * @param activeClaims - Array of active claim statuses
 * @returns `true` if a claim violation is detected
 */
export function checkClaimViolation(
  proposed: SessionResultBundle,
  activeClaims: ClaimStatus[],
): boolean {
  return activeClaims.includes("conflicted") || activeClaims.includes("superseded");
}

// ── Conflict Record Creation ────────────────────────────────────────────────

/**
 * Create a new conflict record after detecting a conflict.
 *
 * @param config - Conflict record configuration
 * @param config.sessionId - The session the conflict belongs to
 * @param config.taskId - The task the conflict is for
 * @param config.proposedResultId - The proposed result ID that triggered the conflict
 * @param config.conflictingResultId - Optional ID of the conflicting result
 * @param config.conflictKind - The kind of conflict detected
 * @param config.baseDigest - The proposed result's source basis digest
 * @param config.currentCanonicalDigest - The current canonical digest
 * @param config.overlappingPaths - Optional list of overlapping path digests
 * @returns A fully populated SessionResultConflict
 */
export function createConflictRecord(config: {
  sessionId: string;
  taskId: string;
  proposedResultId: string;
  conflictingResultId?: string;
  conflictKind: ConflictKind;
  baseDigest: string;
  currentCanonicalDigest: string;
  overlappingPaths?: string[];
}): SessionResultConflict {
  return {
    conflictId: randomUUID(),
    sessionId: config.sessionId,
    taskId: config.taskId,
    proposedResultId: config.proposedResultId,
    conflictingResultId: config.conflictingResultId ?? null,
    conflictKind: config.conflictKind,
    baseDigest: config.baseDigest,
    currentCanonicalDigest: config.currentCanonicalDigest,
    overlappingPaths: config.overlappingPaths ?? [],
    detectedAt: new Date().toISOString(),
    resolutionState: "open",
    resolutionResultId: null,
    resolvedByIdentityPublicKey: null,
    resolvedAt: null,
  };
}

// ── Conflict Resolution ─────────────────────────────────────────────────────

/**
 * Valid resolution state transitions for a conflict.
 */
const VALID_RESOLUTION_TRANSITIONS: Record<
  ConflictResolutionState,
  readonly ConflictResolutionState[]
> = {
  open: ["rebase_requested", "manual_merge_requested", "rejected", "resolved", "superseded"],
  rebase_requested: ["resolved", "open", "rejected", "superseded"],
  manual_merge_requested: ["resolved", "rejected", "superseded"],
  superseded: [],
  rejected: [],
  resolved: [],
};

/**
 * Resolve a conflict by advancing its resolution state.
 *
 * @param conflict - The conflict record to resolve
 * @param resolution - The target resolution state
 * @returns A new SessionResultConflict with updated state (immutable)
 * @throws {ConflictError} If the transition is invalid
 */
export function resolveConflict(
  conflict: SessionResultConflict,
  resolution: "reject" | "rebase" | "resolve",
): SessionResultConflict {
  const resolutionMap: Record<string, ConflictResolutionState> = {
    reject: "rejected",
    rebase: "rebase_requested",
    resolve: "resolved",
  };

  const targetState = resolutionMap[resolution];
  const validTargets = VALID_RESOLUTION_TRANSITIONS[conflict.resolutionState];

  if (!validTargets.includes(targetState)) {
    throw new ConflictError(
      conflict.conflictId,
      `Cannot transition from "${conflict.resolutionState}" to "${targetState}".`,
    );
  }

  const now = new Date().toISOString();

  const resolved: SessionResultConflict = {
    ...conflict,
    resolutionState: targetState,
    resolvedAt: targetState === "resolved" ? now : null,
  };

  return resolved;
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Get the current (latest) canonical digest from accepted outcomes.
 * Returns null if there are no accepted outcomes.
 */
function getCurrentCanonicalDigest(
  acceptedOutcomes: CanonicalSessionOutcome[],
): string | null {
  if (acceptedOutcomes.length === 0) {
    return null;
  }
  // The most recent outcome has the highest acceptedAt timestamp
  return acceptedOutcomes.reduce((latest, o) =>
    o.acceptedAt > latest.acceptedAt ? o : latest,
  ).canonicalOutcomeDigest;
}

/**
 * Collect all changed path digests from accepted outcomes.
 */
function collectAcceptedPaths(
  acceptedOutcomes: CanonicalSessionOutcome[],
): string[] {
  const paths = new Set<string>();
  for (const o of acceptedOutcomes) {
    for (const p of o.changedPathDigests) {
      paths.add(p);
    }
  }
  return [...paths];
}
