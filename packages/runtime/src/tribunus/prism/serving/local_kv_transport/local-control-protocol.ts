/**
 * Prism Local-Host KV Transport — Control Protocol
 */

import type { LocalKvControlMessage, LocalKvControlMessageKind } from "./local-transport-types"

// ── Create Control Message ──────────────────────────────────────────────────

/**
 * Create a new control message with a generated message ID, sequence number,
 * timestamp, and structural signature.
 */
export function createControlMessage(
  handoffId: string,
  kind: LocalKvControlMessageKind,
  payload: Record<string, unknown> | null,
  sourceInstanceId: string,
  destInstanceId: string,
): LocalKvControlMessage {
  const messageId = generateMessageId()
  const sentAt = new Date().toISOString()
  const payloadDigest = computePayloadDigest(payload)
  const rawForSig = [handoffId, kind, sourceInstanceId, destInstanceId, sentAt, payloadDigest].join(":")
  const signature = computeControlSignature(rawForSig)
  return {
    protocolVersion: 1,
    messageId,
    sequenceNumber: 1,
    handoffId,
    routeId: `${sourceInstanceId}->${destInstanceId}`,
    requestId: messageId,
    sourceWorkerInstanceId: sourceInstanceId,
    destinationWorkerInstanceId: destInstanceId,
    kind,
    payloadDigest,
    payload,
    sentAt,
    signature,
  }
}

// ── Validate Control Message ────────────────────────────────────────────────

/**
 * Validate that a control message matches expected handoff, source, and destination.
 * Returns `{ valid, reason }`.
 */
export function validateControlMessage(
  msg: LocalKvControlMessage,
  expectedHandoffId: string,
  expectedSource: string,
  expectedDest: string,
): { valid: boolean; reason: string | null } {
  if (msg.handoffId !== expectedHandoffId) {
    return {
      valid: false,
      reason: `Handoff ID mismatch: ${msg.handoffId} !== ${expectedHandoffId}`,
    }
  }
  if (msg.sourceWorkerInstanceId !== expectedSource) {
    return {
      valid: false,
      reason: `Source instance mismatch: ${msg.sourceWorkerInstanceId} !== ${expectedSource}`,
    }
  }
  if (msg.destinationWorkerInstanceId !== expectedDest) {
    return {
      valid: false,
      reason: `Destination instance mismatch: ${msg.destinationWorkerInstanceId} !== ${expectedDest}`,
    }
  }
  if (!msg.messageId) {
    return { valid: false, reason: "Missing messageId" }
  }
  if (!msg.sentAt) {
    return { valid: false, reason: "Missing sentAt timestamp" }
  }
  if (!msg.signature) {
    return { valid: false, reason: "Missing signature" }
  }
  return { valid: true, reason: null }
}

// ── Sequential Check ────────────────────────────────────────────────────────

/**
 * Check that `currentSeq` follows `lastSeq` sequentially.
 */
export function isSequential(currentSeq: number, lastSeq: number): boolean {
  return currentSeq === lastSeq + 1
}

// ── Expected Control Flow ───────────────────────────────────────────────────

/**
 * Return the expected sequence of control message kinds for a given message kind.
 * For terminal or simple messages, returns a single-element array with the kind itself.
 */
export function getExpectedControlFlow(kind: LocalKvControlMessageKind): string[] {
  switch (kind) {
    case "handshake":
      return ["handshake", "handshake_accept"]
    case "handshake_accept":
      return ["handshake_accept"]
    case "handoff_offer":
      return ["handoff_offer", "handoff_accept", "handoff_reject"]
    case "handoff_accept":
      return ["handoff_accept"]
    case "handoff_reject":
      return ["handoff_reject"]
    case "export_ready":
      return ["export_ready", "segment_descriptor"]
    case "segment_descriptor":
      return ["segment_descriptor"]
    case "import_started":
      return ["import_started", "import_verified"]
    case "import_verified":
      return ["import_verified", "import_activated"]
    case "import_activated":
      return ["import_activated", "import_acknowledged"]
    case "import_acknowledged":
      return ["import_acknowledged"]
    case "commit":
      return ["commit"]
    case "rollback":
      return ["rollback"]
    case "cancel":
      return ["cancel"]
    case "source_disposition_request":
      return ["source_disposition_request", "source_disposition_complete"]
    case "source_disposition_complete":
      return ["source_disposition_complete"]
    case "heartbeat":
      return ["heartbeat"]
    case "error":
      return ["error"]
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateMessageId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 10)
  return `msg-${ts}-${rand}`
}

function computePayloadDigest(payload: Record<string, unknown> | null): string {
  if (payload === null) {
    return "null"
  }
  const json = JSON.stringify(payload)
  let hash = 0
  for (let i = 0; i < json.length; i++) {
    const chr = json.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return `pd:${Math.abs(hash).toString(16).padStart(8, "0")}`
}

function computeControlSignature(raw: string): string {
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return `cs:${Math.abs(hash).toString(16).padStart(8, "0")}`
}
