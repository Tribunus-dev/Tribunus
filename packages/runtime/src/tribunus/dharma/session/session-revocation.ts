/**
 * Dharma Session Authority — Grant Revocation & Key Epoch Rotation
 *
 * Pure functions for revocation lifecycle management: graceful vs emergency
 * revocation, key epoch rotation, ownership transfer validation, and drain
 * window computation.
 */

import type {
  GrantRevocation,
  RevocationKind,
  SessionAuthorityGrant,
  SessionOwnershipTransfer,
} from "./types"

// ── Constants ──────────────────────────────────────────────

/**
 * Valid revocation-kind transitions.
 *
 * A grant being gracefully-drained may be escalated to an emergency revocation.
 * Emergency is a terminal revocation kind — no further transitions are allowed.
 */
export const VALID_REVOCATION_TRANSITIONS: Record<string, readonly string[]> = {
  graceful:  ["emergency"],
  emergency: [],
} as const

// ── Revocation ─────────────────────────────────────────────

/**
 * Create a revocation record.
 *
 * Computes the next key epoch from the supplied `previousKeyEpoch` and
 * generates a random revocation ID, an ISO `effectiveAt` timestamp, and
 * a placeholder signature.
 */
export function createRevocation(config: {
  sessionId: string
  grantId: string
  subjectIdentityPublicKey: string
  revokedByIdentityPublicKey: string
  reason: string
  kind?: RevocationKind
  previousKeyEpoch: number
}): GrantRevocation {
  const kind: RevocationKind = config.kind ?? "graceful"
  const nextKeyEpoch = getNextKeyEpoch(config.previousKeyEpoch)

  return {
    revocationId: crypto.randomUUID(),
    sessionId: config.sessionId,
    grantId: config.grantId,
    subjectIdentityPublicKey: config.subjectIdentityPublicKey,
    revokedByIdentityPublicKey: config.revokedByIdentityPublicKey,
    reason: config.reason,
    kind,
    effectiveAt: new Date().toISOString(),
    previousKeyEpoch: config.previousKeyEpoch,
    nextKeyEpoch,
    signature: "",
  }
}

// ── Revocation Classification ──────────────────────────────

/** Return `true` when the revocation is emergency (immediate termination). */
export function isEmergencyRevocation(revocation: GrantRevocation): boolean {
  return revocation.kind === "emergency"
}

// ── Key Epoch ──────────────────────────────────────────────

/** Compute the next key epoch by incrementing the current value. */
export function getNextKeyEpoch(currentEpoch: number): number {
  return currentEpoch + 1
}

/**
 * Return `true` when the grant's epoch does not match the session's current
 * key epoch, meaning the grant has been superseded by an epoch rotation.
 */
export function isGrantSupersededByEpoch(
  grant: SessionAuthorityGrant,
  currentKeyEpoch: number,
): boolean {
  return grant.sessionKeyEpoch !== currentKeyEpoch
}

// ── Ownership Transfer ─────────────────────────────────────

/**
 * Create an ownership-transfer record.
 *
 * Generates a random transfer ID and an ISO `initiatedAt` timestamp.
 * The `previousOwnerSignature` is mandatory at creation; the
 * `newOwnerSignature` is set once the new owner accepts.
 */
export function createOwnershipTransfer(config: {
  sessionId: string
  previousOwner: string
  newOwner: string
  workspaceDigest: string
  activeGrantSummaryDigest: string
  transferReason: string
}): SessionOwnershipTransfer {
  return {
    transferId: crypto.randomUUID(),
    sessionId: config.sessionId,
    previousOwnerIdentityPublicKey: config.previousOwner,
    newOwnerIdentityPublicKey: config.newOwner,
    workspaceDigest: config.workspaceDigest,
    activeGrantSummaryDigest: config.activeGrantSummaryDigest,
    transferReason: config.transferReason,
    initiatedAt: new Date().toISOString(),
    acceptedAt: null,
    previousOwnerSignature: "",
    newOwnerSignature: null,
  }
}

/**
 * Check if an ownership transfer is valid.
 *
 * A transfer is valid when both the previous owner and the new owner have
 * provided their cryptographic signatures.
 */
export function isValidOwnershipTransfer(
  transfer: SessionOwnershipTransfer,
): boolean {
  return (
    typeof transfer.previousOwnerSignature === "string" &&
    transfer.previousOwnerSignature.length > 0 &&
    typeof transfer.newOwnerSignature === "string" &&
    transfer.newOwnerSignature.length > 0
  )
}

// ── Drain Window ───────────────────────────────────────────

/**
 * Compute the drain deadline for a revocation.
 *
 * - **Emergency** revocations have no drain window — returns `null`.
 * - **Graceful** revocations return an ISO timestamp that is
 *   `drainWindowMs` milliseconds from now.  If `drainWindowMs` is omitted
 *   a default of 300 000 ms (5 minutes) is used.
 */
export function getDrainDeadline(
  revocation: GrantRevocation,
  drainWindowMs: number = 300_000,
): string | null {
  if (revocation.kind === "emergency") return null
  return new Date(Date.now() + drainWindowMs).toISOString()
}
