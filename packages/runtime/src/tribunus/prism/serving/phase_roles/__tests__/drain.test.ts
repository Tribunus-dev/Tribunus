/**
 * Tests — Phase-aware Drain
 */

import { describe, it, expect } from "bun:test"
import { validateDrainScope, isDrainAllowed } from "../phase-drain"
import type { DrainScope } from "../phase-drain"

describe("validateDrainScope", () => {
  it("accepts 'all' scope regardless of active execution", () => {
    const r = validateDrainScope("all", true)
    expect(r.valid).toBe(true)
    expect(r.reason).toBeNull()
  })

  it("accepts 'prefill_only' scope", () => {
    const r = validateDrainScope("prefill_only", false)
    expect(r.valid).toBe(true)
    expect(r.reason).toBeNull()
  })

  it("accepts 'decode_only' scope", () => {
    const r = validateDrainScope("decode_only", false)
    expect(r.valid).toBe(true)
    expect(r.reason).toBeNull()
  })

  it("rejects unknown scope with a reason", () => {
    const r = validateDrainScope("unknown_scope" as DrainScope, false)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("Unknown drain scope")
  })
})

describe("isDrainAllowed", () => {
  it("allows 'all' when phases are idle", () => {
    expect(isDrainAllowed("all", 0, 0)).toBe(true)
  })

  it("allows 'all' when phases are active", () => {
    expect(isDrainAllowed("all", 5, 3)).toBe(true)
  })

  it("allows 'prefill_only' when no decode operations active", () => {
    expect(isDrainAllowed("prefill_only", 3, 0)).toBe(true)
  })

  it("denies 'prefill_only' when decode operations are active", () => {
    expect(isDrainAllowed("prefill_only", 3, 1)).toBe(false)
    expect(isDrainAllowed("prefill_only", 0, 1)).toBe(false)
  })

  it("allows 'decode_only' when no prefill operations active", () => {
    expect(isDrainAllowed("decode_only", 0, 3)).toBe(true)
  })

  it("denies 'decode_only' when prefill operations are active", () => {
    expect(isDrainAllowed("decode_only", 1, 3)).toBe(false)
    expect(isDrainAllowed("decode_only", 1, 0)).toBe(false)
  })

  it("denies drain for unrecognised scope", () => {
    expect(isDrainAllowed("unknown" as DrainScope, 0, 0)).toBe(false)
  })
})
