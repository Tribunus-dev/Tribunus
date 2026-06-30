/**
 * Tests for Dharma Live Sandbox — Process Policy
 */

import { describe, it, expect } from "bun:test"
import {
  checkCommandPolicy,
  requiresShell,
  hasUnsafeShellChars,
  isWorkingDirAllowed,
} from "../process-policy"
import type { ResourceScope } from "../../types"
import { DEFAULT_EMPTY_SCOPE } from "../../types"

// ── Helpers ────────────────────────────────────────────────────────────────

function makeScope(overrides?: Partial<ResourceScope>): ResourceScope {
  return {
    ...DEFAULT_EMPTY_SCOPE,
    ...overrides,
  }
}

// ── checkCommandPolicy ─────────────────────────────────────────────────────

describe("checkCommandPolicy", () => {
  it("allows commands that are in the allowed scope", () => {
    const scope = makeScope({
      allowedCommands: ["npm ", "node ", "npx "],
    })

    const result = checkCommandPolicy("npm", ["test"], scope)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.parsedCommand).toBe("npm")
    expect(result.parsedArgs).toEqual(["test"])
  })

  it("rejects commands that are not in the allowed scope", () => {
    const scope = makeScope({
      allowedCommands: ["npm ", "node "],
    })

    const result = checkCommandPolicy("rm", ["-rf", "/"], scope)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("rm")
  })

  it("allows 'npm test' when npm is allowed prefix", () => {
    const scope = makeScope({
      allowedCommands: ["npm "],
    })

    const result = checkCommandPolicy("npm", ["test"], scope)
    expect(result.allowed).toBe(true)
  })

  it("rejects 'npm install' when in the denied list", () => {
    const scope = makeScope({
      allowedCommands: ["npm "],
      deniedCommands: ["npm install"],
    })

    const result = checkCommandPolicy("npm", ["install"], scope)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("npm install")
  })

  it("rejects shell built-in commands", () => {
    const scope = makeScope({
      allowedCommands: ["cd ", "echo "],
    })

    const result = checkCommandPolicy("cd", ["/tmp"], scope)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("requires a shell")
  })

  it("rejects commands with unsafe shell metacharacters in args", () => {
    const scope = makeScope({
      allowedCommands: ["npm ", "echo "],
    })

    const result = checkCommandPolicy("echo", ["hello; rm -rf /"], scope)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("shell metacharacters")
  })

  it("allows commands with safe arguments containing dots and slashes", () => {
    const scope = makeScope({
      allowedCommands: ["node "],
    })

    const result = checkCommandPolicy(
      "node",
      ["./src/index.ts", "--port=3000"],
      scope,
    )
    expect(result.allowed).toBe(true)
  })
})

// ── requiresShell ──────────────────────────────────────────────────────────

describe("requiresShell", () => {
  it("detects 'cd' as shell-dependent", () => {
    expect(requiresShell("cd")).toBe(true)
  })

  it("detects 'export' as shell-dependent", () => {
    expect(requiresShell("export")).toBe(true)
  })

  it("detects 'source' as shell-dependent", () => {
    expect(requiresShell("source")).toBe(true)
  })

  it("detects 'eval' as shell-dependent", () => {
    expect(requiresShell("eval")).toBe(true)
  })

  it("returns false for regular executables", () => {
    expect(requiresShell("npm")).toBe(false)
    expect(requiresShell("node")).toBe(false)
    expect(requiresShell("git")).toBe(false)
  })

  it("handles full paths to commands", () => {
    expect(requiresShell("/usr/bin/cd")).toBe(true)
    expect(requiresShell("/usr/local/bin/npm")).toBe(false)
  })
})

// ── hasUnsafeShellChars ────────────────────────────────────────────────────

describe("hasUnsafeShellChars", () => {
  it("returns false for safe arguments", () => {
    expect(hasUnsafeShellChars(["test", "--flag", "value"])).toBe(false)
    expect(hasUnsafeShellChars(["./script.ts"])).toBe(false)
    expect(hasUnsafeShellChars(["run", "dev"])).toBe(false)
  })

  it("detects semicolons in arguments", () => {
    expect(hasUnsafeShellChars(["hello; rm -rf"])).toBe(true)
  })

  it("detects pipes in arguments", () => {
    expect(hasUnsafeShellChars(["cat /etc/passwd | echo"])).toBe(true)
  })

  it("detects backticks in arguments", () => {
    expect(hasUnsafeShellChars(["`id`"])).toBe(true)
  })

  it("detects dollar sign in arguments", () => {
    expect(hasUnsafeShellChars(["$(cat /etc/passwd)"])).toBe(true)
  })

  it("detects newlines in arguments", () => {
    expect(hasUnsafeShellChars(["line1\nline2"])).toBe(true)
  })

  it("allows safe special characters like dots, slashes, dashes", () => {
    expect(hasUnsafeShellChars(["--name=value", "path/to/file.ts"])).toBe(false)
    expect(hasUnsafeShellChars(["@scope/package"])).toBe(false)
    expect(hasUnsafeShellChars(["file.test.ts"])).toBe(false)
  })
})

// ── isWorkingDirAllowed ────────────────────────────────────────────────────

describe("isWorkingDirAllowed", () => {
  it("accepts null working directory", () => {
    expect(isWorkingDirAllowed(null, "/sandbox/project")).toBe(true)
  })

  it("accepts empty working directory", () => {
    expect(isWorkingDirAllowed("", "/sandbox/project")).toBe(true)
  })

  it("accepts paths within the sandbox root", () => {
    expect(isWorkingDirAllowed("/sandbox/project/src", "/sandbox/project")).toBe(true)
  })

  it("rejects paths outside the sandbox root", () => {
    expect(isWorkingDirAllowed("/etc", "/sandbox/project")).toBe(false)
  })

  it("rejects paths that escape via '..'", () => {
    expect(isWorkingDirAllowed("/sandbox/project/../../etc", "/sandbox/project")).toBe(false)
  })

  it("accepts subdirectories of the sandbox root", () => {
    expect(isWorkingDirAllowed("/sandbox/project/src/utils", "/sandbox/project")).toBe(true)
  })

  it("rejects paths that don't start with sandbox root at all", () => {
    expect(isWorkingDirAllowed("/tmp/other", "/sandbox/project")).toBe(false)
  })
})
