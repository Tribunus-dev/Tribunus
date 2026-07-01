/**
 * Prism llm-d Worker — OpenAI Endpoint Definitions
 *
 * Pure functions for parsing OpenAI-compatible API requests and
 * formatting responses in the OpenAI wire format.
 */

/**
 * Union of all OpenAI-compatible endpoints exposed by the Prism worker.
 */
export type OpenAiEndpoint =
  | "health"
  | "ready"
  | "metrics"
  | "models"
  | "chat_completions"
  | "completions"
  | "embeddings"
  | "cancel"
  | "capabilities"
  | "receipts"
  | "kv_events"
  | "kv_replay"

const ENDPOINT_PATHS: Record<OpenAiEndpoint, string> = {
  health: "/health",
  ready: "/ready",
  metrics: "/metrics",
  models: "/v1/models",
  chat_completions: "/v1/chat/completions",
  completions: "/v1/completions",
  embeddings: "/v1/embeddings",
  cancel: "/v1/cancel",
  capabilities: "/v1/capabilities",
  receipts: "/v1/receipts",
  kv_events: "/v1/kv-events",
  kv_replay: "/v1/kv-replay",
}

/**
 * Resolve a canonical URL path for the given endpoint.
 */
export function getEndpointPath(endpoint: OpenAiEndpoint): string {
  return ENDPOINT_PATHS[endpoint]
}

/**
 * Validate and parse an incoming chat completion request body.
 * Returns a result indicating whether the request is structurally valid.
 */
export function parseChatRequest(body: Record<string, unknown>): {
  valid: boolean
  error?: string
  model?: string
  messages?: unknown[]
  stream?: boolean
  maxTokens?: number
} {
  if (!body.model || typeof body.model !== "string" || body.model.length === 0) {
    return { valid: false, error: "model is required" }
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return { valid: false, error: "messages must be a non-empty array" }
  }

  const maxTokens =
    body.max_tokens !== undefined
      ? typeof body.max_tokens === "number"
        ? body.max_tokens
        : typeof body.max_tokens === "string"
          ? parseInt(body.max_tokens, 10)
          : undefined
      : undefined

  if (maxTokens !== undefined && (Number.isNaN(maxTokens) || maxTokens <= 0)) {
    return { valid: false, error: "max_tokens must be a positive integer" }
  }

  return {
    valid: true,
    model: body.model as string,
    messages: body.messages as unknown[],
    stream: body.stream === true,
    maxTokens,
  }
}

/**
 * Format a non-streaming chat completion response.
 */
export function formatChatResponse(
  model: string,
  content: string,
  usage: { inputTokens: number; outputTokens: number },
): Record<string, unknown> {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
    },
  }
}

/**
 * Format a streaming chunk (SSE data line) for a chat completion delta.
 */
export function formatStreamChunk(model: string, content: string): string {
  const data = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  }
  return `data: ${JSON.stringify(data)}\n\n`
}

/**
 * Format an error response in OpenAI-compatible format.
 */
export function formatErrorResponse(code: string, message: string): Record<string, unknown> {
  return {
    error: {
      code,
      message,
      type: "invalid_request_error",
    },
  }
}
