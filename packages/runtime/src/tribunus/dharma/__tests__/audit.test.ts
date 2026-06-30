/**
 * Dharma Audit Log — unit tests
 *
 * Tests cover the pure encode/decode helpers and WHERE builder logic.
 * DB-dependent operations are excluded (require an in-memory PGlite
 * adapter layer).
 */

import { describe, it, expect } from "bun:test"
import {
  encodeForDb,
  decodeFromDb,
  buildWhere,
} from "../audit"
import type { AuditEvent } from "../types"

// ── Fixtures ───────────────────────────────────────────────

const sampleAuditEvent: AuditEvent = {
  auditId: "aud_01j3xyz789",
  eventType: "dharma.event.accepted",
  federationId: "fed_01j3abc123",
  identityId: "did:dht:alice",
  targetHash: "sha256_event_abc",
  metadata: { reason: "signature_verified", latency: 42 },
  occurredAt: "2026-06-30T12:00:00.000Z",
}

const sampleAuditEventMinimal: AuditEvent = {
  auditId: "aud_01j3xyz790",
  eventType: "dharma.federation.joined",
  federationId: null,
  identityId: null,
  targetHash: null,
  metadata: null,
  occurredAt: "2026-06-30T12:00:01.000Z",
}

// ── encodeForDb / decodeFromDb ────────────────────────────

describe("encodeForDb / decodeFromDb", () => {
  it("round-trips a full audit event", () => {
    const encoded = encodeForDb(sampleAuditEvent)
    const decoded = decodeFromDb(encoded as Record<string, unknown>)
    expect(decoded).toEqual(sampleAuditEvent)
  })

  it("round-trips a minimal audit event with null fields", () => {
    const encoded = encodeForDb(sampleAuditEventMinimal)
    const decoded = decodeFromDb(encoded as Record<string, unknown>)
    expect(decoded).toEqual(sampleAuditEventMinimal)
  })

  it("encodes null fields correctly", () => {
    const encoded = encodeForDb(sampleAuditEventMinimal)
    expect(encoded.federation_id).toBeNull()
    expect(encoded.identity_id).toBeNull()
    expect(encoded.target_hash).toBeNull()
    expect(encoded.metadata).toBeNull()
  })

  it("preserves metadata as an object", () => {
    const encoded = encodeForDb(sampleAuditEvent)
    const meta = encoded.metadata as Record<string, unknown>
    expect(meta.reason).toBe("signature_verified")
    expect(meta.latency).toBe(42)
  })

  it("maps all fields correctly", () => {
    const encoded = encodeForDb(sampleAuditEvent)
    expect(encoded.audit_id).toBe(sampleAuditEvent.auditId)
    expect(encoded.event_type).toBe(sampleAuditEvent.eventType)
    expect(encoded.occurred_at).toBe(sampleAuditEvent.occurredAt)
  })
})

// ── buildWhere ─────────────────────────────────────────────

describe("buildWhere", () => {
  it("returns undefined for empty filters", () => {
    expect(buildWhere({})).toBeUndefined()
  })

  it("adds eventType condition", () => {
    const where = buildWhere({ eventType: "dharma.event.accepted" })
    expect(where).toBeDefined()
  })

  it("adds federationId condition", () => {
    const where = buildWhere({ federationId: "fed_abc" })
    expect(where).toBeDefined()
  })

  it("adds fromTs condition", () => {
    const where = buildWhere({ fromTs: "2026-01-01T00:00:00Z" })
    expect(where).toBeDefined()
  })

  it("adds toTs condition", () => {
    const where = buildWhere({ toTs: "2026-12-31T23:59:59Z" })
    expect(where).toBeDefined()
  })

  it("combines federationId and eventType", () => {
    const where = buildWhere({
      federationId: "fed_abc",
      eventType: "dharma.event.rejected",
    })
    expect(where).toBeDefined()
  })

  it("returns undefined when all filter values are falsy", () => {
    const where = buildWhere({
      eventType: "",
      federationId: "",
    })
    expect(where).toBeUndefined()
  })
})
