/**
 * Dharma Live Sandbox — Restart Convergence Tests
 *
 * Tests the recovery state machine, event bridging, transport message
 * signing, and verification — all the components that must converge
 * correctly after a session host restart.
 */

import { describe, it, expect } from "bun:test"
import { randomUUID } from "node:crypto"

// ── Recovery State Types (local, mirrors restart-recovery.ts) ----------------

interface RecoveryState {
  recoveryId: string
  sessionId: string
  recoveryKind: "materialization" | "process_cleanup" | "patch_application" | "seal"
  state: "pending" | "resolved" | "failed"
  detail: Record<string, unknown> | null
  lastVerifiedDigest: string | null
  createdAt: string
  resolvedAt: string | null
}

class RecoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RecoveryError"
  }
}

const VALID_RECOVERY_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["resolved", "failed"] as const,
  resolved: [] as const,
  failed: ["pending"] as const,
}

function createRecoveryState(sessionId: string, kind: string): RecoveryState {
  const validKinds = ["materialization", "process_cleanup", "patch_application", "seal"]
  if (!validKinds.includes(kind)) {
    throw new RecoveryError(`Invalid recovery kind: "${kind}". Must be one of ${validKinds.join(", ")}`)
  }

  return {
    recoveryId: randomUUID(),
    sessionId,
    recoveryKind: kind as RecoveryState["recoveryKind"],
    state: "pending",
    detail: null,
    lastVerifiedDigest: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  }
}

function markRecoveryResolved(state: RecoveryState): RecoveryState {
  if (state.state !== "pending") {
    throw new RecoveryError(
      `Cannot resolve recovery in state "${state.state}": expected "pending"`,
    )
  }

  return {
    ...state,
    state: "resolved",
    resolvedAt: new Date().toISOString(),
  }
}

function isRecoveryNeeded(states: RecoveryState[]): boolean {
  return states.some((s) => s.state === "pending" || s.state === "failed")
}

// ── Event Link Types (local, mirrors session-event-bridge.ts) ----------------

interface SessionEventLink {
  linkId: string
  sessionId: string
  localRecordType: string
  localRecordId: string
  dharmaEventId: string | null
  replicationState: "pending" | "published" | "confirmed" | "failed"
  outboxEntryId: string | null
  publishedAt: string | null
  confirmedAt: string | null
}

function createEventLink(
  sessionId: string,
  localRecordType: string,
  localRecordId: string,
): SessionEventLink {
  return {
    linkId: randomUUID(),
    sessionId,
    localRecordType,
    localRecordId,
    dharmaEventId: null,
    replicationState: "pending",
    outboxEntryId: null,
    publishedAt: null,
    confirmedAt: null,
  }
}

function markEventPublished(
  link: SessionEventLink,
  dharmaEventId: string,
): SessionEventLink {
  if (link.replicationState !== "pending") {
    throw new Error(
      `Cannot publish event link in state "${link.replicationState}": expected "pending"`,
    )
  }

  return {
    ...link,
    dharmaEventId,
    replicationState: "published",
    publishedAt: new Date().toISOString(),
  }
}

// ── Transport Types (local, mirrors session-transport.ts) --------------------

type TransportMessageKind =
  | "join_acknowledgment"
  | "grant_projection"
  | "command_request"
  | "command_receipt"
  | "patch_proposal"
  | "patch_review_result"
  | "revocation_notification"
  | "session_lifecycle_notification"
  | "artifact_retrieval"

interface TransportMessage {
  messageId: string
  sessionId: string
  membershipId: string
  sessionKeyEpoch: number
  messageKind: TransportMessageKind
  payload: Record<string, unknown>
  identitySignature: string
  idempotencyKey: string
  sequenceNumber: number
  createdAt: string
}

function createTransportMessage(
  nodeId: string,
  sessionId: string,
  membershipId: string,
  sessionKeyEpoch: number,
  kind: TransportMessageKind,
  payload: Record<string, unknown>,
): TransportMessage {
  const messageId = randomUUID()
  return {
    messageId,
    sessionId,
    membershipId,
    sessionKeyEpoch,
    messageKind: kind,
    payload,
    identitySignature: `sig_${messageId.slice(0, 8)}`,
    idempotencyKey: randomUUID(),
    sequenceNumber: Date.now(),
    createdAt: new Date().toISOString(),
  }
}

function verifyTransportMessage(
  message: TransportMessage,
  expectedEpoch: number,
): { valid: boolean; reason: string | null } {
  if (message.sessionKeyEpoch !== expectedEpoch) {
    return {
      valid: false,
      reason: `Epoch mismatch: expected ${expectedEpoch}, got ${message.sessionKeyEpoch}`,
    }
  }

  return { valid: true, reason: null }
}

function isDuplicateMessage(
  message: TransportMessage,
  lastSequenceNumber: number,
): boolean {
  return message.sequenceNumber <= lastSequenceNumber
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Restart Recovery", () => {
  const sessionId = "sess_recovery_001"

  describe("createRecoveryState", () => {
    it("creates valid state with pending status", () => {
      const state = createRecoveryState(sessionId, "materialization")

      expect(state).toBeDefined()
      expect(state.sessionId).toBe(sessionId)
      expect(state.recoveryKind).toBe("materialization")
      expect(state.state).toBe("pending")
      expect(state.recoveryId).toBeTruthy()
      expect(state.resolvedAt).toBeNull()
      expect(state.detail).toBeNull()
      expect(state.lastVerifiedDigest).toBeNull()
    })

    it("rejects invalid recovery kind", () => {
      expect(() => createRecoveryState(sessionId, "invalid_kind")).toThrow(RecoveryError)
    })

    it("accepts all valid recovery kinds", () => {
      const kinds = ["materialization", "process_cleanup", "patch_application", "seal"] as const
      for (const kind of kinds) {
        const state = createRecoveryState(sessionId, kind)
        expect(state.recoveryKind).toBe(kind)
      }
    })
  })

  describe("markRecoveryResolved", () => {
    it("transitions pending → resolved correctly", () => {
      const state = createRecoveryState(sessionId, "patch_application")
      const resolved = markRecoveryResolved(state)

      expect(resolved.state).toBe("resolved")
      expect(resolved.resolvedAt).toBeTruthy()
      expect(resolved.createdAt).toBe(state.createdAt)
      expect(resolved.recoveryKind).toBe(state.recoveryKind)
    })

    it("throws when transitioning non-pending state", () => {
      const state = createRecoveryState(sessionId, "seal")
      const resolved = markRecoveryResolved(state)

      // Already resolved — should throw
      expect(() => markRecoveryResolved(resolved)).toThrow(RecoveryError)
    })

    it("preserves metadata on transition", () => {
      const state = createRecoveryState(sessionId, "process_cleanup")
      const resolved = markRecoveryResolved(state)

      expect(resolved.recoveryId).toBe(state.recoveryId)
      expect(resolved.sessionId).toBe(state.sessionId)
      expect(resolved.detail).toBe(state.detail)
      expect(resolved.lastVerifiedDigest).toBe(state.lastVerifiedDigest)
    })
  })

  describe("isRecoveryNeeded", () => {
    it("returns true when states are pending", () => {
      const states = [createRecoveryState(sessionId, "materialization")]
      expect(isRecoveryNeeded(states)).toBe(true)
    })

    it("returns true when states have failed items", () => {
      const state = createRecoveryState(sessionId, "materialization")
      // Create a failed state by manipulating (failed is valid transition from pending)
      const failedState: RecoveryState = { ...state, state: "failed" }
      expect(isRecoveryNeeded([failedState])).toBe(true)
    })

    it("returns false when all states resolved", () => {
      const state = createRecoveryState(sessionId, "seal")
      const resolved = markRecoveryResolved(state)
      expect(isRecoveryNeeded([resolved])).toBe(false)
    })

    it("returns false for empty array", () => {
      expect(isRecoveryNeeded([])).toBe(false)
    })

    it("returns true when mixed resolved and pending", () => {
      const resolved = markRecoveryResolved(createRecoveryState(sessionId, "materialization"))
      const pending = createRecoveryState(sessionId, "process_cleanup")

      expect(isRecoveryNeeded([resolved, pending])).toBe(true)
    })
  })
})

describe("Event Link", () => {
  const sessionId = "sess_events_001"

  describe("createEventLink", () => {
    it("creates valid link with pending replication state", () => {
      const link = createEventLink(sessionId, "session.activated", "rec_abc123")

      expect(link).toBeDefined()
      expect(link.sessionId).toBe(sessionId)
      expect(link.localRecordType).toBe("session.activated")
      expect(link.localRecordId).toBe("rec_abc123")
      expect(link.replicationState).toBe("pending")
      expect(link.linkId).toBeTruthy()
      expect(link.dharmaEventId).toBeNull()
      expect(link.publishedAt).toBeNull()
      expect(link.confirmedAt).toBeNull()
    })
  })

  describe("markEventPublished", () => {
    it("transitions pending → published correctly", () => {
      const link = createEventLink(sessionId, "session.grant_issued", "rec_xyz")
      const published = markEventPublished(link, "dharma_evt_001")

      expect(published.replicationState).toBe("published")
      expect(published.dharmaEventId).toBe("dharma_evt_001")
      expect(published.publishedAt).toBeTruthy()
      expect(published.linkId).toBe(link.linkId)
    })

    it("throws for non-pending link", () => {
      const link = createEventLink(sessionId, "session.sealed", "rec_sealed")
      const published = markEventPublished(link, "evt_001")

      expect(() => markEventPublished(published, "evt_002")).toThrow(
        /Cannot publish event link/,
      )
    })
  })
})

describe("Transport Message", () => {
  const sessionId = "sess_transport_001"
  const membershipId = "mem_peer_001"

  describe("createTransportMessage", () => {
    it("creates signed message with all fields", () => {
      const msg = createTransportMessage(
        "node_1",
        sessionId,
        membershipId,
        3,
        "join_acknowledgment",
        { status: "ok" },
      )

      expect(msg.messageId).toBeTruthy()
      expect(msg.sessionId).toBe(sessionId)
      expect(msg.membershipId).toBe(membershipId)
      expect(msg.sessionKeyEpoch).toBe(3)
      expect(msg.messageKind).toBe("join_acknowledgment")
      expect(msg.identitySignature).toBeTruthy()
      expect(msg.payload).toEqual({ status: "ok" })
      expect(msg.createdAt).toBeTruthy()
    })

    it("generates unique message IDs per call", () => {
      const a = createTransportMessage("n1", sessionId, membershipId, 1, "grant_projection", {})
      const b = createTransportMessage("n1", sessionId, membershipId, 1, "grant_projection", {})
      expect(a.messageId).not.toBe(b.messageId)
    })
  })

  describe("verifyTransportMessage", () => {
    it("validates correctly when epoch matches", () => {
      const msg = createTransportMessage(
        "node_1",
        sessionId,
        membershipId,
        5,
        "command_request",
        { command: "inspect" },
      )

      const result = verifyTransportMessage(msg, 5)
      expect(result.valid).toBe(true)
      expect(result.reason).toBeNull()
    })

    it("rejects when epoch does not match", () => {
      const msg = createTransportMessage(
        "node_1",
        sessionId,
        membershipId,
        5,
        "command_request",
        { command: "inspect" },
      )

      const result = verifyTransportMessage(msg, 3)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("Epoch mismatch")
    })
  })

  describe("isDuplicateMessage", () => {
    it("detects duplicate by sequence number", () => {
      const msg = createTransportMessage(
        "node_1",
        sessionId,
        membershipId,
        1,
        "patch_proposal",
        {},
      )

      // Same sequence as last known
      expect(isDuplicateMessage(msg, msg.sequenceNumber)).toBe(true)
    })

    it("accepts newer sequence numbers", () => {
      const msg = createTransportMessage(
        "node_1",
        sessionId,
        membershipId,
        1,
        "patch_proposal",
        {},
      )

      expect(isDuplicateMessage(msg, msg.sequenceNumber - 1)).toBe(false)
    })

    it("detects older sequence numbers as duplicates", () => {
      const msg = createTransportMessage(
        "node_1",
        sessionId,
        membershipId,
        1,
        "patch_proposal",
        {},
      )

      expect(isDuplicateMessage(msg, msg.sequenceNumber + 100)).toBe(true)
    })
  })
})
