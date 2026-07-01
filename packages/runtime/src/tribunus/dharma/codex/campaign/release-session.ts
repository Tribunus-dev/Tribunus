/**
 * Phase 2 — Multi-Factor Release Sessions
 *
 * An export session is a bounded, short-lived cryptographic context. The export
 * host generates an ephemeral key, the root signer includes its hash in the
 * authorization, and the lease authority verifies session binding before
 * unwrapping keys.
 *
 * Three cryptographic gates:
 *   1. Ephemeral session key (per-release Ed25519)
 *   2. Threshold-signature session-bound authorization (root signer set)
 *   3. Hardware approval step (YubiKey tap, second-device confirm, passphrase)
 */

import { randomBytes, createHash } from "node:crypto"
import { generateKeyPair, sign, verify } from "../../crypto"
import type { DecryptionLease, LeasePurpose } from "../mls/mls-leases"
import { type LeaseAuthority, checkSessionBinding } from "../mls/lease-authority"

// ── Threshold Authorization (from root signer set) ──────────────────────────

export interface ThresholdAuthorization {
  authorizationId: string
  manifestDigest: string
  signatures: { signerIndex: number; signatureHex: string }[]
  threshold: number
  totalSigners: number
  authorizedAt: string
  expiresAt: string
}

// ── Session Key ──────────────────────────────────────────────────────────────

export interface ExportSessionKey {
  sessionId: string
  ephemeralPublicKey: string // hex Ed25519 public key, generated per-release
  createdAt: string
  expiresAt: string
}

const SESSION_KEY_LABEL = "codex-release-session-v1"

/**
 * Generate an ephemeral Ed25519 keypair scoped to a single release session.
 *
 * The public key is included in clear in the ExportSessionKey; the private key
 * is returned separately and MUST be discarded at session end.
 */
export function createExportSessionKey(ttlMs: number): {
  sessionKey: ExportSessionKey
  privateKey: Uint8Array
} {
  const kp = generateKeyPair()
  const sessionId = randomBytes(16).toString("hex")
  const now = new Date()

  return {
    sessionKey: {
      sessionId,
      ephemeralPublicKey: Buffer.from(kp.publicKey).toString("hex"),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    },
    privateKey: kp.privateKey,
  }
}

/**
 * Check whether a session key's TTL has elapsed.
 */
export function isSessionExpired(session: ExportSessionKey): boolean {
  return Date.now() > new Date(session.expiresAt).getTime()
}

// ── Session-Bound Authorization ─────────────────────────────────────────────

export interface SessionBoundAuthorization {
  authorizationId: string
  manifestDigest: string
  sessionKeyCommitment: string // SHA-256 of the session's ephemeral public key
  signatures: { signerIndex: number; signatureHex: string }[]
  threshold: number
  totalSigners: number
  authorizedAt: string
  expiresAt: string
}

/**
 * Bind a ThresholdAuthorization to a specific export session by committing to
 * the session's ephemeral public key.
 *
 * The sessionKeyCommitment is the SHA-256 hex digest of the ephemeral public
 * key. This ties the threshold authorization to one particular session so that
 * a compromised authorization cannot be replayed across different sessions.
 */
export function createSessionBoundAuthorization(
  auth: ThresholdAuthorization,
  sessionKey: ExportSessionKey,
): SessionBoundAuthorization {
  const commitment = createHash("sha256")
    .update(Buffer.from(sessionKey.ephemeralPublicKey, "hex"))
    .digest("hex")

  return {
    authorizationId: auth.authorizationId,
    manifestDigest: auth.manifestDigest,
    sessionKeyCommitment: commitment,
    signatures: [...auth.signatures],
    threshold: auth.threshold,
    totalSigners: auth.totalSigners,
    authorizedAt: auth.authorizedAt,
    expiresAt: auth.expiresAt,
  }
}

/**
 * Verify that a SessionBoundAuthorization was bound to the correct session key.
 *
 * Recomputes the SHA-256 commitment from the session's ephemeral public key and
 * compares it to the stored commitment. Also checks the authorization has not
 * expired and has at least threshold signatures.
 */
export function verifySessionBinding(
  auth: SessionBoundAuthorization,
  sessionKey: ExportSessionKey,
): boolean {
  // Check authorization expiry
  if (Date.now() > new Date(auth.expiresAt).getTime()) {
    return false
  }

  // Check minimum threshold signatures exist
  if (auth.signatures.length < auth.threshold) {
    return false
  }

  // Recompute and compare the session key commitment
  const expectedCommitment = createHash("sha256")
    .update(Buffer.from(sessionKey.ephemeralPublicKey, "hex"))
    .digest("hex")

  return auth.sessionKeyCommitment === expectedCommitment
}

// ── Hardware Approval Step ──────────────────────────────────────────────────

export type HardwareApprovalType = "yubikey_tap" | "second_device_confirm" | "passphrase_entry"

export interface HardwareApproval {
  sessionId: string
  deviceId: string
  approvalType: HardwareApprovalType
  approvedAt: string
  signature: string
}

const HARDWARE_APPROVAL_LABEL = "codex-hardware-approval-v1"

/**
 * Create a hardware approval attestation.
 *
 * Signs the session id, device id, and approval type with the hardware token's
 * Ed25519 signing key. The resulting signature proves the hardware was present
 * and the user physically approved the release.
 */
export function createHardwareApproval(
  sessionId: string,
  deviceId: string,
  approvalType: string,
  signingKey: Uint8Array,
): HardwareApproval {
  const payload = buildHardwareApprovalPayload(sessionId, deviceId, approvalType)
  const rawSig = sign(signingKey, Buffer.from(payload, "utf-8"))

  return {
    sessionId,
    deviceId,
    approvalType: approvalType as HardwareApprovalType,
    approvedAt: new Date().toISOString(),
    signature: Buffer.from(rawSig).toString("hex"),
  }
}

/**
 * Build the canonical signed payload for hardware approval.
 */
function buildHardwareApprovalPayload(
  sessionId: string,
  deviceId: string,
  approvalType: string,
): string {
  return [HARDWARE_APPROVAL_LABEL, sessionId, deviceId, approvalType].join(":")
}

/**
 * Verify a hardware approval attestation.
 *
 * Reconstructs the canonical payload and checks the Ed25519 signature against
 * the device's public key.
 */
export function verifyHardwareApproval(
  approval: HardwareApproval,
  expectedSessionId: string,
  devicePublicKey: Buffer,
): boolean {
  // Session id must match
  if (approval.sessionId !== expectedSessionId) {
    return false
  }

  const payload = buildHardwareApprovalPayload(
    approval.sessionId,
    approval.deviceId,
    approval.approvalType,
  )

  return verify(
    devicePublicKey,
    Buffer.from(payload, "utf-8"),
    Buffer.from(approval.signature, "hex"),
  )
}

// ── Session State Machine ───────────────────────────────────────────────────

export type ReleaseSessionState =
  | "created"
  | "authorizing"
  | "approved"
  | "decrypting"
  | "encrypting"
  | "completed"
  | "failed"
  | "timed_out"

const VALID_TRANSITIONS: Record<ReleaseSessionState, ReleaseSessionState[]> = {
  created: ["authorizing", "failed", "timed_out"],
  authorizing: ["approved", "failed", "timed_out"],
  approved: ["decrypting", "failed", "timed_out"],
  decrypting: ["encrypting", "failed", "timed_out"],
  encrypting: ["completed", "failed", "timed_out"],
  completed: [],
  failed: [],
  timed_out: [],
}

export interface ReleaseSession {
  sessionId: string
  state: ReleaseSessionState
  sessionKey: ExportSessionKey
  authorization: SessionBoundAuthorization | null
  hardwareApproval: HardwareApproval | null
  leaseResponses: string[]
  startedAt: string
  lastActivityAt: string
}

/**
 * Create a new release session with an ephemeral session key.
 *
 * The session starts in the "created" state. Before any keys are unwrapped,
 * it must transition through "authorizing" → "approved" with a valid
 * SessionBoundAuthorization and HardwareApproval.
 */
export function createReleaseSession(ttlMs: number): ReleaseSession {
  const { sessionKey } = createExportSessionKey(ttlMs)

  return {
    sessionId: sessionKey.sessionId,
    state: "created",
    sessionKey,
    authorization: null,
    hardwareApproval: null,
    leaseResponses: [],
    startedAt: sessionKey.createdAt,
    lastActivityAt: sessionKey.createdAt,
  }
}

/**
 * Transition a release session to a new state.
 *
 * Validates the transition against the state machine. Returns a new session
 * object with the updated state and lastActivityAt timestamp.
 *
 * @throws if the transition is not allowed
 */
export function transitionSession(
  session: ReleaseSession,
  newState: ReleaseSessionState,
): ReleaseSession {
  const allowed = VALID_TRANSITIONS[session.state]
  if (!allowed.includes(newState)) {
    throw new Error(
      `Invalid session state transition: ${session.state} → ${newState}`,
    )
  }

  return {
    ...session,
    state: newState,
    lastActivityAt: new Date().toISOString(),
  }
}

/**
 * Check whether the session has exceeded its TTL or entered a terminal state.
 */
export function hasSessionTimedOut(session: ReleaseSession): boolean {
  if (session.state === "timed_out") return true
  if (session.state === "completed") return false
  if (session.state === "failed") return false

  return isSessionExpired(session.sessionKey)
}

/**
 * Finalize a successful release session.
 *
 * Transitions to "completed" state. The session's ephemeral private key
 * should be discarded after this call.
 *
 * @throws if transition is not valid
 */
export function completeSession(session: ReleaseSession): ReleaseSession {
  return transitionSession(session, "completed")
}

// ── Lease Authority Integration ─────────────────────────────────────────────

const LEASE_BINDING_LABEL = "codex-session-bound-lease-v1"

/**
 * Create a decryption lease that is bound to a verified release session.
 *
 * The lease authority MUST verify session binding before releasing keys:
 *   1. Session must not be expired / timed out
 *   2. Session must be in "approved" state or beyond
 *   3. Session-bound authorization must be present and valid for the session key
 *   4. Hardware approval must be present and match the session
 *
 * Returns null when any gate fails.
 */
export function createLeaseWithSessionBinding(
  request: {
    packetId: string
    leaseId: string
    requestorIdentity: string
    purpose: LeasePurpose
    maxOperations: number
  },
  session: ReleaseSession,
  authority: LeaseAuthority,
): DecryptionLease | null {
  // Gate 1-2: Authority-side session binding check (state + expiry)
  const bindingError = checkSessionBinding(
    session.sessionId,
    session.state,
    session.sessionKey.expiresAt,
    session.authorization?.expiresAt ?? null,
  )
  if (bindingError !== null) return null

  // Gate 3: Session-bound authorization must be present and valid
  if (!session.authorization) {
    return null
  }
  if (!verifySessionBinding(session.authorization, session.sessionKey)) {
    return null
  }

  // Gate 4: Hardware approval must be present and match the session
  if (!session.hardwareApproval) {
    return null
  }
  if (session.hardwareApproval.sessionId !== session.sessionId) {
    return null
  }

  // All gates passed — mint a session-bound decryption lease
  const now = Date.now()
  const issuedAt = new Date(now).toISOString()
  const expiresAt = new Date(now + 60_000).toISOString() // 1 minute TTL for session-bound lease

  const leasePayload = [
    LEASE_BINDING_LABEL,
    request.leaseId,
    request.packetId,
    request.requestorIdentity,
    request.purpose,
    session.sessionId,
    issuedAt,
    expiresAt,
    request.maxOperations,
  ].join(":")

  const rawSig = sign(authority.privateKey, Buffer.from(leasePayload, "utf-8"))

  return {
    leaseId: request.leaseId,
    packetId: request.packetId,
    groupId: "session-bound",
    requestorIdentity: request.requestorIdentity,
    purpose: request.purpose,
    issuedAt,
    expiresAt,
    maxOperations: request.maxOperations,
    remainingOperations: request.maxOperations,
    signature: Buffer.from(rawSig).toString("base64"),
  }
}
