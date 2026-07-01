/**
 * Codex — Pattern Filter Tests
 */

import { expect, test, describe } from "bun:test"
import { containsCode, isPattern, extractPattern, validatePatternClaims, ensurePatternClaims } from "../codex-pattern-filter"
import type { CodexClaim } from "../codex-types"

const makeClaim = (statement: string): CodexClaim => ({
  claimId: "c1",
  statement,
  claimType: "fact",
  supportRefs: [],
  scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
  confidence: 0.8,
})

describe("containsCode", () => {
  test("pure pattern statement returns false", () => {
    expect(containsCode("Unbounded buffer access in Metal shader dispatch causes GPU timeout")).toBe(false)
  })

  test("statement with inline code returns true", () => {
    expect(containsCode("Calling `computeEncoder.dispatchThreadgroups` without binding the buffer crashes")).toBe(true)
  })

  test("fenced code block returns true", () => {
    expect(containsCode("The fix is:\n```swift\nbuffer.bind()\ndispatch()\n```")).toBe(true)
  })

  test("function signature returns true", () => {
    expect(containsCode("The function `func validateBuffer(_ buffer: MTLBuffer) -> Bool` checks bounds")).toBe(true)
  })

  test("file extension reference returns true", () => {
    expect(containsCode("The crash was in matrix_multiply.metal at line 42")).toBe(true)
  })

  test("import statement returns true", () => {
    expect(containsCode("Add `import Foundation` to the file")).toBe(true)
  })

  test("Rust-style path returns true", () => {
    expect(containsCode("Use `std::sync::Arc` for thread-safe reference counting")).toBe(true)
  })
})

describe("extractPattern", () => {
  test("removes fenced code blocks", () => {
    const result = extractPattern("The fix:\n```swift\nlet buf = device.makeBuffer()\n```\nApplies to all Metal devices.")
    expect(result).not.toContain("let buf")
    expect(result).toContain("[code example]")
  })

  test("replaces inline code with pattern generalization", () => {
    const result = extractPattern("Calling `computeEncoder.dispatchThreadgroups` without binding the buffer crashes")
    expect(result).toContain("[operation]")
  })

  test("replaces file paths with [path]", () => {
    const result = extractPattern("Fix in src/shaders/matrix_multiply.metal")
    expect(result).toContain("[source file]")
  })

  test("replaces git commits with [commit]", () => {
    const result = extractPattern("Fixed in commit a1b2c3d4e5f6")
    expect(result).toContain("[commit]")
  })

  test("pure pattern passes through unchanged", () => {
    const input = "Unbounded buffer access in Metal shader dispatch causes GPU timeout on Apple Silicon"
    expect(extractPattern(input)).toBe(input)
  })

  test("generalizes camelCase identifiers", () => {
    const result = extractPattern("The `validateBufferBounds` function checks the condition")
    expect(result).toContain("[operation]")
  })
})

describe("isPattern", () => {
  test("pattern statement returns true", () => {
    expect(isPattern(makeClaim("GPU timeout occurs when Metal buffer is unbound during dispatch"))).toBe(true)
  })

  test("code statement returns false", () => {
    expect(isPattern(makeClaim("Fix: `buffer.bind() before dispatcher.dispatch()`"))).toBe(false)
  })
})

describe("ensurePatternClaims", () => {
  test("passes through pattern claims unchanged", () => {
    const claims = [makeClaim("Unbounded buffer causes GPU timeout")]
    const result = ensurePatternClaims(claims)
    expect(result[0].statement).toBe(claims[0].statement)
    expect(result[0].confidence).toBe(0.8)
  })

  test("transforms code claims to patterns", () => {
    const claims = [makeClaim("Fix: `buffer.bind()` before `dispatcher.dispatch()`")]
    const result = ensurePatternClaims(claims)
    expect(result[0].statement).not.toContain("buffer.bind()")
    expect(result[0].confidence).toBeLessThanOrEqual(0.6)
  })
})

describe("validatePatternClaims", () => {
  test("returns warnings for code-containing claims", () => {
    const claims = [
      makeClaim("Pure pattern statement"),
      makeClaim("Fix: `buffer.bind()` before dispatch"),
    ]
    const result = validatePatternClaims(claims)
    expect(result.cleaned).toHaveLength(2)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("contained code")
  })

  test("no warnings for clean claims", () => {
    const claims = [
      makeClaim("Pure pattern one"),
      makeClaim("Pure pattern two"),
    ]
    const result = validatePatternClaims(claims)
    expect(result.warnings).toHaveLength(0)
  })
})
