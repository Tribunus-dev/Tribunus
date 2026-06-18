import { describe, expect, test } from "bun:test"
import { isNonAllowRule, hasPermissionPromptRules } from "./permission-rules"

describe("permission rules", () => {
  test("isNonAllowRule", () => {
    expect(isNonAllowRule(null)).toBe(false)
    expect(isNonAllowRule("allow")).toBe(false)
    expect(isNonAllowRule("ask")).toBe(true)
    expect(isNonAllowRule("reject")).toBe(true)
    expect(isNonAllowRule(["allow"])).toBe(false) // Array is not valid here, handled separately
    expect(isNonAllowRule({ a: "allow", b: "allow" })).toBe(false)
    expect(isNonAllowRule({ a: "allow", b: "ask" })).toBe(true)
  })

  test("hasPermissionPromptRules", () => {
    expect(hasPermissionPromptRules(undefined)).toBe(false)
    expect(hasPermissionPromptRules("allow")).toBe(false)
    expect(hasPermissionPromptRules("ask")).toBe(true)
    expect(hasPermissionPromptRules({ tool1: "allow", tool2: "allow" })).toBe(false)
    expect(hasPermissionPromptRules({ tool1: "allow", tool2: "ask" })).toBe(true)
    expect(hasPermissionPromptRules({ tool1: "allow", tool2: { nested: "ask" } })).toBe(true)
  })
})
