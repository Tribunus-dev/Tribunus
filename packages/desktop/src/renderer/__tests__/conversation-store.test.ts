/**
 * Conversation Store — Unit Test
 *
 * Tests the ring buffer, IPC bridge, and prefetch logic.
 */

import { expect, test, describe, beforeEach } from "bun:test"

// Stub the electronAPI bridge before importing the store
const mockBridge = {
  conversationInitSession: async () => ({ ok: true, value: [] }),
  conversationAppendMessage: async () => ({ ok: true, value: null }),
  conversationCacheAppend: async () => ({ ok: true, value: null }),
  conversationFetchHistory: async (_sid: string, _before: number, _limit: number) => ({
    ok: true,
    value: [] as Array<{ id: string; sessionId: string; role: string; content: string; timestamp: number }>,
  }),
}

// @ts-expect-error — global injection for testing
globalThis.electronAPI = mockBridge

import { conversationStore, type ConversationMessage } from "../store/conversation-store"

describe("ConversationStore", () => {
  beforeEach(() => {
    // Reset by clearing session
    conversationStore.clearSession()
  })

  test("initializeSession sets session id and loads messages", async () => {
    expect(conversationStore.getState().sessionId).toBeNull()
    expect(conversationStore.getState().activeMessages).toHaveLength(0)

    await conversationStore.initializeSession("sess-001")
    const state = conversationStore.getState()
    expect(state.sessionId).toBe("sess-001")
  })

  test("appendMessage adds a message", async () => {
    await conversationStore.initializeSession("sess-002")
    const msg = await conversationStore.appendMessage("user", "Hello!")
    expect(msg.role).toBe("user")
    expect(msg.content).toBe("Hello!")
    expect(msg.sessionId).toBe("sess-002")

    const state = conversationStore.getState()
    expect(state.activeMessages).toHaveLength(1)
    expect(state.activeMessages[0].content).toBe("Hello!")
  })

  test("appendAgentToken accumulates into the last agent message", async () => {
    await conversationStore.initializeSession("sess-003")
    conversationStore.appendAgentToken("Hello")
    conversationStore.appendAgentToken(" world")
    conversationStore.appendAgentToken("!")

    const state = conversationStore.getState()
    expect(state.activeMessages).toHaveLength(1)
    expect(state.activeMessages[0].role).toBe("agent")
    expect(state.activeMessages[0].content).toBe("Hello world!")
  })

  test("appendAgentToken creates new message when last is not agent", async () => {
    await conversationStore.initializeSession("sess-004")
    await conversationStore.appendMessage("user", "Hi")
    conversationStore.appendAgentToken("First token")

    const state = conversationStore.getState()
    expect(state.activeMessages).toHaveLength(2)
    expect(state.activeMessages[1].role).toBe("agent")
    expect(state.activeMessages[1].content).toBe("First token")
  })

  test("prefetchHistory does nothing when no session", async () => {
    await conversationStore.prefetchHistory()
    expect(conversationStore.getState().isLoadingHistory).toBe(false)
  })


  test("clearSession resets state", async () => {
    await conversationStore.initializeSession("sess-006")
    await conversationStore.appendMessage("user", "clear me")
    conversationStore.clearSession()

    const state = conversationStore.getState()
    expect(state.sessionId).toBeNull()
    expect(state.activeMessages).toHaveLength(0)
  })

  test("subscribe notifies on state changes", async () => {
    const received: Array<string | null> = []
    const unsub = conversationStore.subscribe((s) => received.push(s.sessionId))
    // First call is immediate with current state
    expect(received).toContain(null)

    await conversationStore.initializeSession("sess-sub")
    expect(received).toContain("sess-sub")

    conversationStore.clearSession()
    expect(received).toContain(null)

    unsub()
  })

  test("ring buffer enforces limit", async () => {
    await conversationStore.initializeSession("sess-007")
    // Override limit via internal state mutation (not ideal but acceptable for test)
    // The store uses BUFFER_LIMIT = 100; test with 100+ writes
    for (let i = 0; i < 110; i++) {
      await conversationStore.appendMessage("user", `msg-${i}`)
    }

    const state = conversationStore.getState()
    expect(state.activeMessages.length).toBeLessThanOrEqual(100)
  })
})
