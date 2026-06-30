/**
 * Tests for Dharma Live Sandbox — Patch Validator
 */

import { describe, it, expect } from "bun:test"
import {
  validateChangedPaths,
  validatePatchSize,
  validateFileCount,
  validateNoProtectedFiles,
  validateBinaryPolicy,
} from "../patch-validator"
import type { PatchChange } from "../patch-builder"
import type { ResourceScope } from "../../types"
import { DEFAULT_EMPTY_SCOPE } from "../../types"

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChange(overrides?: Partial<PatchChange>): PatchChange {
  return {
    path: "src/index.ts",
    kind: "modify",
    beforeDigest: "abc123",
    afterDigest: "def456",
    content: new Uint8Array([1, 2, 3]),
    ...overrides,
  }
}

function makeScope(overrides?: Partial<ResourceScope>): ResourceScope {
  return {
    ...DEFAULT_EMPTY_SCOPE,
    ...overrides,
  }
}

// ── validateChangedPaths ───────────────────────────────────────────────────

describe("validateChangedPaths", () => {
  it("allows paths that are in scope", () => {
    const scope = makeScope({
      allowedPaths: ["src/**"],
    })
    const changes: PatchChange[] = [
      makeChange({ path: "src/index.ts" }),
      makeChange({ path: "src/utils/helper.ts" }),
    ]

    const errors = validateChangedPaths(changes, scope)
    expect(errors.length).toBe(0)
  })

  it("rejects paths that are not in scope", () => {
    const scope = makeScope({
      allowedPaths: ["src/**"],
    })
    const changes: PatchChange[] = [
      makeChange({ path: "src/index.ts" }),
      makeChange({ path: "node_modules/evil.js" }),
    ]

    const errors = validateChangedPaths(changes, scope)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("node_modules/evil.js")
  })

  it("rejects paths in denied list even if in allowed", () => {
    const scope = makeScope({
      allowedPaths: ["**"],
      deniedPaths: ["secrets/**"],
    })
    const changes: PatchChange[] = [
      makeChange({ path: "secrets/keys.json" }),
    ]

    const errors = validateChangedPaths(changes, scope)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("secrets/keys.json")
  })
})

// ── validatePatchSize ──────────────────────────────────────────────────────

describe("validatePatchSize", () => {
  it("accepts patches within the size limit", () => {
    const changes: PatchChange[] = [
      makeChange({ content: new Uint8Array(500) }),
      makeChange({ content: new Uint8Array(400) }),
    ]

    expect(validatePatchSize(changes, 1000)).toBe(true)
  })

  it("rejects oversized patches", () => {
    const changes: PatchChange[] = [
      makeChange({ content: new Uint8Array(500) }),
      makeChange({ content: new Uint8Array(600) }),
    ]

    expect(validatePatchSize(changes, 1000)).toBe(false)
  })

  it("handles delete changes (null content)", () => {
    const changes: PatchChange[] = [
      makeChange({ kind: "delete", content: null }),
      makeChange({ content: new Uint8Array(300) }),
    ]

    expect(validatePatchSize(changes, 300)).toBe(true)
  })

  it("rejects when exactly at limit boundary", () => {
    const changes: PatchChange[] = [
      makeChange({ content: new Uint8Array(100) }),
    ]

    expect(validatePatchSize(changes, 99)).toBe(false)
  })
})

// ── validateFileCount ──────────────────────────────────────────────────────

describe("validateFileCount", () => {
  it("accepts patches with file count within limit", () => {
    const changes = Array.from({ length: 5 }, () => makeChange())

    expect(validateFileCount(changes, 10)).toBe(true)
  })

  it("rejects patches with too many files", () => {
    const changes = Array.from({ length: 15 }, () => makeChange())

    expect(validateFileCount(changes, 10)).toBe(false)
  })

  it("accepts patches with exactly the max file count", () => {
    const changes = Array.from({ length: 10 }, () => makeChange())

    expect(validateFileCount(changes, 10)).toBe(true)
  })
})

// ── validateNoProtectedFiles ───────────────────────────────────────────────

describe("validateNoProtectedFiles", () => {
  it("detects protected paths in changes", () => {
    const changes: PatchChange[] = [
      makeChange({ path: ".env" }),
    ]

    const errors = validateNoProtectedFiles(changes, [".env"])
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain(".env")
  })

  it("allows non-protected paths", () => {
    const changes: PatchChange[] = [
      makeChange({ path: "src/index.ts" }),
      makeChange({ path: "README.md" }),
    ]

    const errors = validateNoProtectedFiles(changes, [".env", ".git/"])
    expect(errors.length).toBe(0)
  })

  it("detects nested protected paths", () => {
    const changes: PatchChange[] = [
      makeChange({ path: ".git/config" }),
      makeChange({ path: ".git/HEAD" }),
    ]

    const errors = validateNoProtectedFiles(changes, [".git/"])
    expect(errors.length).toBe(2)
  })

  it("handles multiple protected patterns", () => {
    const changes: PatchChange[] = [
      makeChange({ path: ".env.local" }),
      makeChange({ path: "node_modules/foo/index.js" }),
      makeChange({ path: "src/main.ts" }),
    ]

    const errors = validateNoProtectedFiles(changes, [".env", "node_modules/"])
    expect(errors.length).toBe(2)
  })
})

// ── validateBinaryPolicy ───────────────────────────────────────────────────

describe("validateBinaryPolicy", () => {
  it("rejects binary file extensions when not allowed", () => {
    const changes: PatchChange[] = [
      makeChange({ path: "image.png", content: new Uint8Array([137, 80, 78, 71]) }),
    ]

    const errors = validateBinaryPolicy(changes, false)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("image.png")
  })

  it("accepts binary files when allowed", () => {
    const changes: PatchChange[] = [
      makeChange({ path: "image.png", content: new Uint8Array([137, 80, 78, 71]) }),
    ]

    const errors = validateBinaryPolicy(changes, true)
    expect(errors.length).toBe(0)
  })

  it("rejects content that contains null bytes (binary content)", () => {
    const buf = new Uint8Array(100)
    buf[50] = 0 // Null byte at position 50
    const changes: PatchChange[] = [
      makeChange({ path: "output.txt", content: buf }),
    ]

    const errors = validateBinaryPolicy(changes, false)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("output.txt")
  })

  it("accepts text files when binary not allowed", () => {
    const content = new TextEncoder().encode("Hello, world!")
    const changes: PatchChange[] = [
      makeChange({ path: "hello.txt", content }),
    ]

    const errors = validateBinaryPolicy(changes, false)
    expect(errors.length).toBe(0)
  })

  it("handles delete changes (no content)", () => {
    const changes: PatchChange[] = [
      makeChange({ kind: "delete", path: "image.png", content: null }),
    ]

    const errors = validateBinaryPolicy(changes, false)
    expect(errors.length).toBe(0)
  })
})
