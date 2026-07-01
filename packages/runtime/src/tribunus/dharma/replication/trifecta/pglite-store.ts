/**
 * Dharma Replication — PGlite Federation Store
 *
 * Durable storage adapter backed by PGlite using drizzle-orm over the
 * existing Dharma replication schema tables.  Handles federation metadata,
 * writers, peers, sessions, outbox entries, import cursors, and checkpoints.
 *
 * All methods are thin wrappers around drizzle-orm insert/select/update.
 */

import { eq, and, desc, sql } from "drizzle-orm"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import type { PgClient } from "../../../../storage/db.pg"
import {
  DharmaReplicationFederationTable,
  DharmaReplicationWriterTable,
  DharmaReplicationPeerTable,
  DharmaReplicationSessionTable,
  DharmaReplicationOutboxTable,
  DharmaReplicationImportCursorTable,
  DharmaReplicationCheckpointTable,
} from "../schema.pg.sql"
import type { FederationBootstrapRecord, WriterAdmission } from "../protocol"

/** Convenience alias for the PGlite variant of PgClient. */
export type PGliteClient = Extract<PgClient, PgliteDatabase>

// ── PGliteFederationStore ────────────────────────────────────────────────────

export class PGliteFederationStore {
  constructor(private db: PGliteClient) {}

  // ── Federations ──────────────────────────────────────────────────────────

  async storeFederation(record: FederationBootstrapRecord): Promise<void> {
    await this.db.insert(DharmaReplicationFederationTable).values({
      federation_id: record.federationId,
      genesis_event_id: record.federationGenesisEventId,
      federation_root_public_key: record.federationRootPublicKey,
      autobase_key: record.autobaseKey,
      autobase_discovery_key: record.autobaseDiscoveryKey,
      initial_policy_digest: record.initialPolicyDigest,
      genesis_writer_key: record.genesisWriterKey,
      bootstrap_signature: record.bootstrapSignature,
      lifecycle_state: "unaware",
      protocol_version: record.protocolVersion,
      created_at: record.createdAt,
      last_state_change_at: record.createdAt,
    }).onConflictDoNothing({ target: DharmaReplicationFederationTable.federation_id })
  }

  async getFederation(federationId: string): Promise<FederationBootstrapRecord | null> {
    const rows = await this.db
      .select()
      .from(DharmaReplicationFederationTable)
      .where(eq(DharmaReplicationFederationTable.federation_id, federationId))
      .limit(1)

    const row = rows[0]
    if (!row) return null

    return {
      protocolVersion: row.protocol_version,
      federationId: row.federation_id,
      federationGenesisEventId: row.genesis_event_id,
      federationRootPublicKey: row.federation_root_public_key,
      autobaseKey: row.autobase_key,
      autobaseDiscoveryKey: row.autobase_discovery_key,
      initialPolicyDigest: row.initial_policy_digest,
      genesisWriterKey: row.genesis_writer_key,
      createdAt: row.created_at,
      bootstrapSignature: row.bootstrap_signature,
    }
  }

  async listFederations(): Promise<string[]> {
    const rows = await this.db
      .select({ id: DharmaReplicationFederationTable.federation_id })
      .from(DharmaReplicationFederationTable)

    return rows.map((r) => r.id)
  }

  async updateFederationState(federationId: string, state: string): Promise<void> {
    await this.db
      .update(DharmaReplicationFederationTable)
      .set({
        lifecycle_state: state,
        last_state_change_at: new Date().toISOString(),
      })
      .where(eq(DharmaReplicationFederationTable.federation_id, federationId))
  }

  // ── Writers ──────────────────────────────────────────────────────────────

  async storeWriter(admission: WriterAdmission): Promise<void> {
    await this.db.insert(DharmaReplicationWriterTable).values({
      writer_id: `${admission.federationId}:${admission.writerCorePublicKey}`,
      federation_id: admission.federationId,
      writer_core_public_key: admission.writerCorePublicKey,
      dharma_identity_public_key: admission.dharmaIdentityPublicKey,
      membership_event_id: admission.membershipEventId,
      admitted_by: admission.admittedBy,
      admitted_at: admission.admittedAt,
      admission_signature: admission.admissionSignature,
      status: "active",
    }).onConflictDoNothing({ target: DharmaReplicationWriterTable.writer_id })
  }

  async getWriters(federationId: string): Promise<WriterAdmission[]> {
    const rows = await this.db
      .select()
      .from(DharmaReplicationWriterTable)
      .where(eq(DharmaReplicationWriterTable.federation_id, federationId))

    return rows.map((row) => ({
      federationId: row.federation_id,
      writerCorePublicKey: row.writer_core_public_key,
      dharmaIdentityPublicKey: row.dharma_identity_public_key,
      membershipEventId: row.membership_event_id ?? "",
      admittedBy: row.admitted_by ?? "",
      admittedAt: row.admitted_at,
      admissionSignature: row.admission_signature ?? "",
    }))
  }

  async getWriterByKey(writerKey: string): Promise<WriterAdmission | null> {
    const rows = await this.db
      .select()
      .from(DharmaReplicationWriterTable)
      .where(eq(DharmaReplicationWriterTable.writer_core_public_key, writerKey))
      .limit(1)

    const row = rows[0]
    if (!row) return null

    return {
      federationId: row.federation_id,
      writerCorePublicKey: row.writer_core_public_key,
      dharmaIdentityPublicKey: row.dharma_identity_public_key,
      membershipEventId: row.membership_event_id ?? "",
      admittedBy: row.admitted_by ?? "",
      admittedAt: row.admitted_at,
      admissionSignature: row.admission_signature ?? "",
    }
  }

  // ── Peers ────────────────────────────────────────────────────────────────

  async recordPeer(federationId: string, peerId: string, identityKey?: string): Promise<void> {
    await this.db.insert(DharmaReplicationPeerTable).values({
      peer_id: peerId,
      federation_id: federationId,
      identity_public_key: identityKey ?? null,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      status: "discovered",
    }).onConflictDoNothing({ target: DharmaReplicationPeerTable.peer_id })
  }

  async updatePeerSeen(federationId: string, peerId: string): Promise<void> {
    await this.db
      .update(DharmaReplicationPeerTable)
      .set({
        last_seen_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(DharmaReplicationPeerTable.peer_id, peerId),
          eq(DharmaReplicationPeerTable.federation_id, federationId),
        ),
      )
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  async recordSession(
    federationId: string,
    session: { sessionId: string; peerId: string; result: string; durationMs?: number },
  ): Promise<void> {
    await this.db.insert(DharmaReplicationSessionTable).values({
      session_id: session.sessionId,
      federation_id: federationId,
      peer_id: session.peerId,
      protocol_version: 1,
      handshake_result: session.result,
      handshake_duration_ms: session.durationMs ?? null,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    })
  }

  // ── Outbox ───────────────────────────────────────────────────────────────

  async storeOutboxEntry(
    outboxId: string,
    federationId: string,
    eventId: string,
    envelope: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(DharmaReplicationOutboxTable).values({
      outbox_id: outboxId,
      federation_id: federationId,
      event_id: eventId,
      event_envelope: envelope,
      state: "created",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  async getPendingOutboxEntries(
    federationId: string,
  ): Promise<{ outboxId: string; eventId: string }[]> {
    const rows = await this.db
      .select({
        outbox_id: DharmaReplicationOutboxTable.outbox_id,
        event_id: DharmaReplicationOutboxTable.event_id,
      })
      .from(DharmaReplicationOutboxTable)
      .where(
        and(
          eq(DharmaReplicationOutboxTable.federation_id, federationId),
          sql`${DharmaReplicationOutboxTable.state} IN ('created', 'ready', 'retry_wait')`,
        ),
      )
      .orderBy(desc(DharmaReplicationOutboxTable.created_at))

    return rows.map((r) => ({ outboxId: r.outbox_id, eventId: r.event_id }))
  }

  async updateOutboxState(outboxId: string, state: string, error?: string): Promise<void> {
    const update: Record<string, unknown> = {
      state,
      updated_at: new Date().toISOString(),
    }
    if (error !== undefined) {
      update.last_error = error
    }
    await this.db
      .update(DharmaReplicationOutboxTable)
      .set(update)
      .where(eq(DharmaReplicationOutboxTable.outbox_id, outboxId))
  }

  // ── Import Cursors ───────────────────────────────────────────────────────

  async getImportCursor(
    federationId: string,
    cursorType: string,
  ): Promise<{ autobaseLength: number; lastEventId: string | null } | null> {
    const rows = await this.db
      .select()
      .from(DharmaReplicationImportCursorTable)
      .where(
        and(
          eq(DharmaReplicationImportCursorTable.federation_id, federationId),
          eq(DharmaReplicationImportCursorTable.cursor_type, cursorType),
        ),
      )
      .limit(1)

    const row = rows[0]
    if (!row) return null

    return {
      autobaseLength: row.autobase_length,
      lastEventId: row.last_event_id ?? null,
    }
  }

  async updateImportCursor(
    federationId: string,
    cursorType: string,
    autobaseLength: number,
    lastEventId?: string,
  ): Promise<void> {
    const cursorId = `${federationId}:${cursorType}`

    await this.db
      .insert(DharmaReplicationImportCursorTable)
      .values({
        cursor_id: cursorId,
        federation_id: federationId,
        cursor_type: cursorType,
        autobase_length: autobaseLength,
        last_event_id: lastEventId ?? null,
        updated_at: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: DharmaReplicationImportCursorTable.cursor_id,
        set: {
          autobase_length: autobaseLength,
          last_event_id: lastEventId ?? null,
          updated_at: new Date().toISOString(),
        },
      })
  }

  // ── Checkpoints ──────────────────────────────────────────────────────────

  async storeCheckpoint(federationId: string, orderIndex: number, data: string): Promise<void> {
    const checkpointId = `${federationId}:${orderIndex}`
    const now = new Date().toISOString()

    await this.db
      .insert(DharmaReplicationCheckpointTable)
      .values({
        checkpoint_id: checkpointId,
        federation_id: federationId,
        autobase_signed_length: orderIndex,
        autobase_hash: data,
        view_root_hash: data,
        created_by_writer: "system",
        created_at: now,
        signature: "",
        local_adopted: true,
        local_adopted_at: now,
      })
      .onConflictDoUpdate({
        target: DharmaReplicationCheckpointTable.checkpoint_id,
        set: {
          autobase_signed_length: orderIndex,
          autobase_hash: data,
          view_root_hash: data,
          local_adopted: true,
          local_adopted_at: now,
        },
      })
  }

  async getCheckpoint(
    federationId: string,
  ): Promise<{ orderIndex: number; data: string } | null> {
    const rows = await this.db
      .select()
      .from(DharmaReplicationCheckpointTable)
      .where(eq(DharmaReplicationCheckpointTable.federation_id, federationId))
      .orderBy(desc(DharmaReplicationCheckpointTable.autobase_signed_length))
      .limit(1)

    const row = rows[0]
    if (!row) return null

    return {
      orderIndex: row.autobase_signed_length,
      data: row.autobase_hash,
    }
  }
}
