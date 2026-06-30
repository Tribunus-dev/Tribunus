/**
 * Prism llm-d Worker — Streaming Tests
 */

import { describe, it, expect } from "bun:test"
import { createStreamChunk, createStreamDone, getStreamEventType } from "../worker-streaming"

describe("createStreamChunk", () => {
  it("includes sequence id in SSE format", () => {
    const chunk = createStreamChunk(1, "Hello", false)
    expect(chunk).toContain("id: 1")
  })

  it("includes event: delta for non-final chunks", () => {
    const chunk = createStreamChunk(0, "Hello", false)
    expect(chunk).toContain("event: delta")
    expect(chunk).not.toContain("event: done")
  })

  it("includes content in JSON data payload", () => {
    const chunk = createStreamChunk(0, "Hello", false)
    expect(chunk).toContain('"content":"Hello"')
    expect(chunk).toContain('"sequence":0')
  })

  it("appends done event for final chunks", () => {
    const chunk = createStreamChunk(2, "World", true)
    expect(chunk).toContain("event: delta")
    expect(chunk).toContain("event: done")
    expect(chunk).toContain("[DONE]")
  })

  it("uses proper SSE double-newline framing", () => {
    const chunk = createStreamChunk(0, "x", false)
    expect(chunk).toEndWith("\n\n")
  })
})

describe("createStreamDone", () => {
  it("includes sequence id", () => {
    const done = createStreamDone(3)
    expect(done).toContain("id: 3")
  })

  it("includes event: done", () => {
    const done = createStreamDone(3)
    expect(done).toContain("event: done")
  })

  it("includes [DONE] marker", () => {
    const done = createStreamDone(3)
    expect(done).toContain("[DONE]")
  })

  it("uses proper SSE double-newline framing", () => {
    const done = createStreamDone(3)
    expect(done).toEndWith("\n\n")
  })
})

describe("getStreamEventType", () => {
  it("returns 'delta' for delta chunks", () => {
    const chunk = createStreamChunk(0, "Hello", false)
    expect(getStreamEventType(chunk)).toBe("delta")
  })

  it("returns 'done' for done signals", () => {
    const done = createStreamDone(5)
    expect(getStreamEventType(done)).toBe("done")
  })

  it("returns 'done' when chunk contains [DONE]", () => {
    expect(getStreamEventType("data: [DONE]\n\n")).toBe("done")
  })

  it("returns 'error' for error events", () => {
    expect(getStreamEventType("event: error\ndata: something broke\n\n")).toBe("error")
  })

  it("returns 'delta' for unknown chunk", () => {
    expect(getStreamEventType("random text")).toBe("delta")
  })
})
