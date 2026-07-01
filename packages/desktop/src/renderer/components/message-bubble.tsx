/**
 * MessageBubble — renders a single conversation message with role styling.
 */

import type { ConversationMessage } from "../store/conversation-store"

interface MessageBubbleProps {
  message: ConversationMessage
  showTimestamp?: boolean
}

const ROLE_STYLES: Record<string, { align: string; bg: string; label: string }> = {
  user: { align: "flex-end", bg: "var(--color-accent)", label: "You" },
  agent: { align: "flex-start", bg: "var(--color-surface-2)", label: "Agent" },
  system: { align: "flex-start", bg: "var(--color-warning-bg)", label: "System" },
}

export function MessageBubble(props: MessageBubbleProps) {
  const s = ROLE_STYLES[props.message.role] ?? ROLE_STYLES.system

  return (
    <div
      style={`display:flex;flex-direction:column;align-items:${s.align};margin-bottom:8px`}
    >
      <span
        style={`font-size:11px;font-weight:600;color:var(--color-text-secondary);margin-bottom:2px;${
          props.message.role === "user" ? "padding-right:12px" : "padding-left:12px"
        }`}
      >
        {s.label}
      </span>

      <div
        style={`max-width:80%;padding:8px 12px;border-radius:12px;background-color:${s.bg};${
          props.message.role === "user" ? "color:#fff" : "color:var(--color-text-primary)"
        };white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.4`}
      >
        {props.message.content || "\u00A0"}
      </div>

      {props.showTimestamp && (
        <span style={`font-size:10px;color:var(--color-text-tertiary);margin-top:2px`}>
          {new Date(props.message.timestamp).toLocaleTimeString()}
        </span>
      )}
    </div>
  )
}
