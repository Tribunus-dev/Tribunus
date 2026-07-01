/**
 * Dharma Federation Runtime — Audit Log Service
 *
 * Records and queries audit events for the Dharma subsystem.
 * Supports housekeeping via prune() to remove stale entries.
 */

import { Context, Effect, Layer } from "effect"
import { serviceUse } from "@tribunus/core/effect/service-use"
import { DatabaseAdapter } from "../../storage/adapter"
import { eq, and, gte, lte, sql, lt } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { DharmaAuditLogTable } from "./schema.pg.sql"
import type { AuditEvent, AuditEventType } from "./types"
import { randomUUID } from "node:crypto"

// ── Query Filters ──────────────────────────────────────────

export interface AuditQueryFilters {
  eventType?: string
  federationId?: string
  fromTs?: string
  toTs?: string
  limit?: number
  offset?: number
}

// ── Interface ──────────────────────────────────────────────

export interface Interface {
  readonly record: (
    event: Omit<AuditEvent, "auditId">,
  ) => Effect.Effect<AuditEvent>
  readonly query: (
    filters?: AuditQueryFilters,
  ) => Effect.Effect<AuditEvent[], DatabaseAdapter.DatabaseError>
  readonly countByType: () => Effect.Effect<
    { eventType: string; count: number }[]
  >
  readonly prune: (beforeTs: string) => Effect.Effect<void>
}

// ── Service tag ────────────────────────────────────────────

export class Service extends Context.Service<Service, Interface>()(
  "@tribunus/DharmaAuditLog",
) {}

export const use = serviceUse(Service)

// ── DB encoding / decoding helpers ─────────────────────────

export function encodeForDb(
  event: AuditEvent,
): Record<string, unknown> {
  return {
    audit_id: event.auditId,
    event_type: event.eventType,
    federation_id: event.federationId ?? null,
    identity_id: event.identityId ?? null,
    target_hash: event.targetHash ?? null,
    metadata: event.metadata ?? null,
    occurred_at: event.occurredAt,
  }
}

export function decodeFromDb(
  row: Record<string, unknown>,
): AuditEvent {
  return {
    auditId: row.audit_id as string,
    eventType: row.event_type as AuditEventType,
    federationId: (row.federation_id as string) ?? null,
    identityId: (row.identity_id as string) ?? null,
    targetHash: (row.target_hash as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    occurredAt: row.occurred_at as string,
  }
}

// ── WHERE builder ─────────────────────────────────────────

type WhereCondition = SQL | undefined

export function buildWhere(
  filters: AuditQueryFilters,
): WhereCondition {
  const conditions: SQL[] = []

  if (filters.eventType)
    conditions.push(eq(DharmaAuditLogTable.event_type, filters.eventType))
  if (filters.federationId)
    conditions.push(
      eq(DharmaAuditLogTable.federation_id, filters.federationId),
    )
  if (filters.fromTs)
    conditions.push(gte(DharmaAuditLogTable.occurred_at, filters.fromTs))
  if (filters.toTs)
    conditions.push(lte(DharmaAuditLogTable.occurred_at, filters.toTs))

  return conditions.length > 0 ? and(...conditions) : undefined
}

// ── Layer ─────────────────────────────────────────────────

export const layer: Layer.Layer<Service, never, DatabaseAdapter.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const adapter = yield* DatabaseAdapter.Service

      const record = Effect.fn("DharmaAuditLog.record")(
        function* (input: Omit<AuditEvent, "auditId">) {
          const event: AuditEvent = {
            ...input,
            auditId: randomUUID(),
          }
          const encoded = encodeForDb(event)
          yield* adapter.query((db) =>
            db.insert(DharmaAuditLogTable).values(encoded).execute(),
          )
          return event
        },
      )

      const query = Effect.fn("DharmaAuditLog.query")(
        function* (filters?: AuditQueryFilters) {
          const where = filters ? buildWhere(filters) : undefined
          const limit = filters?.limit ?? 100
          const offset = filters?.offset ?? 0

          const rows = yield* adapter.query((db) => {
            let q = db
              .select()
              .from(DharmaAuditLogTable)
              .orderBy(sql`${DharmaAuditLogTable.occurred_at} desc`)
            if (where) q = q.where(where)
            q = q.limit(limit).offset(offset)
            return q.execute() as Promise<Record<string, unknown>[]>
          })

          return rows.map(decodeFromDb)
        },
      )

      const countByType = Effect.fn("DharmaAuditLog.countByType")(
        function* () {
          const rows = yield* adapter.query((db) =>
            (db
              .select({
                eventType: DharmaAuditLogTable.event_type,
                count: sql<number>`count(*)`,
              })
              .from(DharmaAuditLogTable)
              .groupBy(DharmaAuditLogTable.event_type)
              .execute()) as Promise<{ eventType: string; count: number }[]>,
          )
          return rows
        },
      )

      const prune = Effect.fn("DharmaAuditLog.prune")(
        function* (beforeTs: string) {
          yield* adapter.query((db) =>
            db
              .delete(DharmaAuditLogTable)
              .where(lt(DharmaAuditLogTable.occurred_at, beforeTs))
              .execute(),
          )
        },
      )

      return Service.of({
        record,
        query,
        countByType,
        prune,
      } as Interface)
    }),
  )
