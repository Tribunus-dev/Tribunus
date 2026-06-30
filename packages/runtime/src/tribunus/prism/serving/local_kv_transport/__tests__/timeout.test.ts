/**
 * Tests — Local Transport Timeouts
 */

import { describe, it, expect } from "bun:test"
import { isTimeoutElapsed, getTimeoutDeadline, classifyTimeout } from "../transport-timeout"
import type { TransportTimeoutClass } from "../local-transport-types"

describe("isTimeoutElapsed", () => {
  it("returns false when timeout has not elapsed", () => {
    const future = new Date(Date.now() + 10_000).toISOString()
    expect(isTimeoutElapsed(future, 5_000)).toBe(false)
  })

  it("returns true when timeout has elapsed", () => {
    const past = new Date(Date.now() - 10_000).toISOString()
    expect(isTimeoutElapsed(past, 5_000)).toBe(true)
  })

  it("returns true for unparseable startedAt", () => {
    expect(isTimeoutElapsed("not-a-date", 5_000)).toBe(true)
  })

  it("returns true when exactly at threshold", () => {
    const past = new Date(Date.now() - 1_000).toISOString()
    expect(isTimeoutElapsed(past, 0)).toBe(true)
  })

  it("returns false for large timeoutMs", () => {
    const past = new Date(Date.now() - 1_000).toISOString()
    expect(isTimeoutElapsed(past, 1_000_000)).toBe(false)
  })
})

describe("getTimeoutDeadline", () => {
  it("returns an ISO date string in the future", () => {
    const start = new Date().toISOString()
    const deadline = getTimeoutDeadline(start, 10_000)
    const deadlineMs = new Date(deadline).getTime()
    expect(Number.isNaN(deadlineMs)).toBe(false)
    expect(deadlineMs - new Date(start).getTime()).toBe(10_000)
  })

  it("handles zero timeoutMs", () => {
    const start = new Date().toISOString()
    const deadline = getTimeoutDeadline(start, 0)
    expect(deadline).toBe(start)
  })

  it("returns startedAt unchanged for unparseable input", () => {
    expect(getTimeoutDeadline("not-a-date", 5_000)).toBe("not-a-date")
  })

  it("produces correct deadline for large values", () => {
    const start = "2025-01-01T00:00:00.000Z"
    const deadline = getTimeoutDeadline(start, 86_400_000) // 1 day
    expect(deadline).toBe("2025-01-02T00:00:00.000Z")
  })
})

describe("classifyTimeout", () => {
  const cases: [TransportTimeoutClass, string][] = [
    ["serialization_timeout", "serialization"],
    ["descriptor_delivery_timeout", "descriptor"],
    ["destination_map_timeout", "map"],
    ["integrity_validation_timeout", "integrity"],
    ["deserialization_timeout", "deserialisation"],
    ["acknowledgement_timeout", "acknowledge"],
    ["source_cleanup_timeout", "cleanup"],
    ["transport_session_timeout", "session"],
  ]

  it.each(cases)("classifyTimeout(%s) returns a non-empty string", (_cls, keyword) => {
    const result = classifyTimeout(_cls)
    expect(result.length).toBeGreaterThan(0)
    expect(result.toLowerCase()).toContain(keyword)
  })

  it("all timeout classes produce unique messages", () => {
    const all: TransportTimeoutClass[] = [
      "serialization_timeout",
      "descriptor_delivery_timeout",
      "destination_map_timeout",
      "integrity_validation_timeout",
      "deserialization_timeout",
      "acknowledgement_timeout",
      "source_cleanup_timeout",
      "transport_session_timeout",
    ]
    const messages = all.map(classifyTimeout)
    expect(new Set(messages).size).toBe(all.length)
  })
})
