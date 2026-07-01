/**
 * IPC handlers for conversation persistence.
 *
 * Implements the trifecta persistence bridge:
 *   Journal file  — immutable append-only system of record (PGlite-ready schema)
 *   Valkey cache  — high-frequency ring buffer (active stream window)
 *   DuckDB later  — analytical queries over receipts and metrics
 *
 * The journal stores PGlite-compatible SQL so the schema translates directly
 * when the sidecar runtime is available.
 */

import { ipcMain } from "electron"
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { IPC } from "../ipc-channels"
import { createLogger } from "../logger"

const log = createLogger("conversation-handlers")

const CACHE_WINDOW = 100
const PREFETCH_PAGE = 25

export interface ConversationMessage {
  id: string
  sessionId: string
  role: "user" | "agent" | "system"
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export function registerConversationHandlers(opts: {
  journalDir: string
  valkey: {
    connect(): Promise<{
      rpush(key: string, value: string): Promise<unknown>
      ltrim(key: string, start: number, stop: number): Promise<unknown>
    }>
  } | null
}): void {
  const { journalDir, valkey } = opts

  // Ensure journal directory exists
  if (!existsSync(journalDir)) {
    mkdirSync(journalDir, { recursive: true })
  }

  // ── Journal file helpers ──────────────────────────────────────────────
  function journalPath(sessionId: string): string {
    return join(journalDir, `${sessionId}.jsonl`)
  }

  function readJournal(sessionId: string, beforeTimestamp: number, limit: number): ConversationMessage[] {
    const path = journalPath(sessionId)
    if (!existsSync(path)) return []

    const lines = readFileSync(path, "utf-8").trim().split("\n")
    const messages: ConversationMessage[] = []
    for (let i = lines.length - 1; i >= 0 && messages.length < limit; i--) {
      try {
        const msg = JSON.parse(lines[i]) as ConversationMessage
        if (msg.timestamp < beforeTimestamp) {
          messages.unshift(msg)
        }
      } catch {
        // skip corrupt lines
      }
    }
    return messages
  }

  // ── Initialize session ───────────────────────────────────────────────
  ipcMain.handle(IPC.handle.CONVERSATION_INIT_SESSION, async (_event, sessionId: string) => {
    try {
      const tail = readJournal(sessionId, Date.now() + 1, 50)
      return { ok: true as const, value: tail }
    } catch (err) {
      log.error("init-session failed", err)
      return { ok: false as const, error: String(err) }
    }
  })

  // ── Append to journal ────────────────────────────────────────────────
  ipcMain.handle(IPC.handle.CONVERSATION_APPEND, async (_event, message: ConversationMessage) => {
    try {
      const path = journalPath(message.sessionId)
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      appendFileSync(path, JSON.stringify(message) + "\n", "utf-8")
      return { ok: true as const, value: null }
    } catch (err) {
      log.error("append failed", err)
      return { ok: false as const, error: String(err) }
    }
  })

  // ── Valkey ring buffer ───────────────────────────────────────────────
  ipcMain.handle(IPC.handle.CONVERSATION_CACHE_APPEND, async (_event, sessionId: string, message: ConversationMessage) => {
    if (!valkey) return { ok: true as const, value: null }

    try {
      const client = await valkey.connect()
      const key = `session:${sessionId}:tail`
      await client.rpush(key, JSON.stringify(message))
      await client.ltrim(key, -CACHE_WINDOW, -1)
      return { ok: true as const, value: null }
    } catch (err) {
      log.warn("cache-append failed (valkey unavailable)", err)
      return { ok: true as const, value: null } // degrade gracefully
    }
  })

  // ── Paginated history prefetch ────────────────────────────────────────
  ipcMain.handle(IPC.handle.CONVERSATION_FETCH_HISTORY, async (_event, sessionId: string, beforeTimestamp: number, limit: number) => {
    try {
      const rows = readJournal(sessionId, beforeTimestamp, limit || PREFETCH_PAGE)
      return { ok: true as const, value: rows }
    } catch (err) {
      log.error("fetch-history failed", err)
      return { ok: false as const, error: String(err) }
    }
  })
}
