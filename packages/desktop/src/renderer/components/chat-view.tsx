/**
 * ChatView — scrollable conversation view with input bar, lazy scroll-back,
 * and streaming token display. Solid.js component.
 */

import { createSignal, createEffect, onCleanup, onMount, For } from "solid-js"
import { conversationStore, type ConversationMessage } from "../store/conversation-store"
import { MessageBubble } from "./message-bubble"

export function ChatView() {
  const [inputText, setInputText] = createSignal("")
  const [messages, setMessages] = createSignal<ConversationMessage[]>([])
  const [isLoading, setIsLoading] = createSignal(false)
  const [hasMore, setHasMore] = createSignal(true)
  const [sessionId, setSessionId] = createSignal<string | null>(null)
  const [isStreaming, setIsStreaming] = createSignal(false)

  let scrollRef!: HTMLDivElement
  let sentinelRef!: HTMLDivElement
  let autoScroll = true

  // Subscribe to store updates
  onMount(() => {
    const unsub = conversationStore.subscribe((snap) => {
      setMessages(snap.activeMessages.slice())
      setIsLoading(snap.isLoadingHistory)
      setHasMore(snap.hasMoreHistory)
      setSessionId(snap.sessionId)
    })
    onCleanup(unsub)
  })

  // IntersectionObserver for scroll-up prefetch
  onMount(() => {
    if (!sentinelRef) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore() && !isLoading()) {
            conversationStore.prefetchHistory().catch(() => {})
          }
        }
      },
      { rootMargin: "200px 0px" },
    )
    observer.observe(sentinelRef)
    onCleanup(() => observer.disconnect())
  })

  // Auto-scroll on new messages
  createEffect(() => {
    const _ = messages()
    if (autoScroll && scrollRef) {
      requestAnimationFrame(() => {
        scrollRef.scrollTop = scrollRef.scrollHeight
      })
    }
  })

  function handleScroll() {
    if (!scrollRef) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef
    autoScroll = scrollHeight - scrollTop - clientHeight < 100
  }

  async function sendMessage() {
    const text = inputText().trim()
    if (!text) return

    const sid = sessionId() || `sess-${crypto.randomUUID()}`
    if (!sessionId()) {
      await conversationStore.initializeSession(sid)
    }

    // Send user message
    await conversationStore.appendMessage("user", text)
    setInputText("")

    // Start listening for stream tokens before calling engine
    setIsStreaming(true)

    // Register the stream token listener
    let unsubStream: (() => void) | undefined
    if (window.api?.onConversationStreamToken) {
      unsubStream = window.api.onConversationStreamToken((token: string) => {
        conversationStore.appendAgentToken(token)
      })
    }

    // Call the engine via IPC
    try {
      if (window.api?.conversationEngineGenerate) {
        const result = await window.api.conversationEngineGenerate(sid, text, 100)
        if (!result.ok) {
          conversationStore.appendAgentToken(" [Error: " + (result.error || "generation failed") + "]")
        }
      }
    } catch (err) {
      conversationStore.appendAgentToken(" [Error: " + String(err) + "]")
    } finally {
      // Clean up listener
      unsubStream?.()
      setIsStreaming(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const disabled = isStreaming() || !inputText().trim()

  return (
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
      {/* Message scroll area */}
      <div
        ref={scrollRef!}
        style="flex:1;overflow-y:auto;padding:16px"
        onScroll={handleScroll}
      >
        {/* Scroll-up sentinel */}
        {hasMore() && <div ref={sentinelRef!} style="height:1px" />}

        {isLoading() && (
          <div style="text-align:center;padding:8px;font-size:12px;color:var(--color-text-tertiary)">
            Loading earlier messages...
          </div>
        )}

        <For each={messages()} fallback={null}>
          {(msg, index) => (
            <MessageBubble
              message={msg}
              showTimestamp={
                index() === 0 ||
                msg.timestamp - (messages()[index() - 1]?.timestamp ?? 0) > 300000
              }
            />
          )}
        </For>

        {isStreaming() && (
          <div style="display:flex;gap:4px;padding:4px 12px;font-size:20px;color:var(--color-text-tertiary)">
            <span class="streaming-dot" />
            <span class="streaming-dot" />
            <span class="streaming-dot" />
          </div>
        )}

        {messages().length === 0 && !isStreaming() && (
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-tertiary);font-size:14px">
            Start a conversation. Messages are saved locally.
          </div>
        )}
      </div>

      {/* Input bar */}
      <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--color-border);background-color:var(--color-surface)">
        <input
          type="text"
          value={inputText()}
          onInput={(e) => setInputText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isStreaming()}
          style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--color-border);background-color:var(--color-surface-2);color:var(--color-text-primary);font-size:14px;outline:none"
        />
        <button
          onClick={sendMessage}
          disabled={disabled}
          style={`padding:8px 16px;border-radius:8px;border:none;background-color:var(--color-accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;opacity:${disabled ? 0.5 : 1}`}
        >
          Send
        </button>
      </div>
    </div>
  )
}
