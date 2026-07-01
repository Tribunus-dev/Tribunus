/**
 * Conversation Store — Framework-agnostic reactive store with IPC persistence.
 *
 * Architecture:
 *   Store (event emitter / subscribe pattern)
 *     → IPC handlers (main process)
 *       → Journal file (system of record, JSONL)
 *       → Valkey ring buffer (fast cache, when available)
 *
 * Compatible with Solid.js, React, or vanilla JS via subscribe().
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string
  sessionId: string
  role: "user" | "agent" | "system"
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface ConversationSnapshot {
  activeMessages: ConversationMessage[]
  isLoadingHistory: boolean
  hasMoreHistory: boolean
  sessionId: string | null
}

type Listener = (snapshot: ConversationSnapshot) => void

// ── IPC Bridge ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = (globalThis as any).electronAPI as
  | {
      conversationInitSession: (id: string) => Promise<unknown>
      conversationAppendMessage: (msg: ConversationMessage) => Promise<unknown>
      conversationCacheAppend: (sid: string, msg: ConversationMessage) => Promise<unknown>
      conversationFetchHistory: (sid: string, before: number, limit: number) => Promise<unknown>
    }
  | undefined

// ── Constants ───────────────────────────────────────────────────────────

const BUFFER_LIMIT = 100
let messageCounter = 0

function nextId(): string {
  messageCounter++
  return `msg-${Date.now()}-${messageCounter}`
}

// ── Store ───────────────────────────────────────────────────────────────

function createConversationStore() {
  let state: ConversationSnapshot = {
    activeMessages: [],
    isLoadingHistory: false,
    hasMoreHistory: true,
    sessionId: null,
  }

  const listeners = new Set<Listener>()

  function notify() {
    for (const fn of listeners) {
      fn(state)
    }
  }

  function getState(): ConversationSnapshot {
    return state
  }

  function subscribe(fn: Listener): () => void {
    listeners.add(fn)
    // Immediately call with current state
    fn(state)
    return () => {
      listeners.delete(fn)
    }
  }

  // ── Actions ────────────────────────────────────────────────────────

  async function initializeSession(sessionId: string): Promise<void> {
    state = { ...state, sessionId, activeMessages: [], hasMoreHistory: true, isLoadingHistory: false }
    notify()

    if (bridge?.conversationInitSession) {
      const result = (await bridge.conversationInitSession(sessionId)) as {
        ok: boolean
        value?: ConversationMessage[]
        error?: string
      }
      if (result.ok && result.value) {
        const msgs = result.value as ConversationMessage[]
        state = {
          ...state,
          activeMessages: msgs.slice(-BUFFER_LIMIT),
          hasMoreHistory: msgs.length >= 50,
        }
        notify()
      }
    }
  }

  async function appendMessage(
    role: ConversationMessage["role"],
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<ConversationMessage> {
    if (!state.sessionId) throw new Error("no active session")

    const message: ConversationMessage = {
      id: nextId(),
      sessionId: state.sessionId,
      role,
      content,
      timestamp: Date.now(),
      metadata,
    }

    // Optimistic UI update
    const updated = [...state.activeMessages, message]
    state = {
      ...state,
      activeMessages: updated.length > BUFFER_LIMIT ? updated.slice(updated.length - BUFFER_LIMIT) : updated,
    }
    notify()

    // Async persistence
    if (bridge?.conversationAppendMessage) {
      bridge.conversationAppendMessage(message).catch(() => {})
    }
    if (bridge?.conversationCacheAppend) {
      bridge.conversationCacheAppend(state.sessionId!, message).catch(() => {})
    }

    return message
  }

  function appendAgentToken(token: string, metadata: Record<string, unknown> = {}): void {
    if (!state.sessionId) return

    const msgs = state.activeMessages
    const lastMsg = msgs[msgs.length - 1]

    if (lastMsg && lastMsg.role === "agent") {
      // Append to the last agent message
      const updated = [...msgs]
      updated[updated.length - 1] = {
        ...lastMsg,
        content: lastMsg.content + token,
        metadata: { ...lastMsg.metadata, ...metadata },
      }
      state = { ...state, activeMessages: updated }
    } else {
      // Start a new agent message
      const message: ConversationMessage = {
        id: nextId(),
        sessionId: state.sessionId,
        role: "agent",
        content: token,
        timestamp: Date.now(),
        metadata,
      }
      const updated = [...msgs, message]
      state = {
        ...state,
        activeMessages: updated.length > BUFFER_LIMIT ? updated.slice(updated.length - BUFFER_LIMIT) : updated,
      }
    }
    notify()
  }

  async function prefetchHistory(): Promise<void> {
    if (!state.sessionId || state.isLoadingHistory || !state.hasMoreHistory) return

    state = { ...state, isLoadingHistory: true }
    notify()

    const oldestTimestamp = state.activeMessages[0]?.timestamp ?? Date.now()

    if (bridge?.conversationFetchHistory) {
      const result = (await bridge.conversationFetchHistory(state.sessionId, oldestTimestamp, 25)) as {
        ok: boolean
        value?: ConversationMessage[]
      }
      if (result.ok && result.value) {
        const older = result.value as ConversationMessage[]
        state = {
          ...state,
          activeMessages: [...older, ...state.activeMessages],
          isLoadingHistory: false,
          hasMoreHistory: older.length >= 25,
        }
        notify()
        return
      }
    }

    state = { ...state, isLoadingHistory: false, hasMoreHistory: false }
    notify()
  }

  function clearSession(): void {
    state = { activeMessages: [], sessionId: null, hasMoreHistory: true, isLoadingHistory: false }
    notify()
  }

  return {
    getState,
    subscribe,
    initializeSession,
    appendMessage,
    appendAgentToken,
    prefetchHistory,
    clearSession,
  }
}

// ── Singleton ───────────────────────────────────────────────────────────

export const conversationStore = createConversationStore()
