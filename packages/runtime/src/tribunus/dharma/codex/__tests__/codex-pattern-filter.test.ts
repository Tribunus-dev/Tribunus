/**
 * Codex — Semantic Pattern Extractor Tests
 */

import { expect, test, describe } from "bun:test"
import { analyzeStatement, extractPattern, generatePattern, containsCode, isPattern, ensurePatternClaims, validatePatternClaims, mapCodeToRole } from "../codex-pattern-filter"
import type { CodexClaim } from "../codex-types"

const makeClaim = (statement: string): CodexClaim => ({
  claimId: "c1", statement, claimType: "fact", supportRefs: [],
  scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
  confidence: 0.8,
})

describe("analyzeStatement", () => {
  test("identifies buffer binding pattern", () => {
    const result = analyzeStatement("Crash when `computeEncoder.dispatchThreadgroups` is called without binding `buffer`")
    expect(result.hasCode).toBe(true)
    expect(result.identifiedRoles.length).toBeGreaterThan(0)
    expect(result.identifiedRoles.some(r => r.role.includes("buffer") || r.role.includes("dispatch"))).toBe(true)
  })

  test("identifies error handling pattern", () => {
    const result = analyzeStatement("The exception is caught by `try catch` around the decoder invocation")
    expect(result.hasCode).toBe(true)
    expect(result.identifiedRoles.some(r => r.role.includes("error"))).toBe(true)
  })

  test("pure pattern has no code", () => {
    const result = analyzeStatement("Unbounded buffer access in Metal shader dispatch causes GPU timeout on Apple Silicon")
    expect(result.hasCode).toBe(false)
    expect(result.identifiedRoles).toHaveLength(0)
  })

  test("classifies pattern by role types", () => {
    const result = analyzeStatement("Call `encoder.setBuffer` before `encoder.dispatchThreadgroups` to prevent GPU crash")
    expect(result.identifiedRoles.length).toBeGreaterThan(0)
    expect(result.patternClass).toBe("resource_lifecycle")
  })
})

describe("generatePattern", () => {
  test("pure pattern passes through", () => {
    const input = "Buffer must be bound before dispatch"
    const result = generatePattern(analyzeStatement(input))
    expect(result).toContain(input)
  })

  test("produces role descriptions for code refs", () => {
    const result = generatePattern(analyzeStatement("Call `encoder.setBuffer` before `encoder.dispatch`"))
    expect(result).toContain("buffer binding")
    expect(result).toContain("compute dispatch")
    expect(result).toContain("Pattern classification:")
    expect(result).toContain("Engineering roles identified:")
  })

  test("includes context clues when present", () => {
    const result = generatePattern(analyzeStatement("The `dispatch` call crashed the GPU"))
    expect(result).toContain("crash/failure")  // crash/failure context from 'crashed'
  })

  test("handles method call syntax", () => {
    const analysis = analyzeStatement("Fix by calling `buffer.bind()` before `dispatcher.dispatch()`")
    expect(analysis.identifiedRoles.length).toBeGreaterThan(0)
  })
})

describe("extractPattern", () => {
  test("transforms code-containing statement", () => {
    const input = "Crash when `computeEncoder.dispatchThreadgroups` is called without binding the buffer"
    const result = extractPattern(input)
    expect(result).toContain("Pattern classification:")
    expect(result).toContain("Engineering roles identified:")
  })

  test("pure pattern passes through", () => {
    const input = "Buffer binding must precede dispatch on all Metal devices"
    expect(extractPattern(input)).toContain(input)
  })

  test("handles method call with dot notation", () => {
    const input = "GPU crash from `encoder.setBuffer` not being called before `encoder.dispatch`"
    const result = extractPattern(input)
    expect(result).toContain("buffer binding")
    expect(result).toContain("compute dispatch")
  })
})

describe("containsCode", () => {
  test("backtick code is detected", () => {
    expect(containsCode("Call `encoder.setBuffer` before dispatch")).toBe(true)
  })

  test("bare method call is detected", () => {
    expect(containsCode("The crash is in dispatchThreadgroups() without buffer binding")).toBe(true)
  })

  test("pure pattern returns false", () => {
    expect(containsCode("Unbound buffer access causes GPU timeout")).toBe(false)
  })
})

describe("ensurePatternClaims", () => {
  test("pattern claims pass through unchanged", () => {
    const claims = [makeClaim("Unbound buffer access causes GPU timeout")]
    const result = ensurePatternClaims(claims)
    expect(result[0].statement).toBe(claims[0].statement)
    expect(result[0].confidence).toBe(0.8)
  })

  test("code claims are transformed with role analysis", () => {
    const claims = [makeClaim("Fix: `encoder.setBuffer` before `encoder.dispatch`")]
    const result = ensurePatternClaims(claims)
    expect(result[0].statement).toContain("buffer binding")
    expect(result[0].statement).toContain("compute dispatch")
    expect(result[0].confidence).toBeLessThanOrEqual(0.65)
  })

  test("multiple claims handled", () => {
    const claims = [
      makeClaim("Pure pattern about buffer safety"),
      makeClaim("Fix: `buffer.bind()` before dispatch"),
    ]
    const result = ensurePatternClaims(claims)
    expect(result[0].statement).toBe(claims[0].statement)
    expect(result[1].statement).not.toBe(claims[1].statement)
  })
})

describe("validatePatternClaims", () => {
  test("warnings for code claims", () => {
    const claims = [makeClaim("Pure"), makeClaim("Fix: `encoder.setBuffer` before dispatch")]
    const result = validatePatternClaims(claims)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("engineering roles")
  })

  test("no warnings for clean claims", () => {
    const claims = [makeClaim("Pure pattern"), makeClaim("Another pattern")]
    const result = validatePatternClaims(claims)
    expect(result.warnings).toHaveLength(0)
  })
})

describe("mapCodeToRole", () => {
  test("maps known identifiers", () => {
    const r = mapCodeToRole("setBuffer")
    expect(r).not.toBeNull()
    expect(r!.role).toBe("buffer binding")
  })

  test("maps prefixed methods", () => {
    const r = mapCodeToRole("validateInput")
    expect(r).not.toBeNull()
    expect(r!.role).toBe("validation step")
  })

  test("strips namespace prefixes", () => {
    const r = mapCodeToRole("encoder.setBuffer")
    expect(r).not.toBeNull()
    expect(r!.role).toBe("buffer binding")
  })

  test("unknown identifiers return null", () => {
    expect(mapCodeToRole("xyzzy")).toBeNull()
  })
})
