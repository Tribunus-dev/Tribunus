/**
 * Dharma Federation Runtime — PGlite-backed Event Persistence
 *
 * Follows the existing @opencode/EventStore pattern.
 * Events and their validation states are stored in separate
 * tables (dharma_raw_events, dharma_event_validation) linked
 * by event_id.
 */

import { Context, Effect, Layer, Option } from "effect"
import { serviceUse } from "@tribunus/core/effect/service-use"
import { DatabaseAdapter } from "../../storage/adapter"
import { eq, and, asc, desc, gte, lte, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import {
  DharmaRawEventTable,
  DharmaEventValidationTable,
} from "./schema.pg.sql"
import type {
  DharmaEventEnvelope,
  EventValidation,
  EventType,
  EventValidationState,
} from "./types"

// ── Query Filters ──────────────────────────────────────────

export interface QueryFilters {
  federationId?: string
  eventType?: string
  actor?: string
  fromTs?: string
  toTs?: string
  limit?: number
  offset?: number
  order?: "asc" | "desc"
}

// ── Interface ──────────────────────────────────────────────

export interface Interface {
  readonly record: (
    event: DharmaEventEnvelope,
    validation?: EventValidation,
  ) => Effect.Effect<void>
  readonly get: (
    eventId: string,
  ) => Effect.Effect<Option.Option<DharmaEventEnvelope>>
  readonly query: (
    filters?: QueryFilters,
  ) => Effect.Effect<DharmaEventEnvelope[], DatabaseAdapter.DatabaseError>
  readonly storeValidation: (validation: EventValidation) => Effect.Effect<void>
  readonly getValidation: (
    eventId: string,
  ) => Effect.Effect<Option.Option<EventValidation>>
  readonly countByStatus: (
    federationId: string,
  ) => Effect.Effect<{ validationState: string; count: number }[]>
}

// ── Service tag ────────────────────────────────────────────

export class Service extends Context.Service<Service, Interface>()(
  "@tribunus/DharmaEventStore",
) {}

export const use = serviceUse(Service)

// ── DB encoding / decoding helpers ─────────────────────────

export function encodeForDb(
  event: DharmaEventEnvelope,
): Record<string, unknown> {
  return {
    event_id: event.eventId,
    federation_id: event.federationId,
    event_type: event.eventType,
    schema_version: event.schemaVersion,
    actor_public_key: event.actorPublicKey,
    actor_device_id: event.actorDeviceId ?? null,
    created_at: event.createdAt,
    logical_clock: event.logicalClock,
    causal_parents: event.causalParents,
    payload_hash: event.payloadHash,
    payload: event.payload,
    signature: event.signature,
  }
}

export function decodeFromDb(
  row: Record<string, unknown>,
): DharmaEventEnvelope {
  return {
    eventId: row.event_id as string,
    federationId: row.federation_id as string,
    eventType: row.event_type as EventType,
    schemaVersion: row.schema_version as number,
    actorPublicKey: row.actor_public_key as string,
    actorDeviceId: (row.actor_device_id as string) ?? null,
    createdAt: row.created_at as string,
    logicalClock: row.logical_clock as number,
    causalParents: row.causal_parents as string[],
    payloadHash: row.payload_hash as string,
    payload: row.payload as Record<string, unknown>,
    signature: row.signature as string,
  }
}

export function encodeValidationForDb(
  validation: EventValidation,
): Record<string, unknown> {
  return {
    validation_id: validation.eventId,
    event_id: validation.eventId,
    validation_state: validation.validationState,
    validation_reason: validation.validationReason ?? null,
    validated_at: validation.validatedAt,
    policy_digest: validation.policyDigest ?? null,
    validator_version: validation.validatorVersion,
  }
}

export function decodeValidationFromDb(
  row: Record<string, unknown>,
): EventValidation {
  return {
    eventId: row.event_id as string,
    validationState: row.validation_state as EventValidationState,
    validationReason: (row.validation_reason as string) ?? null,
    validatedAt: row.validated_at as string,
    policyDigest: (row.policy_digest as string) ?? null,
    validatorVersion: row.validator_version as number,
  }
}

// ── WHERE builder ─────────────────────────────────────────

type WhereCondition = SQL | undefined

export function buildWhere(filters: QueryFilters): WhereCondition {
  const conditions: SQL[] = []

  if (filters.federationId)
    conditions.push(eq(DharmaRawEventTable.federation_id, filters.federationId))
  if (filters.eventType)
    conditions.push(eq(DharmaRawEventTable.event_type, filters.eventType))
  if (filters.actor)
    conditions.push(
      eq(DharmaRawEventTable.actor_public_key, filters.actor),
    )
  if (filters.fromTs)
    conditions.push(gte(DharmaRawEventTable.created_at, filters.fromTs))
  if (filters.toTs)
    conditions.push(lte(DharmaRawEventTable.created_at, filters.toTs))

  return conditions.length > 0 ? and(...conditions) : undefined
}

// ── Layer ─────────────────────────────────────────────────

export const layer: Layer.Layer<Service, never, DatabaseAdapter.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const adapter = yield* DatabaseAdapter.Service

      const record = Effect.fn("DharmaEventStore.record")(
        function* (
          event: DharmaEventEnvelope,
          validation?: EventValidation,
        ) {
          const encoded = encodeForDb(event)
          yield* adapter.query((db) =>
            db
              .insert(DharmaRawEventTable)
              .values(encoded)
              .onConflictDoNothing()
              .execute(),
          )
          if (validation) {
            const valEncoded = encodeValidationForDb(validation)
            yield* adapter.query((db) =>
              db
                .insert(DharmaEventValidationTable)
                .values(valEncoded)
                .onConflictDoNothing()
                .execute(),
            )
          }
        },
      )

      const get = Effect.fn("DharmaEventStore.get")(
        function* (eventId: string) {
          const rows = yield* adapter.query((db) =>
            (db
              .select()
              .from(DharmaRawEventTable)
              .where(eq(DharmaRawEventTable.event_id, eventId))
              .limit(1)
              .execute()) as Promise<Record<string, unknown>[]>,
          )
          return rows.length > 0
            ? Option.some(decodeFromDb(rows[0]))
            : Option.none()
        },
      )

      const query = Effect.fn("DharmaEventStore.query")(
        function* (filters?: QueryFilters) {
          const where = filters ? buildWhere(filters) : undefined
          const orderFn = filters?.order === "asc" ? asc : desc
          const limit = filters?.limit ?? 100
          const offset = filters?.offset ?? 0

          const rows = yield* adapter.query((db) => {
            let q = db.select().from(DharmaRawEventTable)
            if (where) q = q.where(where)
            q = q.orderBy(orderFn(DharmaRawEventTable.created_at))
            q = q.limit(limit).offset(offset)
            return q.execute() as Promise<Record<string, unknown>[]>
          })

          return rows.map(decodeFromDb)
        },
      )

      const storeValidation = Effect.fn("DharmaEventStore.storeValidation")(
        function* (validation: EventValidation) {
          const encoded = encodeValidationForDb(validation)
          yield* adapter.query((db) =>
            db
              .insert(DharmaEventValidationTable)
              .values(encoded)
              .onConflictDoNothing()
              .execute(),
          )
        },
      )

      const getValidation = Effect.fn("DharmaEventStore.getValidation")(
        function* (eventId: string) {
          const rows = yield* adapter.query((db) =>
            (db
              .select()
              .from(DharmaEventValidationTable)
              .where(eq(DharmaEventValidationTable.event_id, eventId))
              .limit(1)
              .execute()) as Promise<Record<string, unknown>[]>,
          )
          return rows.length > 0
            ? Option.some(decodeValidationFromDb(rows[0]))
            : Option.none()
        },
      )

      const countByStatus = Effect.fn("DharmaEventStore.countByStatus")(
        function* (federationId: string) {
          const rows = yield* adapter.query((db) =>
            (db
              .select({
                validationState: DharmaEventValidationTable.validation_state,
                count: sql<number>`count(*)`,
              })
              .from(DharmaEventValidationTable)
              .innerJoin(
                DharmaRawEventTable,
                eq(
                  DharmaRawEventTable.event_id,
                  DharmaEventValidationTable.event_id,
                ),
              )
              .where(
                eq(DharmaRawEventTable.federation_id, federationId),
              )
              .groupBy(DharmaEventValidationTable.validation_state)
              .execute()) as Promise<
              { validationState: string; count: number }[]
            >,
          )
          return rows
        },
      )

      return Service.of({
        record,
        get,
        query,
        storeValidation,
        getValidation,
        countByStatus,
      } as Interface)
    }),
  )
