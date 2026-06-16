import { and, desc, eq } from "@/storage/db"
import type { Database } from "@/storage/db"
import { SessionMessage } from "@tribunus/core/session-message"
import { SessionMessageUpdater } from "@tribunus/core/session-message-updater"
import { SessionEvent } from "@tribunus/core/session-event"
import * as DateTime from "effect/DateTime"
import { SyncEvent } from "@/sync"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionMessageTable, SessionTable } from "@/storage/schema"
import type { SessionID } from "./schema"
import { Schema } from "effect"

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
type SessionMessageData = NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>

function encodeDateTimes(value: unknown): unknown {
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value)
  if (Array.isArray(value)) return value.map(encodeDateTimes)
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeDateTimes(item)]))
  }
  return value
}

function encodeMessageData(value: unknown): SessionMessageData {
  return encodeDateTimes(value) as SessionMessageData
}

async function update(db: Database.TxOrDb, event: SessionEvent.Event) {
  const sessionID = event.data.sessionID as SessionID

  const rows = await db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.session_id, sessionID))
    .orderBy(SessionMessageTable.id)
    .execute()

  const originalMap = new Map<string, SessionMessage.Message>()
  const messages: SessionMessage.Message[] = []

  for (const row of rows) {
    const msg = decodeMessage({ ...row.data, id: row.id, type: row.type })
    messages.push(msg)
    originalMap.set(row.id, msg)
  }

  const adapter = SessionMessageUpdater.memory({ messages })
  SessionMessageUpdater.update(adapter, event)

  for (const msg of messages) {
    const original = originalMap.get(msg.id)
    const { id, type, ...data } = msg

    if (!original) {
      await db.insert(SessionMessageTable)
        .values({
          id,
          session_id: sessionID,
          type,
          time_created: DateTime.toEpochMillis(msg.time.created),
          data: encodeMessageData(data),
        })
        .execute()
    } else if (JSON.stringify(original) !== JSON.stringify(msg)) {
      await db.update(SessionMessageTable)
        .set({ data: encodeMessageData(data) })
        .where(
          and(
            eq(SessionMessageTable.id, id),
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, type),
          ),
        )
        .execute()
    }
  }
}

export default [
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.AgentSwitched), async (db, data, event) => {
    await db.update(SessionTable)
      .set({
        agent: data.agent,
        time_updated: DateTime.toEpochMillis(data.timestamp),
      })
      .where(eq(SessionTable.id, data.sessionID))
      .execute()
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.agent.switched", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.ModelSwitched), async (db, data, event) => {
    await db.update(SessionTable)
      .set({
        model: data.model,
        time_updated: DateTime.toEpochMillis(data.timestamp),
      })
      .where(eq(SessionTable.id, data.sessionID))
      .execute()
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.model.switched", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Prompted), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.prompted", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Synthetic), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.synthetic", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Shell.Started), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.shell.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Shell.Ended), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.shell.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Step.Started), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Step.Ended), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Step.Failed), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.step.failed", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Text.Started), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.text.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Text.Delta), () => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Text.Ended), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.text.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Input.Started), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.input.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Input.Delta), () => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Input.Ended), (db, data, event) => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Called), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.called", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Success), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.success", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Tool.Failed), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.tool.failed", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Reasoning.Started), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.reasoning.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Reasoning.Delta), () => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Reasoning.Ended), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.reasoning.ended", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Retried), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.retried", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Compaction.Started), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.compaction.started", data })
  }),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Compaction.Delta), () => {}),
  SyncEvent.project(EventV2Bridge.toSyncDefinition(SessionEvent.Compaction.Ended), async (db, data, event) => {
    await update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.compaction.ended", data })
  }),
]
