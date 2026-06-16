/**
 * Coordination Recovery
 *
 * Recovery protocols for the Valkey Stream-Backed Coordination Kernel.
 *
 * Doctrine:
 * - PGlite is the authority
 * - Valkey is reconstructable coordination state
 * - Recovery starts from PGlite, not from Valkey
 * - Rebuild must be idempotent
 *
 * The recovery module:
 * 1. Reconciles PGlite authoritative facts with Valkey pending state
 * 2. Rebuilds Valkey coordination state from PGlite after wipe
 * 3. Handles crash recovery at every critical boundary
 */

import { Context, Effect, Layer } from "effect"
import type { Redis } from "ioredis"
import { DatabaseAdapter } from "@/storage/adapter"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { Service as SessionStatusService } from "@/session/status"
import type { DivergenceReport } from "./observability"
import { WorkQueueDurableStoreService } from "./durable-store"
import { CoordinationRecoveryTable } from "./recovery.pg.sql"
import { DEFAULT_DUE_SET_NAME, ValkeySortedSets } from "./sorted-set-primitives"
import { DEFAULT_CONSUMER_GROUP, DEFAULT_STREAM_NAME, ValkeyStreams } from "./stream-primitives"
import { ValkeyRedisService, createValkeyFabric, ValkeyRedisLayer } from "./valkey-fabric"
import type { RecoveryAction } from "./work-queue.pg.sql"

// ── Types ──────────────────────────────────────────────────────────────

/** Recovery state */
export type CoordinationRecoveryState =
  | "ready"
  | "coordination_unavailable"
  | "coordination_degraded"
  | "coordination_rebuilding"
  | "coordination_refused"

/** Recovery workflow status — separate from steady runtime state */
export type RecoveryWorkflowStatus = "not_started" | "planned" | "in_progress" | "succeeded" | "failed"

/** Recovery outcome */
export type RecoveryOutcome = "success" | "partial" | "failed"

/** Recovery receipt */
export interface RecoveryReceipt {
  id: string
  workId: string
  streamEntryId?: string
  action: RecoveryAction
  recoveredBy: string
  originalConsumer?: string
  recoveredAt: number
  idleDurationMs?: number
  outcome: RecoveryOutcome
  reason?: string
}

/** Recovery plan */
export interface RecoveryPlan {
  /** Whether recovery is needed */
  needsRecovery: boolean
  /** Current recovery state */
  state: CoordinationRecoveryState
  /** Work items to re-enqueue */
  workToReEnqueue: string[]
  /** Work items to restore to sorted sets */
  workToReschedule: string[]
  /** Work items that are terminal (should not be re-enqueued) */
  terminalWork: string[]
  /** Receipt for this recovery plan */
  receipt?: RecoveryReceipt
}

/** Recovery configuration */
export interface RecoveryConfig {
  streamName: string
  consumerGroup: string
  dueSetName: string
  pendingIdleThresholdMs: number
  maxRecoveryBatchSize: number
}

/** Default recovery configuration */
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  streamName: DEFAULT_STREAM_NAME,
  consumerGroup: DEFAULT_CONSUMER_GROUP,
  dueSetName: DEFAULT_DUE_SET_NAME,
  pendingIdleThresholdMs: 5 * 60 * 1000, // 5 minutes
  maxRecoveryBatchSize: 100,
}

/** Structured result of a coordination recovery operation */
export interface CoordinationRecoveryResult {
  status: RecoveryWorkflowStatus
  outcome: RecoveryOutcome
  state: CoordinationRecoveryState
  receipt?: RecoveryReceipt
  inspectedCount: number
  rebuiltCount: number
  skippedCount: number
  failedCount: number
  repairedStreams: string[]
  repairedSortedSets: string[]
  errors: string[]
}

// ── Recovery Service ───────────────────────────────────────────────────

/**
 * CoordinationRecovery provides recovery protocols for the coordination kernel.
 *
 * This service:
 * - Reconciles PGlite facts with Valkey pending state
 * - Rebuilds Valkey state from PGlite after wipe
 * - Handles crash recovery at every critical boundary
 */
export interface CoordinationRecoveryService {
  readonly config: RecoveryConfig
  readonly planRecovery: () => Effect.Effect<RecoveryPlan>
  readonly executeRecovery: (plan: RecoveryPlan) => Effect.Effect<CoordinationRecoveryResult>
  readonly recover: () => Effect.Effect<CoordinationRecoveryResult>
  readonly rebuildFromPGlite: () => Effect.Effect<CoordinationRecoveryResult>
  readonly coldStartRebuildIfNeeded: () => Effect.Effect<CoordinationRecoveryResult | null>
  readonly setRecoveryState: (state: CoordinationRecoveryState) => Effect.Effect<void>
  readonly getRecoveryState: () => Effect.Effect<CoordinationRecoveryState>
  readonly getLastDivergenceReport: () => DivergenceReport | null
  readonly persistRecoveryReceipt: (receipt: RecoveryReceipt) => Effect.Effect<void>
  readonly detectDivergence: () => Effect.Effect<DivergenceReport>
}

export class CoordinationRecovery extends Context.Service<CoordinationRecovery, CoordinationRecoveryService>()("@tribunus/CoordinationRecovery") {}

export const recoveryLayer = Layer.effect(CoordinationRecovery, Effect.gen(function* () {
    const sql = yield* DatabaseAdapter.Service
    const store = yield* WorkQueueDurableStoreService
    const redisService = yield* ValkeyRedisService
    const redis = redisService.client

    let lastDivergenceReport: DivergenceReport | null = null
    const config = DEFAULT_RECOVERY_CONFIG

    const detectDivergence = (): Effect.Effect<DivergenceReport, never, never> =>
      Effect.gen(function* () {
        const detectedAt = Date.now()
        const streams = new ValkeyStreams(redis, config.streamName)

        let pgliteWorkIds: string[] = []
        try {
          const workItems = yield* store.listNonTerminalWorkByStream(config.streamName)
          pgliteWorkIds = workItems.map((w) => w.id)
        } catch {
          pgliteWorkIds = []
        }

        const pelWorkIds: string[] = []
        let pelEntryIds: string[] = []
        try {
          const pending = yield* Effect.promise(() => streams.getPendingEntries(config.consumerGroup))
          pelEntryIds = pending.map((e) => e.id)

          if (pending.length > 0) {
            const entryIds = pending.map((e) => e.id)
            const batchSize = 50
            for (let i = 0; i < entryIds.length; i += batchSize) {
              const batch = entryIds.slice(i, i + batchSize)
              const entries = yield* Effect.promise(() => streams.readRange(batch[0], batch[batch.length - 1]))
              for (const entry of entries) {
                const workId = entry.values?.workId
                if (typeof workId === "string") {
                  pelWorkIds.push(workId)
                }
              }
            }
          }
        } catch {
          return {
            lost_durability: [],
            orphaned_work: pgliteWorkIds,
            pglite_count: pgliteWorkIds.length,
            valkey_pel_count: 0,
            detectedAt,
          }
        }

        const pgliteSet = new Set(pgliteWorkIds)
        const pelSet = new Set(pelWorkIds)

        const lost_durability = [...new Set(pelWorkIds.filter((id) => !pgliteSet.has(id)))]
        const orphaned_work = [...new Set(pgliteWorkIds.filter((id) => !pelSet.has(id)))]

        return {
          lost_durability,
          orphaned_work,
          pglite_count: pgliteWorkIds.length,
          valkey_pel_count: pelEntryIds.length,
          detectedAt,
        }
      }).pipe(Effect.orDie)

    const setRecoveryState = (state: CoordinationRecoveryState): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        yield* sql.query(async (db) => {
          await db
            .insert(CoordinationRecoveryTable)
            .values({
              id: "current",
              session_id: "recovery" as SessionID,
              project_id: ProjectID.make("recovery"),
              old_generation: 0,
              new_generation: 0,
              state,
              outcome: "success",
              reasons: [],
              unsafe_work: false,
              durable_receipt: false,
            })
            .onConflictDoUpdate({
              target: CoordinationRecoveryTable.id,
              set: { state },
            })
            .execute()
        })
        lastDivergenceReport = yield* detectDivergence()
      }).pipe(Effect.orDie)

    const persistRecoveryReceipt = (receipt: RecoveryReceipt): Effect.Effect<void, never, never> =>
      store
        .recordRecoveryReceipt({
          workId: receipt.workId,
          streamEntryId: receipt.streamEntryId,
          action: receipt.action,
          recoveredByConsumer: receipt.recoveredBy,
          originalConsumer: receipt.originalConsumer,
          recoveredAt: receipt.recoveredAt,
          idleDurationMs: receipt.idleDurationMs,
          outcome: receipt.outcome,
          outcomeReason: receipt.reason,
          streamName: config.streamName,
          consumerGroup: config.consumerGroup,
        })
        .pipe(Effect.asVoid, Effect.orDie)

    const planRecovery = (): Effect.Effect<RecoveryPlan, never, never> =>
      Effect.gen(function* () {
        const now = Date.now()
        const reasons: string[] = []

        const pingResult = yield* Effect.tryPromise({
          try: () => redis.ping(),
          catch: () => "redis_unavailable",
        })

        if (pingResult !== "PONG") {
          return {
            needsRecovery: true,
            state: "coordination_unavailable" as const,
            workToReEnqueue: [],
            workToReschedule: [],
            terminalWork: [],
          }
        }

        const streams = new ValkeyStreams(redis, config.streamName)
        const streamExists = yield* Effect.promise(() => streams.streamExists())
        const groupInfo = yield* Effect.promise(() => streams.getGroupInfo(config.consumerGroup))

        if (!streamExists || groupInfo === null) {
          reasons.push("coordination_state_lost")
          return {
            needsRecovery: true,
            state: "coordination_rebuilding" as const,
            workToReEnqueue: [],
            workToReschedule: [],
            terminalWork: [],
          }
        }

        const divergence = yield* detectDivergence()
        const workToReEnqueue = divergence.orphaned_work
        const terminalWork = divergence.lost_durability

        const scheduledWork = yield* store.listScheduledWork(now + 86_400_000).pipe(Effect.orDie)
        const workToReschedule = scheduledWork.map((s) => s.work_id)

        let state: CoordinationRecoveryState = "ready"
        if (workToReEnqueue.length > 0 || workToReschedule.length > 0) {
          state = "coordination_degraded"
          reasons.push("divergence_detected")
        }

        if (terminalWork.length > 0) {
          reasons.push("lost_durability_detected")
          state = "coordination_refused"
        }

        return {
          needsRecovery: state !== "ready",
          state,
          workToReEnqueue,
          workToReschedule,
          terminalWork,
        }
      }).pipe(Effect.orDie)

    const executeRecovery = (plan: RecoveryPlan): Effect.Effect<CoordinationRecoveryResult, never, never> =>
      Effect.gen(function* () {
        const startTime = Date.now()
        const result: CoordinationRecoveryResult = {
          status: "in_progress",
          outcome: "success",
          state: "coordination_rebuilding",
          inspectedCount: plan.workToReEnqueue.length + plan.workToReschedule.length + plan.terminalWork.length,
          rebuiltCount: 0,
          skippedCount: 0,
          failedCount: 0,
          repairedStreams: [],
          repairedSortedSets: [],
          errors: [],
        }

        try {
          yield* setRecoveryState("coordination_rebuilding")
          const streams = new ValkeyStreams(redis, config.streamName)
          const sortedSets = new ValkeySortedSets(redis)

          yield* Effect.promise(() => streams.ensureGroup(config.consumerGroup))

          for (const workId of plan.workToReEnqueue) {
            try {
              const workItem = yield* store.getWorkItem(workId)
              if (workItem) {
                yield* Effect.promise(() =>
                  streams.addEntry({
                    workId: workItem.id,
                    workKind: workItem.work_kind ?? "recovered",
                    schemaVersion: workItem.schema_version ?? "v1",
                    enqueueTimestamp: String(startTime),
                    correlationId: `recovered:${workItem.id}`,
                    retryCount: String(workItem.attempt_count),
                    maxRetries: String(workItem.max_attempts),
                  }),
                )
                result.rebuiltCount++
                if (!result.repairedStreams.includes(config.streamName)) {
                  result.repairedStreams.push(config.streamName)
                }
              } else {
                result.skippedCount++
              }
            } catch (error) {
              result.failedCount++
              result.errors.push(
                `Failed to re-enqueue ${workId}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }

          for (const workId of plan.workToReschedule) {
            try {
              const workItem = yield* store.getWorkItem(workId)
              if (workItem) {
                const dueAt = workItem.completed_at ? workItem.completed_at + 60_000 : workItem.created_at + 60_000
                yield* Effect.promise(() => sortedSets.add(config.dueSetName, dueAt, workId))
                result.rebuiltCount++
                if (!result.repairedSortedSets.includes(config.dueSetName)) {
                  result.repairedSortedSets.push(config.dueSetName)
                }
              } else {
                result.skippedCount++
              }
            } catch (error) {
              result.failedCount++
              result.errors.push(
                `Failed to reschedule ${workId}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }

          result.state = plan.state === "coordination_refused" ? "coordination_refused" : "ready"
          result.status = "succeeded"
          result.outcome = result.failedCount > 0 ? "partial" : "success"

          const receipt: RecoveryReceipt = {
            id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            workId: "recovery-batch",
            action: "rebuild",
            recoveredBy: "recovery-worker",
            recoveredAt: startTime,
            outcome: result.outcome,
            reason: `Processed ${result.inspectedCount} items: ${result.rebuiltCount} rebuilt, ${result.failedCount} failed.`,
          }
          result.receipt = receipt
          yield* persistRecoveryReceipt(receipt)
          yield* setRecoveryState(result.state)
        } catch (error) {
          result.status = "failed"
          result.outcome = "failed"
          result.errors.push(`Recovery execution failed: ${error instanceof Error ? error.message : String(error)}`)
          yield* setRecoveryState("coordination_unavailable")
        }

        return result
      }).pipe(Effect.orDie)

    const recover = () =>
      Effect.gen(function* () {
        const plan = yield* planRecovery()
        return yield* executeRecovery(plan)
      })

    return {
      config,
      planRecovery,
      executeRecovery,
      recover,
      rebuildFromPGlite: recover,
      coldStartRebuildIfNeeded: () =>
        Effect.gen(function* () {
          const pingResult = yield* Effect.tryPromise({
            try: () => redis.ping(),
            catch: () => "unavailable",
          })
          if (pingResult !== "PONG") return null

          const streams = new ValkeyStreams(redis, config.streamName)
          const exists = yield* Effect.promise(() => streams.streamExists())
          if (exists) {
            const info = yield* Effect.promise(() => streams.getStreamInfo())
            if (info.length > 0) return null
          }
          return yield* recover()
        }).pipe(Effect.orDie),
      setRecoveryState,
      getRecoveryState: () =>
        Effect.gen(function* () {
          const result = yield* sql.query(async (db) => {
            const { eq } = await import("drizzle-orm")
            const [row] = await db
              .select({ state: CoordinationRecoveryTable.state })
              .from(CoordinationRecoveryTable)
              .where(eq(CoordinationRecoveryTable.id, "current"))
              .execute()
            return row ?? null
          })
          return (result?.state as CoordinationRecoveryState) ?? "ready"
        }).pipe(Effect.orDie),
      getLastDivergenceReport: () => lastDivergenceReport,
      persistRecoveryReceipt,
      detectDivergence,
    }
  })
)

// ── Functional Wrappers ──────────────────────────────────────────────

/**
 * Plan coordination recovery.
 */
export const planCoordinationRecovery = (sessionID: SessionID, projectID: ProjectID) =>
  Effect.gen(function* () {
    const recovery = yield* CoordinationRecovery
    return yield* recovery.planRecovery()
  })

/**
 * Persist a coordination recovery receipt.
 */
export const persistCoordinationRecoveryReceipt = (receipt: RecoveryReceipt) =>
  Effect.gen(function* () {
    const recovery = yield* CoordinationRecovery
    return yield* recovery.persistRecoveryReceipt(receipt)
  })

/**
 * Set recovery status for a session.
 */
export function setRecoveryStatus(
  sessionID: SessionID,
  state: string,
): Effect.Effect<void, never, SessionStatusService> {
  return SessionStatusService.pipe(Effect.flatMap((svc) => svc.set(sessionID, { type: state as any })))
}
