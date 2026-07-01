/**
 * Prism Local-Host KV Transport — Handshake
 */

import type {
  LocalKvTransportHandshake,
  LocalKvTransportHandshakeAcceptance,
  HandshakeRejection,
} from "./local-transport-types"

// ── Create Handshake ────────────────────────────────────────────────────────

/**
 * Create a new transport handshake with a generated nonce and timestamp.
 */
export function createHandshake(
  workerId: string,
  instanceId: string,
  hostId: string,
  capDigest: string,
  pubKey: string,
): LocalKvTransportHandshake {
  const nonce = generateNonce()
  const timestamp = new Date().toISOString()
  const signature = computeSignature(workerId, instanceId, hostId, nonce, timestamp)
  return {
    protocolVersion: 1,
    workerId,
    workerInstanceId: instanceId,
    hostInstanceId: hostId,
    transportCapabilityDigest: capDigest,
    ephemeralTransportPublicKey: pubKey,
    nonce,
    timestamp,
    signature,
  }
}

// ── Create Handshake Acceptance ─────────────────────────────────────────────

/**
 * Create an acceptance for a received handshake.
 * Uses a fresh nonce and echoes the original handshake's nonce.
 */
export function createHandshakeAcceptance(
  handshake: LocalKvTransportHandshake,
  workerId: string,
  instanceId: string,
  hostId: string,
  capDigest: string,
  pubKey: string,
): LocalKvTransportHandshakeAcceptance {
  const nonce = generateNonce()
  const timestamp = new Date().toISOString()
  const signature = computeSignature(workerId, instanceId, hostId, nonce, timestamp)
  return {
    protocolVersion: 1,
    workerId,
    workerInstanceId: instanceId,
    hostInstanceId: hostId,
    transportCapabilityDigest: capDigest,
    ephemeralTransportPublicKey: pubKey,
    nonceEcho: handshake.nonce,
    nonce,
    timestamp,
    signature,
  }
}

// ── Verify Handshake ────────────────────────────────────────────────────────

/**
 * Verify a handshake against its acceptance.
 * Returns `{ valid, rejection, reason }`.
 */
export function verifyHandshake(
  handshake: LocalKvTransportHandshake,
  acceptance: LocalKvTransportHandshakeAcceptance,
): { valid: boolean; rejection: HandshakeRejection | null; reason: string | null } {
  // Protocol version must match
  if (handshake.protocolVersion !== acceptance.protocolVersion) {
    return {
      valid: false,
      rejection: "protocol_version_mismatch",
      reason: `Protocol version mismatch: ${handshake.protocolVersion} !== ${acceptance.protocolVersion}`,
    }
  }

  // Nonce echo must match the original handshake nonce
  if (acceptance.nonceEcho !== handshake.nonce) {
    return {
      valid: false,
      rejection: "replayed_nonce",
      reason: `Nonce echo mismatch: ${acceptance.nonceEcho} !== ${handshake.nonce}`,
    }
  }

  // Worker identity must be consistent
  if (handshake.workerId !== acceptance.workerId) {
    return {
      valid: false,
      rejection: "unknown_worker",
      reason: `Worker ID mismatch: ${handshake.workerId} !== ${acceptance.workerId}`,
    }
  }

  // Host instance must be consistent
  if (handshake.hostInstanceId !== acceptance.hostInstanceId) {
    return {
      valid: false,
      rejection: "host_authority_mismatch",
      reason: `Host instance mismatch: ${handshake.hostInstanceId} !== ${acceptance.hostInstanceId}`,
    }
  }

  // Worker instance must match
  if (handshake.workerInstanceId !== acceptance.workerInstanceId) {
    return {
      valid: false,
      rejection: "worker_instance_mismatch",
      reason: `Worker instance mismatch: ${handshake.workerInstanceId} !== ${acceptance.workerInstanceId}`,
    }
  }

  // Capability digest must match
  if (handshake.transportCapabilityDigest !== acceptance.transportCapabilityDigest) {
    return {
      valid: false,
      rejection: "transport_capability_mismatch",
      reason: `Capability digest mismatch: ${handshake.transportCapabilityDigest} !== ${acceptance.transportCapabilityDigest}`,
    }
  }

  // Signature must be present and non-empty (structural check)
  if (!handshake.signature || !acceptance.signature) {
    return {
      valid: false,
      rejection: "invalid_signature",
      reason: "Empty or missing signature",
    }
  }

  return { valid: true, rejection: null, reason: null }
}

// ── Nonce Replay Check ──────────────────────────────────────────────────────

/**
 * Check whether a nonce has already been seen (replay protection).
 */
export function isNonceReplayed(nonce: string, seenNonces: Set<string>): boolean {
  return seenNonces.has(nonce)
}

// ── Handshake Expiry Check ──────────────────────────────────────────────────

/**
 * Check whether a handshake has expired given a TTL in milliseconds.
 */
export function isHandshakeExpired(handshake: LocalKvTransportHandshake, ttlMs: number): boolean {
  const timestamp = new Date(handshake.timestamp).getTime()
  if (Number.isNaN(timestamp)) {
    return true // unparseable timestamp => treat as expired
  }
  return Date.now() - timestamp > ttlMs
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateNonce(): string {
  // Use timestamp + random bytes for a unique nonce
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 10)
  return `${ts}-${rand}`
}

function computeSignature(
  workerId: string,
  instanceId: string,
  hostId: string,
  nonce: string,
  timestamp: string,
): string {
  // Structural signature: in production this would be a real cryptographic
  // signature over the concatenation of fields. For the structural layer
  // a deterministic hash is sufficient to exercise the verification paths.
  const raw = [workerId, instanceId, hostId, nonce, timestamp].join(":")
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0 // convert to 32-bit integer
  }
  return `sig:${Math.abs(hash).toString(16).padStart(8, "0")}`
}
