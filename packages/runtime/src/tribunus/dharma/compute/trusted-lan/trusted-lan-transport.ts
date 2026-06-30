/**
 * Dharma Trusted-LAN — Handshake Protocol and Output Frames
 *
 * Pure functions for the requester↔provider handshake lifecycle and
 * structured output frame construction.
 */

import type { LanComputeHandshake, LanComputeHandshakeAcceptance, LanComputeOutputFrame, FrameKind } from "./trusted-lan-types"
import { HandshakeError, TransportError } from "./trusted-lan-errors"

// ── Crypto Helpers ----------------------------------------------------------

function nowISO(): string {
  return new Date().toISOString()
}

function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
}

function hashHex(data: string): string {
  let h1 = 0, h2 = 5381
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i)
    h1 = ((h1 << 5) - h1) + ch; h1 |= 0
    h2 = ((h2 << 5) + h2) + ch; h2 |= 0
  }
  const abs = (n: number) => Math.abs(n)
  const hex = (n: number) => n.toString(16).padStart(8, "0")
  return hex(abs(h1)) + hex(abs(h2)) + hex(abs(h1 + h2)) + hex(abs(h1 * h2))
}

// ── Handshake ---------------------------------------------------------------

/**
 * Create a compute handshake from a requester to a provider.
 *
 * The handshake carries the requester's identity, session context,
 * and lease request digest along with a fresh nonce for replay
 * protection.  The `providerDevicePublicKey` is left null until
 * the provider accepts and fills in its device-level key.
 */
export function createHandshake(config: {
  requesterKey: string
  requesterDeviceKey: string
  providerKey: string
  sessionId: string
  membershipId: string
  epoch: number
  leaseDigest: string
}): LanComputeHandshake {
  if (!config.requesterKey) throw new HandshakeError("requesterKey is required")
  if (!config.requesterDeviceKey) throw new HandshakeError("requesterDeviceKey is required")
  if (!config.providerKey) throw new HandshakeError("providerKey is required")
  if (!config.sessionId) throw new HandshakeError("sessionId is required")
  if (!config.membershipId) throw new HandshakeError("membershipId is required")
  if (config.epoch < 0) throw new HandshakeError("epoch must be non-negative")
  if (!config.leaseDigest) throw new HandshakeError("leaseDigest is required")

  const nonce = generateNonce()
  const timestamp = nowISO()

  // Deterministic signature over the handshake payload
  const payload = [
    config.requesterKey, config.requesterDeviceKey, config.providerKey,
    config.sessionId, config.membershipId, String(config.epoch),
    config.leaseDigest, nonce, timestamp,
  ].join("|")
  const signature = hashHex(payload)

  return {
    protocolVersion: 1,
    requesterIdentityPublicKey: config.requesterKey,
    requesterDevicePublicKey: config.requesterDeviceKey,
    providerIdentityPublicKey: config.providerKey,
    providerDevicePublicKey: null,
    sessionId: config.sessionId,
    membershipId: config.membershipId,
    sessionKeyEpoch: config.epoch,
    leaseRequestDigest: config.leaseDigest,
    nonce,
    timestamp,
    signature,
  }
}

/**
 * Create a handshake acceptance from the provider to the requester.
 *
 * The acceptance echoes the handshake's original nonce (enabling
 * the requester to verify this is a genuine response) and supplies
 * a new nonce of its own.  The `adDigest` should be a digest of
 * the provider's current capability advertisement so the requester
 * can confirm negotiated terms.
 */
export function createHandshakeAcceptance(
  handshake: LanComputeHandshake,
  providerKey: string,
  providerDeviceKey: string,
  adDigest: string,
): LanComputeHandshakeAcceptance {
  if (!handshake) throw new HandshakeError("handshake is required")
  if (!providerKey) throw new HandshakeError("providerKey is required")
  if (!providerDeviceKey) throw new HandshakeError("providerDeviceKey is required")
  if (!adDigest) throw new HandshakeError("adDigest is required")

  const nonce = generateNonce()
  const timestamp = nowISO()

  const payload = [
    String(handshake.protocolVersion), providerKey, providerDeviceKey,
    adDigest, handshake.nonce, nonce, timestamp,
  ].join("|")
  const signature = hashHex(payload)

  return {
    protocolVersion: handshake.protocolVersion,
    providerIdentityPublicKey: providerKey,
    providerDevicePublicKey: providerDeviceKey,
    providerAdvertisementDigest: adDigest,
    containmentCapabilityDigest: "",
    negotiatedTransportLimits: "{}",
    nonceEcho: handshake.nonce,
    nonce,
    timestamp,
    signature,
  }
}

/**
 * Verify that the handshake acceptance's `nonceEcho` matches the
 * original nonce sent in the initial handshake.  This guards
 * against replay and ensures the acceptance is bound to the
 * correct handshake.
 */
export function verifyHandshakeNonce(
  acceptance: LanComputeHandshakeAcceptance,
  originalNonce: string,
): boolean {
  if (!acceptance) throw new HandshakeError("acceptance is required")
  if (!originalNonce) throw new HandshakeError("originalNonce is required")
  return acceptance.nonceEcho === originalNonce
}

// ── Output Frames -----------------------------------------------------------

/**
 * Build a structured output frame for streaming compute results
 * from the provider to the requester over the trusted-LAN transport.
 *
 * Frames carry a typed payload that is either inline (`payload`)
 * or referenced by digest.  The `isFinal` flag signals the last
 * frame in a lease sequence.
 */
export function createOutputFrame(
  leaseId: string,
  sequence: number,
  kind: FrameKind,
  payload: string | null,
  isFinal: boolean,
): LanComputeOutputFrame {
  if (!leaseId) throw new TransportError("leaseId is required")
  if (sequence < 0) throw new TransportError("sequence must be non-negative")
  if (!kind) throw new TransportError("frameKind is required")

  const payloadDigest = payload !== null ? hashHex(payload) : ""
  const bytes = payload !== null ? new TextEncoder().encode(payload).length : 0

  const framePayload = [leaseId, String(sequence), kind, payloadDigest, String(bytes), String(isFinal)].join("|")
  const signature = hashHex(framePayload)

  return {
    leaseId,
    sequenceNumber: sequence,
    frameKind: kind,
    payloadDigest,
    payload,
    bytes,
    final: isFinal,
    signature,
  }
}
