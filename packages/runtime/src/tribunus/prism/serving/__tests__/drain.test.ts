/**
 * Prism llm-d Worker — Drain Tests
 */

import { describe, it, expect } from "bun:test"
import { beginDrain, isDrained, getDrainDeadline } from "../worker-drain"

describe("beginDrain", () => {
  it("returns newRequestsRejected as true", () => {
    const state = beginDrain()
    expect(state.newRequestsRejected).toBe(true)
  })

  it("returns inflightCount as 0 initially", () => {
    const state = beginDrain()
    expect(state.inflightCount).toBe(0)
  })
})

describe("isDrained", () => {
  it("returns true when inflightCount is 0", () => {
    expect(isDrained(0)).toBe(true)
  })

  it("returns true when inflightCount is negative", () => {
    expect(isDrained(-1)).toBe(true)
  })

  it("returns false when inflightCount is positive", () => {
    expect(isDrained(1)).toBe(false)
    expect(isDrained(5)).toBe(false)
  })
})

describe("getDrainDeadline", () => {
  it("computes deadline in the future", () => {
    const past = "2025-01-01T00:00:00.000Z"
    const deadline = getDrainDeadline(past, 5_000)
    const deadlineMs = new Date(deadline).getTime()
    expect(deadlineMs).toBe(new Date(past).getTime() + 5_000)
  })

  it("returns a valid ISO-8601 string", () => {
    const result = getDrainDeadline(new Date().toISOString(), 10_000)
    expect(() => new Date(result).toISOString()).not.toThrow()
  })

  it("throws for invalid startedAt", () => {
    expect(() => getDrainDeadline("not-a-date", 1000)).toThrow(RangeError)
  })

  it("throws for non-positive deadlineMs", () => {
    const now = new Date().toISOString()
    expect(() => getDrainDeadline(now, 0)).toThrow(RangeError)
    expect(() => getDrainDeadline(now, -100)).toThrow(RangeError)
  })
})
