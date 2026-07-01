import { describe, it, expect } from "bun:test"
import { isRoleRoutableForEndToEnd } from "../phase-capability"
import type { PrismWorkerRole } from "../phase-role-types"

describe("isRoleRoutableForEndToEnd", () => {
  it("returns true for unified role", () => {
    expect(isRoleRoutableForEndToEnd("unified")).toBe(true)
  })

  it("returns false for prefill_only role", () => {
    expect(isRoleRoutableForEndToEnd("prefill_only")).toBe(false)
  })

  it("returns false for decode_only role", () => {
    expect(isRoleRoutableForEndToEnd("decode_only")).toBe(false)
  })

  it("returns true for prefill_preferred role", () => {
    expect(isRoleRoutableForEndToEnd("prefill_preferred")).toBe(true)
  })

  it("returns true for decode_preferred role", () => {
    expect(isRoleRoutableForEndToEnd("decode_preferred")).toBe(true)
  })

  it("covers all known PrismWorkerRole values", () => {
    const allRoles: PrismWorkerRole[] = [
      "unified",
      "prefill_preferred",
      "decode_preferred",
      "prefill_only",
      "decode_only",
    ]
    for (const role of allRoles) {
      const result = isRoleRoutableForEndToEnd(role)
      // Just verify it's a defined boolean for every known role
      expect(typeof result).toBe("boolean")
    }
  })
})
