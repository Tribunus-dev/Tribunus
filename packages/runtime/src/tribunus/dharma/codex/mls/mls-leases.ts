/**
 * MLS Decryption Leases — Short-lived Decryption Lease System
 *
 * UnwrapPacketDek requires a lease, not just MLS membership. Leases gate
 * decryption to authorized requestors with time-bound, operation-count-limited
 * credentials.
 */

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto"

// ── Constants ────────────────────────────────────────────────────────────────

const LEASE_SIGNING_LABEL = "codex-mls-lease-v1"
const DEFAULT_MAX_OPERATIONS = 100

// ── Types ────────────────────────────────────────────────────────────────────

export type LeasePurpose = "read" | "export" | "replication"

export interface DecryptionLease {
  leaseId: string
  packetId: string
  groupId: string
  requestorIdentity: string
  purpose: LeasePurpose
  issuedAt: string
  expiresAt: string
  maxOperations: number
  /** Remaining operations before the lease is exhausted */
  remainingOperations: number
  /** HMAC-SHA256 signature binding lease fields to the issuing store */
  signature: string
}

export interface LeaseStore {
  activeLeases: Map<string, DecryptionLease>
  revokedLeases: Set<string>
  leaseCount: number
  /** HMAC signing key for lease signatures (hex-encoded) */
  _signingKey: string
}

// ── Lease Store ──────────────────────────────────────────────────────────────

/**
 * Create a new in-memory lease store with a randomly generated signing key.
 */
export function createLeaseStore(): LeaseStore {
  return {
    activeLeases: new Map(),
    revokedLeases: new Set(),
    leaseCount: 0,
    _signingKey: randomBytes(32).toString("hex"),
  }
}

// ── Lease Signing ────────────────────────────────────────────────────────────

function signLease(lease: DecryptionLease, signingKey: string): string {
  const payload = canonicalLeasePayload(lease)
  return createHmac("sha256", signingKey)
    .update(payload)
    .digest("hex")
}

function canonicalLeasePayload(lease: DecryptionLease): string {
  return [
    lease.leaseId,
    lease.packetId,
    lease.groupId,
    lease.requestorIdentity,
    lease.purpose,
    lease.issuedAt,
    lease.expiresAt,
    lease.maxOperations,
    lease.remainingOperations,
  ].join(":")
}

function verifyLeaseSignature(
  lease: DecryptionLease,
  signingKey: string,
): boolean {
  const expected = signLease(lease, signingKey)
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(lease.signature, "hex"),
    )
  } catch {
    return false
  }
}

// ── Lease Operations ─────────────────────────────────────────────────────────

/**
 * Issue a new decryption lease for a packet.
 *
 * Generates a random lease ID, timestamps, and signs the lease with the
 * store's HMAC signing key.
 *
 * @param store     LeaseStore to issue from
 * @param packetId  Target packet identifier
 * @param groupId   MLS group ID
 * @param requestor Identity requesting decryption access
 * @param purpose   Decryption purpose
 * @param ttlMs     Lease time-to-live in milliseconds
 * @returns         Signed DecryptionLease
 */
export function issueLease(
  store: LeaseStore,
  packetId: string,
  groupId: string,
  requestor: string,
  purpose: LeasePurpose,
  ttlMs: number,
): DecryptionLease {
  const leaseId = randomBytes(16).toString("hex")
  const now = Date.now()
  const issuedAt = new Date(now).toISOString()
  const expiresAt = new Date(now + ttlMs).toISOString()

  const lease: DecryptionLease = {
    leaseId,
    packetId,
    groupId,
    requestorIdentity: requestor,
    purpose,
    issuedAt,
    expiresAt,
    maxOperations: DEFAULT_MAX_OPERATIONS,
    remainingOperations: DEFAULT_MAX_OPERATIONS,
    signature: "",
  }

  lease.signature = signLease(lease, store._signingKey)
  store.activeLeases.set(leaseId, lease)
  store.leaseCount++

  return lease
}

/**
 * Verify a lease's validity.
 *
 * Checks:
 * - Lease is not revoked
 * - Signature is authentic
 * - Lease has not expired
 * - Lease has remaining operations
 *
 * @returns { valid: boolean, reason: string | null }
 */
export function verifyLease(
  store: LeaseStore,
  lease: DecryptionLease,
): { valid: boolean; reason: string | null } {
  // Check revocation
  if (store.revokedLeases.has(lease.leaseId)) {
    return { valid: false, reason: "Lease has been revoked" }
  }

  // Check signature
  if (!verifyLeaseSignature(lease, store._signingKey)) {
    return { valid: false, reason: "Lease signature is invalid" }
  }

  // Check expiry
  if (isLeaseExpired(lease)) {
    return { valid: false, reason: "Lease has expired" }
  }

  // Check remaining operations
  if (lease.remainingOperations <= 0) {
    return { valid: false, reason: "Lease has no remaining operations" }
  }

  return { valid: true, reason: null }
}

/**
 * Consume one operation from a lease.
 *
 * Decrements the remaining operation count. If the lease is revoked, expired,
 * or exhausted, throws an error.
 *
 * @returns Updated LeaseStore
 */
export function consumeLease(
  store: LeaseStore,
  leaseId: string,
): LeaseStore {
  const lease = store.activeLeases.get(leaseId)
  if (!lease) {
    throw new Error(`Lease not found: ${leaseId}`)
  }

  const verification = verifyLease(store, lease)
  if (!verification.valid) {
    throw new Error(`Cannot consume lease: ${verification.reason}`)
  }

  const updated: DecryptionLease = {
    ...lease,
    remainingOperations: lease.remainingOperations - 1,
  }

  // Re-sign the lease with updated remaining count
  updated.signature = signLease(updated, store._signingKey)

  const next = new Map(store.activeLeases)
  next.set(leaseId, updated)

  return {
    ...store,
    activeLeases: next,
  }
}

/**
 * Revoke a lease by ID.
 *
 * Once revoked, the lease cannot be used for decryption.
 *
 * @returns Updated LeaseStore
 */
export function revokeLease(
  store: LeaseStore,
  leaseId: string,
): LeaseStore {
  const revoked = new Set(store.revokedLeases)
  revoked.add(leaseId)
  const active = new Map(store.activeLeases)
  active.delete(leaseId)
  return {
    ...store,
    activeLeases: active,
    revokedLeases: revoked,
  }
}

/**
 * Check if a lease has expired by comparing its expiration timestamp
 * against the current time.
 */
export function isLeaseExpired(lease: DecryptionLease): boolean {
  return Date.now() > new Date(lease.expiresAt).getTime()
}

/**
 * Check whether a lease would allow decrypting a packet.
 *
 * This is a convenience wrapper around verifyLease that returns a boolean.
 * It does not consume the lease.
 */
export function canDecryptPacket(
  store: LeaseStore,
  lease: DecryptionLease,
): boolean {
  return verifyLease(store, lease).valid
}
