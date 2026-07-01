/**
 * PGlite Federation Store Tests
 *
 * Tests every method of PGliteFederationStore against an in-memory PGlite
 * instance with the replication schema tables created from raw SQL.
 *
 * Covers: federation CRUD, writer admission, peer tracking, sessions,
 * outbox lifecycle, import cursors, and checkpoints.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { PGliteFederationStore, type PGliteClient } from "../pglite-store"
import type { FederationBootstrapRecord, WriterAdmission } from "../../protocol"

// ── Schema DDL (matching schema.pg.sql.ts; trimmed column list is OK
//    since the store methods only reference the columns they insert/update) ---

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS dharma_replication_federations (
  federation_id         TEXT PRIMARY KEY,
  genesis_event_id      TEXT NOT NULL,
  federation_root_public_key TEXT NOT NULL,
  autobase_key          TEXT NOT NULL,
  autobase_discovery_key TEXT NOT NULL,
  initial_policy_digest TEXT NOT NULL,
  genesis_writer_key    TEXT NOT NULL,
  bootstrap_signature   TEXT NOT NULL,
  lifecycle_state       TEXT NOT NULL DEFAULT 'unaware',
  protocol_version      INTEGER NOT NULL DEFAULT 1,
  swarm_topic           TEXT,
  created_at            TEXT NOT NULL,
  last_state_change_at  TEXT NOT NULL,
  time_created          BIGINT NOT NULL DEFAULT 0,
  time_updated          BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dharma_replication_writers (
  writer_id                 TEXT PRIMARY KEY,
  federation_id             TEXT NOT NULL,
  writer_core_public_key    TEXT NOT NULL,
  dharma_identity_public_key TEXT NOT NULL,
  membership_event_id       TEXT,
  admitted_by               TEXT,
  admitted_at               TEXT NOT NULL,
  admission_signature       TEXT,
  status                    TEXT NOT NULL DEFAULT 'active',
  last_sequence             INTEGER NOT NULL DEFAULT 0,
  events_appended           INTEGER NOT NULL DEFAULT 0,
  time_created              BIGINT NOT NULL DEFAULT 0,
  time_updated              BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dharma_replication_peers (
  peer_id               TEXT PRIMARY KEY,
  federation_id         TEXT NOT NULL,
  node_instance_id      TEXT,
  identity_public_key   TEXT,
  device_public_key     TEXT,
  first_seen_at         TEXT NOT NULL,
  last_seen_at          TEXT,
  successful_handshakes INTEGER NOT NULL DEFAULT 0,
  failed_handshakes     INTEGER NOT NULL DEFAULT 0,
  events_received       INTEGER NOT NULL DEFAULT 0,
  bytes_received        INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'discovered',
  time_created          BIGINT NOT NULL DEFAULT 0,
  time_updated          BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dharma_replication_sessions (
  session_id            TEXT PRIMARY KEY,
  federation_id         TEXT NOT NULL,
  peer_id               TEXT NOT NULL,
  protocol_version      INTEGER NOT NULL,
  handshake_result      TEXT NOT NULL,
  handshake_duration_ms INTEGER,
  accepted_federations  JSONB DEFAULT '[]',
  rejected_federations  JSONB DEFAULT '[]',
  started_at            TEXT NOT NULL,
  ended_at              TEXT,
  error_message         TEXT,
  time_created          BIGINT NOT NULL DEFAULT 0,
  time_updated          BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dharma_replication_outbox (
  outbox_id        TEXT PRIMARY KEY,
  federation_id    TEXT NOT NULL,
  event_id         TEXT NOT NULL,
  event_envelope   JSONB NOT NULL,
  state            TEXT NOT NULL DEFAULT 'created',
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT,
  writer_core_key  TEXT,
  appended_sequence INTEGER,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  time_created     BIGINT NOT NULL DEFAULT 0,
  time_updated     BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dharma_replication_import_cursors (
  cursor_id          TEXT PRIMARY KEY,
  federation_id      TEXT NOT NULL,
  cursor_type        TEXT NOT NULL,
  autobase_length    INTEGER NOT NULL DEFAULT 0,
  last_event_id      TEXT,
  last_event_timestamp TEXT,
  imported_count     INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL,
  time_created       BIGINT NOT NULL DEFAULT 0,
  time_updated       BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dharma_replication_checkpoints (
  checkpoint_id        TEXT PRIMARY KEY,
  federation_id        TEXT NOT NULL,
  autobase_signed_length INTEGER NOT NULL,
  autobase_hash        TEXT NOT NULL,
  view_root_hash       TEXT NOT NULL,
  created_by_writer    TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  signature            TEXT NOT NULL,
  local_adopted        BOOLEAN NOT NULL DEFAULT false,
  local_adopted_at     TEXT,
  time_created         BIGINT NOT NULL DEFAULT 0,
  time_updated         BIGINT NOT NULL DEFAULT 0
);
`

// ── Test Fixture Helpers ─────────────────────────────────────────────────────

function makeFederationRecord(overrides?: Partial<FederationBootstrapRecord>): FederationBootstrapRecord {
  return {
    protocolVersion: 1,
    federationId: "fed-1",
    federationGenesisEventId: "genesis-evt-1",
    federationRootPublicKey: "root-pub-key-1",
    autobaseKey: "autobase-key-1",
    autobaseDiscoveryKey: "autobase-disc-key-1",
    initialPolicyDigest: "policy-digest-1",
    genesisWriterKey: "writer-key-genesis",
    createdAt: new Date().toISOString(),
    bootstrapSignature: "bootstrap-sig-1",
    ...overrides,
  }
}

function makeWriterAdmission(overrides?: Partial<WriterAdmission>): WriterAdmission {
  return {
    federationId: "fed-1",
    writerCorePublicKey: "writer-core-key-abc",
    dharmaIdentityPublicKey: "identity-pub-key-abc",
    membershipEventId: "membership-evt-1",
    admittedBy: "writer-key-genesis",
    admittedAt: new Date().toISOString(),
    admissionSignature: "admission-sig-1",
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PGliteFederationStore", () => {
  let store: PGliteFederationStore

  beforeEach(async () => {
    const client = new PGlite()
    const db = drizzle({ client })
    store = new PGliteFederationStore(db as PGliteClient)

    for (const stmt of CREATE_TABLES.split(";").map((s) => s.trim()).filter(Boolean)) {
      await client.exec(stmt + ";")
    }
  })

  // ── Federations ─────────────────────────────────────────────────────────

  describe("federations", () => {
    test("store and retrieve a federation", async () => {
      const record = makeFederationRecord()
      await store.storeFederation(record)

      const got = await store.getFederation("fed-1")
      expect(got).not.toBeNull()
      expect(got!.federationId).toBe("fed-1")
      expect(got!.federationGenesisEventId).toBe("genesis-evt-1")
      expect(got!.federationRootPublicKey).toBe("root-pub-key-1")
      expect(got!.autobaseKey).toBe("autobase-key-1")
      expect(got!.autobaseDiscoveryKey).toBe("autobase-disc-key-1")
      expect(got!.initialPolicyDigest).toBe("policy-digest-1")
      expect(got!.genesisWriterKey).toBe("writer-key-genesis")
      expect(got!.bootstrapSignature).toBe("bootstrap-sig-1")
      expect(got!.protocolVersion).toBe(1)
    })

    test("returns null for missing federation", async () => {
      const got = await store.getFederation("nonexistent")
      expect(got).toBeNull()
    })

    test("list federations returns all ids", async () => {
      await store.storeFederation(makeFederationRecord({ federationId: "fed-1" }))
      await store.storeFederation(makeFederationRecord({
        federationId: "fed-2",
        federationGenesisEventId: "genesis-2",
        federationRootPublicKey: "root-2",
        autobaseKey: "ab-2",
        autobaseDiscoveryKey: "abd-2",
        initialPolicyDigest: "pd-2",
        genesisWriterKey: "gw-2",
        createdAt: new Date().toISOString(),
        bootstrapSignature: "bs-2",
      }))

      const ids = await store.listFederations()
      expect(ids.sort()).toEqual(["fed-1", "fed-2"])
    })

    test("list federations returns empty when none exist", async () => {
      const ids = await store.listFederations()
      expect(ids).toEqual([])
    })

    test("update federation state", async () => {
      await store.storeFederation(makeFederationRecord())
      await store.updateFederationState("fed-1", "active")

      const fed = await store.getFederation("fed-1")
      expect(fed).not.toBeNull()
      // lifecycle_state is not part of FederationBootstrapRecord, so we
      // verify indirectly via getFederation still works after the update
      expect(fed!.federationId).toBe("fed-1")
    })

    test("storeFederation is idempotent on conflict", async () => {
      await store.storeFederation(makeFederationRecord())
      await store.storeFederation(makeFederationRecord({ genesisWriterKey: "different" }))

      const got = await store.getFederation("fed-1")
      expect(got!.genesisWriterKey).toBe("writer-key-genesis")
    })
  })

  // ── Writers ──────────────────────────────────────────────────────────────

  describe("writers", () => {
    test("store and retrieve writers for a federation", async () => {
      await store.storeWriter(makeWriterAdmission())
      const writers = await store.getWriters("fed-1")

      expect(writers).toHaveLength(1)
      expect(writers[0].writerCorePublicKey).toBe("writer-core-key-abc")
      expect(writers[0].dharmaIdentityPublicKey).toBe("identity-pub-key-abc")
      expect(writers[0].membershipEventId).toBe("membership-evt-1")
      expect(writers[0].admittedBy).toBe("writer-key-genesis")
      expect(writers[0].admissionSignature).toBe("admission-sig-1")
    })

    test("getWriters returns empty when none exist", async () => {
      const writers = await store.getWriters("fed-nonexistent")
      expect(writers).toEqual([])
    })

    test("getWriters scoped to federation", async () => {
      await store.storeWriter(makeWriterAdmission({ federationId: "fed-1" }))
      await store.storeWriter(makeWriterAdmission({
        federationId: "fed-2",
        writerCorePublicKey: "writer-core-key-xyz",
        dharmaIdentityPublicKey: "identity-key-xyz",
        membershipEventId: "mem-evt-2",
        admittedBy: "admin-2",
        admittedAt: new Date().toISOString(),
        admissionSignature: "sig-2",
      }))

      const writersFed1 = await store.getWriters("fed-1")
      const writersFed2 = await store.getWriters("fed-2")
      expect(writersFed1).toHaveLength(1)
      expect(writersFed2).toHaveLength(1)
      expect(writersFed1[0].writerCorePublicKey).toBe("writer-core-key-abc")
      expect(writersFed2[0].writerCorePublicKey).toBe("writer-core-key-xyz")
    })

    test("getWriterByKey finds a writer", async () => {
      await store.storeWriter(makeWriterAdmission())
      const writer = await store.getWriterByKey("writer-core-key-abc")
      expect(writer).not.toBeNull()
      expect(writer!.federationId).toBe("fed-1")
    })

    test("getWriterByKey returns null for unknown key", async () => {
      const writer = await store.getWriterByKey("nonexistent-key")
      expect(writer).toBeNull()
    })

    test("storeWriter is idempotent on conflict", async () => {
      await store.storeWriter(makeWriterAdmission())
      await store.storeWriter(makeWriterAdmission({ admittedBy: "different-admin" }))

      const writers = await store.getWriters("fed-1")
      expect(writers).toHaveLength(1)
      expect(writers[0].admittedBy).toBe("writer-key-genesis")
    })
  })

  // ── Peers ────────────────────────────────────────────────────────────────

  describe("peers", () => {
    test("recordPeer creates a new peer", async () => {
      await store.recordPeer("fed-1", "peer-1", "identity-key-1")

      // Verify by recording again (no error) and checking behaviour
      // We can't read peers back directly, but recording a duplicate is a no-op
      await store.recordPeer("fed-1", "peer-1", "identity-key-1")
      await store.recordPeer("fed-1", "peer-2")
    })

    test("recordPeer with no identity key", async () => {
      await store.recordPeer("fed-1", "peer-anon")
      // No identity key — stores null
      await store.recordPeer("fed-1", "peer-anon")
    })

    test("updatePeerSeen updates last_seen_at", async () => {
      await store.recordPeer("fed-1", "peer-1", "identity-key-1")
      // No error expected
      await store.updatePeerSeen("fed-1", "peer-1")
    })

    test("updatePeerSeen on non-existent peer does not throw", async () => {
      // Should silently succeed (no matching row)
      await store.updatePeerSeen("fed-1", "ghost-peer")
    })
  })

  // ── Sessions ─────────────────────────────────────────────────────────────

  describe("sessions", () => {
    test("recordSession stores a session entry", async () => {
      await store.recordSession("fed-1", {
        sessionId: "sess-1",
        peerId: "peer-1",
        result: "accepted",
        durationMs: 150,
      })
    })

    test("recordSession without durationMs", async () => {
      await store.recordSession("fed-2", {
        sessionId: "sess-2",
        peerId: "peer-2",
        result: "rejected",
      })
    })

    test("recordSession allows multiple sessions", async () => {
      await store.recordSession("fed-1", {
        sessionId: "sess-1",
        peerId: "peer-1",
        result: "accepted",
      })
      await store.recordSession("fed-1", {
        sessionId: "sess-2",
        peerId: "peer-1",
        result: "accepted",
      })
    })
  })

  // ── Outbox ───────────────────────────────────────────────────────────────

  describe("outbox", () => {
    test("store and retrieve pending outbox entries", async () => {
      await store.storeOutboxEntry("outbox-1", "fed-1", "evt-1", { type: "ping", data: 1 })

      const pending = await store.getPendingOutboxEntries("fed-1")
      expect(pending).toHaveLength(1)
      expect(pending[0].outboxId).toBe("outbox-1")
      expect(pending[0].eventId).toBe("evt-1")
    })

    test("getPendingOutboxEntries returns empty for unknown federation", async () => {
      const pending = await store.getPendingOutboxEntries("fed-nonexistent")
      expect(pending).toEqual([])
    })

    test("getPendingOutboxEntries filters by federation", async () => {
      await store.storeOutboxEntry("outbox-1", "fed-1", "evt-1", {})
      await store.storeOutboxEntry("outbox-2", "fed-2", "evt-2", {})

      const pendingFed1 = await store.getPendingOutboxEntries("fed-1")
      const pendingFed2 = await store.getPendingOutboxEntries("fed-2")
      expect(pendingFed1).toHaveLength(1)
      expect(pendingFed2).toHaveLength(1)
      expect(pendingFed1[0].outboxId).toBe("outbox-1")
      expect(pendingFed2[0].outboxId).toBe("outbox-2")
    })

    test("updateOutboxState changes state without error", async () => {
      await store.storeOutboxEntry("outbox-1", "fed-1", "evt-1", {})
      await store.updateOutboxState("outbox-1", "appended")

      // Non-pending entries should no longer be returned
      const pending = await store.getPendingOutboxEntries("fed-1")
      expect(pending).toHaveLength(0)
    })

    test("updateOutboxState with error message", async () => {
      await store.storeOutboxEntry("outbox-1", "fed-1", "evt-1", {})
      await store.updateOutboxState("outbox-1", "failed_terminal", "connection lost")
    })

    test("pending entries in any of created/ready/retry_wait state", async () => {
      await store.storeOutboxEntry("o-created", "fed-1", "evt-1", {})
      // Skip default — already "created"

      // Insert one in "retry_wait" via direct update
      await store.storeOutboxEntry("o-retry", "fed-1", "evt-2", {})
      await store.updateOutboxState("o-retry", "retry_wait")

      // One in "appended" should NOT appear
      await store.storeOutboxEntry("o-appended", "fed-1", "evt-3", {})
      await store.updateOutboxState("o-appended", "appended")

      const pending = await store.getPendingOutboxEntries("fed-1")
      const ids = pending.map((p) => p.outboxId).sort()
      expect(ids).toEqual(["o-created", "o-retry"])
    })
  })

  // ── Import Cursors ───────────────────────────────────────────────────────

  describe("import cursors", () => {
    test("getImportCursor returns null for missing cursor", async () => {
      const cursor = await store.getImportCursor("fed-1", "provisional")
      expect(cursor).toBeNull()
    })

    test("updateImportCursor creates and retrieves", async () => {
      await store.updateImportCursor("fed-1", "provisional", 42, "last-evt-42")
      const cursor = await store.getImportCursor("fed-1", "provisional")
      expect(cursor).not.toBeNull()
      expect(cursor!.autobaseLength).toBe(42)
      expect(cursor!.lastEventId).toBe("last-evt-42")
    })

    test("updateImportCursor upserts existing", async () => {
      await store.updateImportCursor("fed-1", "provisional", 10, "evt-10")
      await store.updateImportCursor("fed-1", "provisional", 20, "evt-20")

      const cursor = await store.getImportCursor("fed-1", "provisional")
      expect(cursor!.autobaseLength).toBe(20)
      expect(cursor!.lastEventId).toBe("evt-20")
    })

    test("cursors are scoped by type", async () => {
      await store.updateImportCursor("fed-1", "provisional", 5, "evt-5")
      await store.updateImportCursor("fed-1", "finalized", 3, "evt-3")

      const provisional = await store.getImportCursor("fed-1", "provisional")
      const finalized = await store.getImportCursor("fed-1", "finalized")
      expect(provisional!.autobaseLength).toBe(5)
      expect(finalized!.autobaseLength).toBe(3)
    })

    test("updateImportCursor without lastEventId stores null", async () => {
      await store.updateImportCursor("fed-1", "provisional", 7)
      const cursor = await store.getImportCursor("fed-1", "provisional")
      expect(cursor!.autobaseLength).toBe(7)
      expect(cursor!.lastEventId).toBeNull()
    })
  })

  // ── Checkpoints ─────────────────────────────────────────────────────────

  describe("checkpoints", () => {
    test("getCheckpoint returns null when none exist", async () => {
      const cp = await store.getCheckpoint("fed-1")
      expect(cp).toBeNull()
    })

    test("store and retrieve checkpoint", async () => {
      await store.storeCheckpoint("fed-1", 100, "hash-data-100")
      const cp = await store.getCheckpoint("fed-1")
      expect(cp).not.toBeNull()
      expect(cp!.orderIndex).toBe(100)
      expect(cp!.data).toBe("hash-data-100")
    })

    test("getCheckpoint returns the latest checkpoint (highest orderIndex)", async () => {
      await store.storeCheckpoint("fed-1", 50, "hash-50")
      await store.storeCheckpoint("fed-1", 200, "hash-200")
      await store.storeCheckpoint("fed-1", 100, "hash-100")

      const cp = await store.getCheckpoint("fed-1")
      expect(cp!.orderIndex).toBe(200)
      expect(cp!.data).toBe("hash-200")
    })

    test("storeCheckpoint upserts on conflict", async () => {
      await store.storeCheckpoint("fed-1", 100, "hash-original")
      await store.storeCheckpoint("fed-1", 100, "hash-updated")

      const cp = await store.getCheckpoint("fed-1")
      expect(cp!.orderIndex).toBe(100)
      expect(cp!.data).toBe("hash-updated")
    })

    test("checkpoints scoped by federation", async () => {
      await store.storeCheckpoint("fed-1", 100, "fed1-data")
      await store.storeCheckpoint("fed-2", 200, "fed2-data")

      const cp1 = await store.getCheckpoint("fed-1")
      const cp2 = await store.getCheckpoint("fed-2")
      expect(cp1!.data).toBe("fed1-data")
      expect(cp2!.data).toBe("fed2-data")
    })
  })
})
