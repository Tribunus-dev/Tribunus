/**
 * Prism llm-d Worker — OpenAI Surface Tests
 *
 * Tests for OpenAI-compatible API endpoint handling functions.
 */

import { expect, test, describe } from "bun:test"
import {
  getEndpointPath,
  parseChatRequest,
  formatChatResponse,
  formatStreamChunk,
  formatErrorResponse,
} from "../openai-server"

import type { OpenAiEndpoint } from "../openai-server"

// ── getEndpointPath ───────────────────────────────────────────────────────────

describe("getEndpointPath", () => {
  const expectedPaths: Record<OpenAiEndpoint, string> = {
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

  for (const [endpoint, expected] of Object.entries(expectedPaths) as Array<[OpenAiEndpoint, string]>) {
    test(`${endpoint} → ${expected}`, () => {
      expect(getEndpointPath(endpoint)).toBe(expected)
    })
  }
})

// ── parseChatRequest ──────────────────────────────────────────────────────────

describe("parseChatRequest", () => {
  test("valid request returns parsed fields", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 100,
      stream: true,
    })

    expect(result.valid).toBe(true)
    expect(result.model).toBe("gpt-4")
    expect(result.messages).toHaveLength(1)
    expect(result.stream).toBe(true)
    expect(result.maxTokens).toBe(100)
    expect(result.error).toBeUndefined()
  })

  test("missing model returns error", () => {
    const result = parseChatRequest({
      messages: [{ role: "user", content: "hello" }],
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe("model is required")
  })

  test("empty model string returns error", () => {
    const result = parseChatRequest({
      model: "",
      messages: [{ role: "user", content: "hello" }],
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe("model is required")
  })

  test("non-string model returns error", () => {
    const result = parseChatRequest({
      model: 42,
      messages: [{ role: "user", content: "hello" }],
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe("model is required")
  })

  test("missing messages returns error", () => {
    const result = parseChatRequest({
      model: "gpt-4",
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe("messages must be a non-empty array")
  })

  test("empty messages array returns error", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [],
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe("messages must be a non-empty array")
  })

  test("non-array messages returns error", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: "not an array",
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe("messages must be a non-empty array")
  })

  test("non-positive max_tokens returns error", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 0,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe("max_tokens must be a positive integer")
  })

  test("string max_tokens is parsed as number", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: "200",
    })

    expect(result.valid).toBe(true)
    expect(result.maxTokens).toBe(200)
  })

  test("invalid string max_tokens returns error", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: "abc",
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe("max_tokens must be a positive integer")
  })

  test("stream defaults to false when omitted", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    })

    expect(result.valid).toBe(true)
    expect(result.stream).toBe(false)
  })

  test("max_tokens is undefined when omitted", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    })

    expect(result.valid).toBe(true)
    expect(result.maxTokens).toBeUndefined()
  })
})

// ── formatChatResponse ────────────────────────────────────────────────────────

describe("formatChatResponse", () => {
  test("produces correct shape", () => {
    const result = formatChatResponse("gpt-4", "Hello, world!", {
      inputTokens: 10,
      outputTokens: 20,
    })

    expect(result.object).toBe("chat.completion")
    expect(result.model).toBe("gpt-4")
    expect(typeof result.id).toBe("string")
    expect(result.id).toMatch(/^chatcmpl-/)
    expect(typeof result.created).toBe("number")

    expect(result.choices).toHaveLength(1)
    const choice = (result.choices as Array<Record<string, unknown>>)[0]
    expect(choice.index).toBe(0)
    expect((choice.message as Record<string, unknown>).role).toBe("assistant")
    expect((choice.message as Record<string, unknown>).content).toBe("Hello, world!")
    expect(choice.finish_reason).toBe("stop")

    const usage = result.usage as Record<string, unknown>
    expect(usage.prompt_tokens).toBe(10)
    expect(usage.completion_tokens).toBe(20)
    expect(usage.total_tokens).toBe(30)
  })
})

// ── formatStreamChunk ─────────────────────────────────────────────────────────

describe("formatStreamChunk", () => {
  test("produces valid SSE format", () => {
    const result = formatStreamChunk("gpt-4", "Hello")

    expect(result.startsWith("data: ")).toBe(true)
    expect(result.endsWith("\n\n")).toBe(true)

    // Extract and parse the JSON payload
    const jsonStr = result.slice(6, -2)
    const parsed = JSON.parse(jsonStr)

    expect(parsed.object).toBe("chat.completion.chunk")
    expect(parsed.model).toBe("gpt-4")
    expect(typeof parsed.id).toBe("string")
    expect(parsed.id).toMatch(/^chatcmpl-/)
    expect(typeof parsed.created).toBe("number")

    expect(parsed.choices).toHaveLength(1)
    expect(parsed.choices[0].delta.content).toBe("Hello")
    expect(parsed.choices[0].finish_reason).toBeNull()
  })
})

// ── formatErrorResponse ───────────────────────────────────────────────────────

describe("formatErrorResponse", () => {
  test("has stable error codes", () => {
    const result = formatErrorResponse("model_not_found", "The model does not exist")

    const err = result.error as Record<string, unknown>
    expect(err.code).toBe("model_not_found")
    expect(err.message).toBe("The model does not exist")
    expect(err.type).toBe("invalid_request_error")
  })

  test("output is self-contained (no dynamic timestamps)", () => {
    const r1 = formatErrorResponse("rate_limited", "Rate limit exceeded")
    const r2 = formatErrorResponse("rate_limited", "Rate limit exceeded")

    // Same input yields identical output (no timestamps/ids)
    expect(r1).toEqual(r2)
  })
})
