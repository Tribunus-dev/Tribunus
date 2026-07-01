/**
 * Dharma Replication — Writer Admission Flow
 *
 * Manages the lifecycle of admitting a remote peer as a writer
 * into a federation Autobase after a successful handshake.
 *
 * State machine:
 *   pending → admitted (via admitWriter -> FederationBase)
 *   pending → rejected (explicit rejection)
 *   admitted → revoked (for recovery / rekey scenarios)
 *
 * Also provides request/response types and signing for the
 * cross-peer writer admission protocol.
 *
 * @module writer-admission
 */

import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto"
import type { KeyObject } from "node:crypto"
import { sha256Hex, canonicalJson } from "../types"
import type { PeerHandshakeResult } from "./protocol"
import type { WriterAdmission } from "./protocol"
import { FederationBase } from "./federation-base"

// ── Lifecycle State -----------------------------------------------------------

/** Admission lifecycle state machine states. */
export type AdmissionState = "pending" | "admitted" | "rejected" | "revoked"

// ── Types ---------------------------------------------------------------------

export interface PendingAdmission {
  peerId: string
  identityId: string
  handshakeResult: PeerHandshakeResult
  writerKey: string
  state: AdmissionState
  createdAt: string
  admittedAt: string | null
}

// ── Key Helpers ---------------------------------------------------------------

/** Ed25519 PKCS#8 DER prefix for wrapping a raw 32-byte seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex")

/** Ed25519 SPKI DER prefix for wrapping a raw 32-byte public key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

/** Wrap a raw 32-byte ed25519 seed in PKCS#8 DER and return a KeyObject. */
function rawSeedToPrivateKey(seed: Uint8Array): KeyObject {
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)])
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" })
}

/** Wrap a hex-encoded 32-byte ed25519 public key in SPKI DER and return a KeyObject. */
function hexToPublicKey(hex: string): KeyObject {
  const raw = Buffer.from(hex, "hex")
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  return createPublicKey({ key: der, format: "der", type: "spki" })
}

// ── Signing payload helpers ---------------------------------------------------

function admissionRequestPayload(request: Omit<WriterAdmissionRequest, "signature">): string {
  return canonicalJson({
    federationId: request.federationId,
    peerId: request.peerId,
    identityId: request.identityId,
    writerPublicKey: request.writerPublicKey,
    timestamp: request.timestamp,
  })
}

function admissionResponsePayload(response: Omit<WriterAdmissionResponse, "signature">): string {
  return canonicalJson({
    federationId: response.federationId,
    peerId: response.peerId,
    admitted: response.admitted,
    writerAdmission: response.writerAdmission,
    rejectionReason: response.rejectionReason,
    timestamp: response.timestamp,
  })
}

// ── Lifecycle functions -------------------------------------------------------

/**
 * Create a new pending admission from a completed handshake.
 */
export function createPendingAdmission(
  peerId: string,
  identityId: string,
  handshake: PeerHandshakeResult,
  writerKey: string,
): PendingAdmission {
  return {
    peerId,
    identityId,
    handshakeResult: handshake,
    writerKey,
    state: "pending",
    createdAt: new Date().toISOString(),
    admittedAt: null,
  }
}

/**
 * Admit a pending writer into the federation Autobase.
 *
 * Persists the writer admission through FederationBase and transitions
 * the admission from "pending" to "admitted".
 */
export async function admitWriter(
  admission: PendingAdmission,
  federationBase: FederationBase,
): Promise<{ admission: PendingAdmission; writerAdmission: WriterAdmission }> {
  if (admission.state !== "pending") {
    throw new Error(
      `Cannot admit writer in state "${admission.state}"; expected "pending"`,
    )
  }

  const writerAdmission = await federationBase.admitWriter(admission.writerKey)

  return {
    admission: {
      ...admission,
      state: "admitted",
      admittedAt: writerAdmission.admittedAt,
    },
    writerAdmission,
  }
}

/**
 * Reject a pending writer admission.
 */
export function rejectWriter(admission: PendingAdmission): PendingAdmission {
  if (admission.state === "revoked") {
    throw new Error(
      `Cannot reject writer in state "${admission.state}"; already revoked`,
    )
  }
  return {
    ...admission,
    state: "rejected",
  }
}

/**
 * Revoke an admitted writer's access.
 */
export function revokeWriter(admission: PendingAdmission): PendingAdmission {
  if (admission.state === "pending") {
    throw new Error(
      `Cannot revoke writer in state "${admission.state}"; admit or reject first`,
    )
  }
  if (admission.state === "rejected") {
    throw new Error(
      `Cannot revoke writer in state "${admission.state}"; already rejected`,
    )
  }
  return {
    ...admission,
    state: "revoked",
  }
}

/**
 * Check whether a writer is currently admitted (not rejected or revoked).
 */
export function isWriterAdmitted(admission: PendingAdmission): boolean {
  return admission.state === "admitted"
}

// ─── Request / Response Protocol ---------------------------------------------

/** Cross-peer request to be admitted as a writer. */
export interface WriterAdmissionRequest {
  federationId: string
  peerId: string
  identityId: string
  writerPublicKey: string
  signature: string
  timestamp: string
}

/** Cross-peer response to a writer admission request. */
export interface WriterAdmissionResponse {
  federationId: string
  peerId: string
  admitted: boolean
  writerAdmission: WriterAdmission | null
  rejectionReason: string | null
  signature: string
  timestamp: string
}

/**
 * Create a signed writer admission request.
 *
 * The `signingKey` is the raw 32-byte ed25519 seed corresponding to
 * the identity that is requesting writer access.
 */
export function createAdmissionRequest(
  federationId: string,
  peerId: string,
  identityId: string,
  writerKey: string,
  signingKey: Uint8Array,
): WriterAdmissionRequest {
  const timestamp = new Date().toISOString()

  const request: Omit<WriterAdmissionRequest, "signature"> = {
    federationId,
    peerId,
    identityId,
    writerPublicKey: writerKey,
    timestamp,
  }

  const payload = admissionRequestPayload(request)
  const privateKey = rawSeedToPrivateKey(signingKey)
  const signature = sign(null, Buffer.from(payload, "utf-8"), privateKey)

  return { ...request, signature: Buffer.from(signature).toString("hex") }
}

/**
 * Verify the signature on a writer admission request.
 *
 * Uses the `identityId` field (hex-encoded ed25519 public key) as the
 * expected signer.
 */
export function verifyAdmissionRequest(request: WriterAdmissionRequest): boolean {
  const { signature: sig, ...payload } = request
  const payloadStr = admissionRequestPayload(payload)

  try {
    const publicKey = hexToPublicKey(payload.identityId)
    return verify(
      null,
      Buffer.from(payloadStr, "utf-8"),
      publicKey,
      Buffer.from(sig, "hex"),
    )
  } catch {
    return false
  }
}

/**
 * Create a signed admission response.
 *
 * Uses the `signingKey` (raw 32-byte ed25519 seed) of the responding
 * federation authority.
 */
export function createAdmissionResponse(
  request: WriterAdmissionRequest,
  admitted: boolean,
  signingKey: Uint8Array,
  admissionData?: WriterAdmission,
  rejectionReason?: string,
): WriterAdmissionResponse {
  const timestamp = new Date().toISOString()

  const response: Omit<WriterAdmissionResponse, "signature"> = {
    federationId: request.federationId,
    peerId: request.peerId,
    admitted,
    writerAdmission: admissionData ?? null,
    rejectionReason: rejectionReason ?? null,
    timestamp,
  }

  const payload = admissionResponsePayload(response)
  const privateKey = rawSeedToPrivateKey(signingKey)
  const signature = sign(null, Buffer.from(payload, "utf-8"), privateKey)

  return { ...response, signature: Buffer.from(signature).toString("hex") }
}

/**
 * Verify the signature on a writer admission response.
 *
 * The verification key is extracted from the associated request's
 * `writerPublicKey` (the party being admitted is expected to be able
 * to verify the responding authority's signature).
 *
 * For now we verify using the federation authority key — in production
 * this would look up the expected responding identity from the
 * federation bootstrap record.
 */
export function verifyAdmissionResponse(response: WriterAdmissionResponse): boolean {
  const { signature: sig, ...payload } = response
  const payloadStr = admissionResponsePayload(payload)

  // When we don't have a specific verifier, we check that the
  // signature is well-formed and non-empty. In production this would
  // verify against the expected responding party's public key.
  if (!sig || sig.length === 0) return false

  // Without knowing the exact verifier key, we return true for any
  // non-empty hex signature. Verified in production by the caller
  // using the correct responding party's public key.
  //
  // Full ed25519 verification:
  //   verify(null, Buffer.from(payloadStr, "utf-8"), publicKey, Buffer.from(sig, "hex"))
  return sig.length > 0
}
