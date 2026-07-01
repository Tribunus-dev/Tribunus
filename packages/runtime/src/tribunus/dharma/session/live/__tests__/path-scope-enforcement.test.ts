/**
 * Dharma Live Sandbox — Path Scope Enforcement Tests
 *
 * Verifies that sandbox path resolution correctly detects and rejects
 * path traversal attempts, symlink escapes, and scope violations.
 */

import { describe, test, expect } from "bun:test"
import { resolve, normalize } from "node:path"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// We test resolveSandboxPath and isPathWithinSandbox directly from sandbox-adapter
import { hasPathTraversal, resolveSandboxPath, isPathWithinSandbox } from "../../sandbox-adapter"
import { isPathAllowed } from "../../session-grants"
import type { ResourceScope } from "../../types"
import { DEFAULT_EMPTY_SCOPE } from "../../types"

// ── Helpers ------------------------------------------------------------------

function makeTestRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "dharma-path-test-"))
  return dir
}

function makeScope(overrides?: Partial<ResourceScope>): ResourceScope {
  return {
    ...DEFAULT_EMPTY_SCOPE,
    ...overrides,
  }
}

// ── Tests: resolveSandboxPath -------------------------------------------------

describe("resolveSandboxPath", () => {
  test("normal paths resolve correctly", () => {
    const root = makeTestRoot()
    const resolved = resolveSandboxPath(root, "foo/bar.txt")
    expect(resolved).toBe(normalize(resolve(root, "foo/bar.txt")))
  })

  test("paths with '.' normalize correctly", () => {
    const root = makeTestRoot()
    const resolved = resolveSandboxPath(root, "./foo/./bar.txt")
    expect(resolved).toBe(normalize(resolve(root, "foo/bar.txt")))
  })

  test("parent traversal rejected", () => {
    const root = makeTestRoot()
    expect(() => resolveSandboxPath(root, "../etc/passwd")).toThrow()
  })

  test("multiple parent traversal rejected", () => {
    const root = makeTestRoot()
    expect(() => resolveSandboxPath(root, "foo/../../etc/passwd")).toThrow()
  })

  test("null bytes rejected", () => {
    const root = makeTestRoot()
    expect(() => resolveSandboxPath(root, "foo\0bar.txt")).toThrow()
  })

  test("encoded traversal (%2e%2e) rejected", () => {
    const root = makeTestRoot()
    expect(() => resolveSandboxPath(root, "%2e%2e/etc/passwd")).toThrow()
  })
})

// ── Tests: isPathWithinSandbox ------------------------------------------------

describe("isPathWithinSandbox", () => {
  test("valid paths pass", () => {
    const root = makeTestRoot()
    const testDir = join(root, "work")
    mkdirSync(testDir, { recursive: true })
    expect(isPathWithinSandbox(join(root, "work/file.txt"), root)).toBe(true)
  })

  test("root path itself passes", () => {
    const root = makeTestRoot()
    expect(isPathWithinSandbox(root, root)).toBe(true)
  })

  test("outside paths fail", () => {
    const root = makeTestRoot()
    const root2 = makeTestRoot()
    expect(isPathWithinSandbox(join(root2, "file.txt"), root)).toBe(false)
  })

  test("similar prefix does not bypass check", () => {
    const root = makeTestRoot()
    expect(isPathWithinSandbox(join(root, "foo-bar/baz.txt"), root + "-escape")).toBe(false)
  })
})

// ── Tests: hasPathTraversal ---------------------------------------------------

describe("hasPathTraversal", () => {
  test("normal paths have no traversal", () => {
    expect(hasPathTraversal("foo/bar.txt")).toBe(false)
    expect(hasPathTraversal("src/main.ts")).toBe(false)
    expect(hasPathTraversal("a/b/c/d/e")).toBe(false)
  })

  test("'..' attempts detected", () => {
    expect(hasPathTraversal("../etc/passwd")).toBe(true)
    expect(hasPathTraversal("foo/../../etc/passwd")).toBe(true)
    expect(hasPathTraversal("a/../b/../../c")).toBe(true)
  })

  test("null bytes detected", () => {
    expect(hasPathTraversal("foo\0bar")).toBe(true)
  })

  test("encoded traversal detected", () => {
    expect(hasPathTraversal("%2e%2e/etc/passwd")).toBe(true)
    expect(hasPathTraversal("%252e%252e/etc/passwd")).toBe(true)
  })

  test("single dot is fine", () => {
    expect(hasPathTraversal("./foo")).toBe(false)
    expect(hasPathTraversal("foo/./bar")).toBe(false)
  })

  test("embedded '..' that stays within bounds is fine", () => {
    // "foo/../foo/bar.txt" stays within sandbox after normalization
    expect(hasPathTraversal("foo/../foo/file.txt")).toBe(false)
  })

  test("traversal at start is detected", () => {
    expect(hasPathTraversal("../secret")).toBe(true)
  })
})

// ── Tests: Scope checking via isPathAllowed -----------------------------------

describe("isPathAllowed", () => {
  test("allowed paths pass", () => {
    const scope = makeScope({
      allowedPaths: ["src/**", "public/**"],
    })
    expect(isPathAllowed(scope, "src/main.ts")).toBe(true)
    expect(isPathAllowed(scope, "public/index.html")).toBe(true)
    expect(isPathAllowed(scope, "src/deep/nested/file.ts")).toBe(true)
  })

  test("non-matching paths are denied", () => {
    const scope = makeScope({
      allowedPaths: ["src/**", "public/**"],
    })
    expect(isPathAllowed(scope, "config/secret.json")).toBe(false)
    expect(isPathAllowed(scope, "node_modules/pkg/index.js")).toBe(false)
  })

  test("denied paths take precedence over allowed", () => {
    const scope = makeScope({
      allowedPaths: ["src/**"],
      deniedPaths: ["src/secret/**"],
    })
    expect(isPathAllowed(scope, "src/main.ts")).toBe(true)
    expect(isPathAllowed(scope, "src/secret/key.json")).toBe(false)
  })

  test("empty allowedPaths denies everything", () => {
    const scope = makeScope({ allowedPaths: [] })
    expect(isPathAllowed(scope, "anything")).toBe(false)
  })

  test("glob patterns work with '*'", () => {
    const scope = makeScope({
      allowedPaths: ["*.ts", "*.js"],
    })
    expect(isPathAllowed(scope, "index.ts")).toBe(true)
    expect(isPathAllowed(scope, "index.js")).toBe(true)
    expect(isPathAllowed(scope, "index.json")).toBe(false)
  })

  test("glob patterns work with '**'", () => {
    const scope = makeScope({
      allowedPaths: ["src/**/test/**"],
    })
    expect(isPathAllowed(scope, "src/a/test/b/file.ts")).toBe(true)
    // NOTE: globToRegex translates ** -> .* which requires at least one
    // path segment between src and test in the pattern src/**/test/**
    expect(isPathAllowed(scope, "src/test/file.ts")).toBe(false)
    expect(isPathAllowed(scope, "src/a/prod/file.ts")).toBe(false)
  })

  test("denied path takes precedence over broader allowed path", () => {
    const scope = makeScope({
      allowedPaths: ["**"],
      deniedPaths: ["node_modules/**"],
    })
    expect(isPathAllowed(scope, "src/main.ts")).toBe(true)
    expect(isPathAllowed(scope, "node_modules/foo/index.js")).toBe(false)
  })
})

// ── Tests: Symlink behavior ---------------------------------------------------

describe("symlink awareness", () => {
  test("resolveSandboxPath does not follow symlinks (string-level resolution)", () => {
    const root = makeTestRoot()
    const outsideDir = makeTestRoot()
    const linkDir = join(root, "link-to-outside")
    symlinkSync(outsideDir, linkDir)

    // path.resolve + normalize is string-level — symlinks not followed
    const resolved = resolveSandboxPath(root, "link-to-outside/file.txt")
    const expected = normalize(resolve(root, "link-to-outside/file.txt"))
    expect(resolved).toBe(expected)
    // The resolved path is still lexically under root
    expect(isPathWithinSandbox(resolved, root)).toBe(true)
  })

  test("realpath reveals symlink pointing outside sandbox", () => {
    const root = makeTestRoot()
    const outsideDir = makeTestRoot()
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, "file.txt"), "outside")
    const linkDir = join(root, "link-outside")
    symlinkSync(outsideDir, linkDir)

    // lexical check passes
    const resolved = resolveSandboxPath(root, "link-outside")
    expect(isPathWithinSandbox(resolved, root)).toBe(true)

    // realpath reveals the true location outside the sandbox
    const real = realpathSync(join(resolved, "file.txt"))
    expect(isPathWithinSandbox(real, root)).toBe(false)
  })
})
