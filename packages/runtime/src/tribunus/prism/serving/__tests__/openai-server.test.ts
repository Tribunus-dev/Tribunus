/**
 * Prism llm-d Worker — OpenAI Server Tests
 */

import { describe, it, expect } from "bun:test"
import {
  getEndpointPath,
  parseChatRequest,
  formatChatResponse,
  formatStreamChunk,
  formatErrorResponse,
} from "../openai-server"

describe("getEndpointPath", () => {
  it("returns /health for health endpoint", () => {
    expect(getEndpointPath("health")).toBe("/health")
  })

  it("returns /ready for ready endpoint", () => {
    expect(getEndpointPath("ready")).toBe("/ready")
  })

  it("returns /metrics for metrics endpoint", () => {
    expect(getEndpointPath("metrics")).toBe("/metrics")
  })

  it("returns /v1/models for models endpoint", () => {
    expect(getEndpointPath("models")).toBe("/v1/models")
  })

  it("returns /v1/chat/completions for chat_completions", () => {
    expect(getEndpointPath("chat_completions")).toBe("/v1/chat/completions")
  })

  it("returns /v1/completions for completions", () => {
    expect(getEndpointPath("completions")).toBe("/v1/completions")
  })

  it("returns /v1/embeddings for embeddings", () => {
    expect(getEndpointPath("embeddings")).toBe("/v1/embeddings")
  })

  it("returns /v1/cancel for cancel", () => {
    expect(getEndpointPath("cancel")).toBe("/v1/cancel")
  })

  it("returns /v1/capabilities for capabilities", () => {
    expect(getEndpointPath("capabilities")).toBe("/v1/capabilities")
  })

  it("returns /v1/receipts for receipts", () => {
    expect(getEndpointPath("receipts")).toBe("/v1/receipts")
  })

  it("returns /v1/kv-events for kv_events", () => {
    expect(getEndpointPath("kv_events")).toBe("/v1/kv-events")
  })

  it("returns /v1/kv-replay for kv_replay", () => {
    expect(getEndpointPath("kv_replay")).toBe("/v1/kv-replay")
  })
})

describe("parseChatRequest", () => {
  it("parses a valid minimal request", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    })
    expect(result.valid).toBe(true)
    expect(result.model).toBe("gpt-4")
    expect(result.messages).toHaveLength(1)
    expect(result.stream).toBe(false)
    expect(result.maxTokens).toBeUndefined()
  })

  it("parses request with stream=true", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    })
    expect(result.valid).toBe(true)
    expect(result.stream).toBe(true)
  })

  it("parses request with max_tokens", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 200,
    })
    expect(result.valid).toBe(true)
    expect(result.maxTokens).toBe(200)
  })

  it("rejects missing model", () => {
    const result = parseChatRequest({ messages: [] })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("model")
  })

  it("rejects empty string model", () => {
    const result = parseChatRequest({ model: "", messages: [{ role: "user", content: "hi" }] })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("model")
  })

  it("rejects non-string model", () => {
    const result = parseChatRequest({ model: 42, messages: [] })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("model")
  })

  it("rejects missing messages", () => {
    const result = parseChatRequest({ model: "gpt-4" })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("messages")
  })

  it("rejects non-array messages", () => {
    const result = parseChatRequest({ model: "gpt-4", messages: "not array" })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("messages")
  })

  it("rejects empty messages array", () => {
    const result = parseChatRequest({ model: "gpt-4", messages: [] })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("messages")
  })

  it("rejects non-positive max_tokens", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 0,
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("max_tokens")
  })

  it("parses string max_tokens", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: "150",
    })
    expect(result.valid).toBe(true)
    expect(result.maxTokens).toBe(150)
  })

  it("rejects invalid string max_tokens", () => {
    const result = parseChatRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: "abc",
    })
    expect(result.valid).toBe(false)
  })
})

describe("formatChatResponse", () => {
  it("returns an object with correct structure", () => {
    const resp = formatChatResponse("gpt-4", "Hello!", { inputTokens: 10, outputTokens: 5 })
    expect(resp.object).toBe("chat.completion")
    expect(resp.model).toBe("gpt-4")
    expect(resp.choices).toHaveLength(1)
  })

  it("includes the assistant message content", () => {
    const resp = formatChatResponse("gpt-4", "Hello!", { inputTokens: 10, outputTokens: 5 })
    const message = (resp.choices as Array<Record<string, unknown>>)[0].message as Record<string, unknown>
    expect(message.role).toBe("assistant")
    expect(message.content).toBe("Hello!")
  })

  it("includes usage information", () => {
    const resp = formatChatResponse("gpt-4", "x", { inputTokens: 7, outputTokens: 3 })
    const usage = resp.usage as Record<string, number>
    expect(usage.prompt_tokens).toBe(7)
    expect(usage.completion_tokens).toBe(3)
    expect(usage.total_tokens).toBe(10)
  })

  it("includes created timestamp", () => {
    const resp = formatChatResponse("gpt-4", "x", { inputTokens: 0, outputTokens: 0 })
    expect(typeof resp.created).toBe("number")
    expect(resp.created).toBeGreaterThan(0)
  })
})

describe("formatStreamChunk", () => {
  it("returns a data: prefixed SSE line", () => {
    const chunk = formatStreamChunk("gpt-4", "Hello")
    expect(chunk).toStartWith("data: ")
    expect(chunk).toEndWith("\n\n")
  })

  it("includes model in the payload", () => {
    const chunk = formatStreamChunk("gpt-4", "Hello")
    expect(chunk).toContain('"model":"gpt-4"')
  })

  it("includes delta content", () => {
    const chunk = formatStreamChunk("gpt-4", "Hello")
    expect(chunk).toContain('"content":"Hello"')
  })

  it("is valid JSON after data: prefix", () => {
    const chunk = formatStreamChunk("gpt-4", "Hello")
    const json = JSON.parse(chunk.slice(6))
    expect(json.object).toBe("chat.completion.chunk")
  })
})

describe("formatErrorResponse", () => {
  it("returns an error object with code and message", () => {
    const err = formatErrorResponse("model_not_found", "The model does not exist")
    expect(err.error).toBeDefined()
    const e = err.error as Record<string, unknown>
    expect(e.code).toBe("model_not_found")
    expect(e.message).toBe("The model does not exist")
  })

  it("includes type field", () => {
    const err = formatErrorResponse("timeout", "timeout")
    const e = err.error as Record<string, unknown>
    expect(e.type).toBe("invalid_request_error")
  })
})
