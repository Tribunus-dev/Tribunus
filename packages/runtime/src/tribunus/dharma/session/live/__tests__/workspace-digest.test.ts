/**
 * Tests for deterministic workspace digest computation.
 */

import { describe, it, expect } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

import {
  computeWorkspaceDigest,
  digestFromEntries,
  hashBytes,
  shouldExcludeFromDigest,
  collectFileEntries,
  type FileDigestEntry,
} from "../workspace-digest"

// ── computeWorkspaceDigest ─────────────────────────────────────────────────

describe("computeWorkspaceDigest", () => {
  it("produces a digest for a directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-wd-"))
    try {
      await fs.writeFile(path.join(tmpDir, "file.txt"), "hello")
      const result = await computeWorkspaceDigest(tmpDir)
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/)
      expect(result.entries).toHaveLength(1)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("produces deterministic results", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-wd-det-"))
    try {
      await fs.writeFile(path.join(tmpDir, "a.txt"), "content")
      const r1 = await computeWorkspaceDigest(tmpDir)
      const r2 = await computeWorkspaceDigest(tmpDir)
      expect(r1.digest).toBe(r2.digest)
      expect(r1.entries).toEqual(r2.entries)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("digest changes when file content changes", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-wd-change-"))
    try {
      await fs.writeFile(path.join(tmpDir, "f.txt"), "original")
      const r1 = await computeWorkspaceDigest(tmpDir)
      await fs.writeFile(path.join(tmpDir, "f.txt"), "modified")
      const r2 = await computeWorkspaceDigest(tmpDir)
      expect(r1.digest).not.toBe(r2.digest)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("digest changes when files are added", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-wd-add-"))
    try {
      await fs.writeFile(path.join(tmpDir, "f.txt"), "data")
      const r1 = await computeWorkspaceDigest(tmpDir)
      await fs.writeFile(path.join(tmpDir, "g.txt"), "more")
      const r2 = await computeWorkspaceDigest(tmpDir)
      expect(r1.digest).not.toBe(r2.digest)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("returns entries in sorted order irrespective of filesystem order", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-wd-sort-"))
    try {
      await fs.writeFile(path.join(tmpDir, "z_last.txt"), "z")
      await fs.writeFile(path.join(tmpDir, "a_first.txt"), "a")
      const result = await computeWorkspaceDigest(tmpDir)
      expect(result.entries[0].relativePath).toBe("a_first.txt")
      expect(result.entries[1].relativePath).toBe("z_last.txt")
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

// ── digestFromEntries ──────────────────────────────────────────────────────

describe("digestFromEntries", () => {
  const entryA: FileDigestEntry = { relativePath: "a.ts", mode: "644", digest: "abc" }
  const entryB: FileDigestEntry = { relativePath: "b.ts", mode: "644", digest: "def" }

  it("is deterministic for the same entries in the same order", () => {
    const d1 = digestFromEntries([entryA, entryB])
    const d2 = digestFromEntries([entryA, entryB])
    expect(d1).toBe(d2)
  })

  it("changes when entries are reordered (no internal sort)", () => {
    const d1 = digestFromEntries([entryA, entryB])
    const d2 = digestFromEntries([entryB, entryA])
    expect(d1).not.toBe(d2)
  })

  it("changes when entry content differs", () => {
    const d1 = digestFromEntries([entryA, entryB])
    const entryA_alt: FileDigestEntry = { relativePath: "a.ts", mode: "644", digest: "xyz" }
    const d2 = digestFromEntries([entryA_alt, entryB])
    expect(d1).not.toBe(d2)
  })

  it("returns a 64-character hex string", () => {
    const d = digestFromEntries([entryA])
    expect(d).toMatch(/^[0-9a-f]{64}$/)
  })

  it("handles an empty entry list", () => {
    const d = digestFromEntries([])
    expect(d).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── hashBytes ──────────────────────────────────────────────────────────────

describe("hashBytes", () => {
  it("produces the correct SHA-256 hex for a known input", () => {
    const data = new TextEncoder().encode("hello")
    const expected = createHash("sha256").update("hello").digest("hex")
    expect(hashBytes(data)).toBe(expected)
  })

  it("produces deterministic results", () => {
    const data = new TextEncoder().encode("test data")
    expect(hashBytes(data)).toBe(hashBytes(data))
  })

  it("handles empty data", () => {
    const data = new Uint8Array(0)
    const expected = createHash("sha256").update(data).digest("hex")
    expect(hashBytes(data)).toBe(expected)
  })

  it("returns a 64-character hex string", () => {
    const data = new TextEncoder().encode("anything")
    expect(hashBytes(data)).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── shouldExcludeFromDigest ────────────────────────────────────────────────

describe("shouldExcludeFromDigest", () => {
  it("excludes node_modules directory", () => {
    expect(shouldExcludeFromDigest("node_modules")).toBe(true)
    expect(shouldExcludeFromDigest("path/to/node_modules")).toBe(true)
    expect(shouldExcludeFromDigest("node_modules/package/index.js")).toBe(true)
  })

  it("excludes .git directory", () => {
    expect(shouldExcludeFromDigest(".git")).toBe(true)
    expect(shouldExcludeFromDigest(".git/HEAD")).toBe(true)
    expect(shouldExcludeFromDigest("repo/.git/objects/ab")).toBe(true)
  })

  it("excludes .DS_Store files", () => {
    expect(shouldExcludeFromDigest(".DS_Store")).toBe(true)
    expect(shouldExcludeFromDigest("src/.DS_Store")).toBe(true)
  })

  it("excludes Thumbs.db files", () => {
    expect(shouldExcludeFromDigest("Thumbs.db")).toBe(true)
  })

  it("excludes log files", () => {
    expect(shouldExcludeFromDigest("server.log")).toBe(true)
    expect(shouldExcludeFromDigest("logs/app.log")).toBe(true)
  })

  it("excludes socket files", () => {
    expect(shouldExcludeFromDigest("run.socket")).toBe(true)
    expect(shouldExcludeFromDigest("var/run/service.socket")).toBe(true)
  })

  it("includes regular source files", () => {
    expect(shouldExcludeFromDigest("src/main.ts")).toBe(false)
    expect(shouldExcludeFromDigest("package.json")).toBe(false)
    expect(shouldExcludeFromDigest("README.md")).toBe(false)
    expect(shouldExcludeFromDigest("src/components/Button.tsx")).toBe(false)
  })

  it("includes files with .txt and .json extensions", () => {
    expect(shouldExcludeFromDigest("data.json")).toBe(false)
    expect(shouldExcludeFromDigest("notes.txt")).toBe(false)
  })

  it("does not exclude temporary directories named 'tmp'", () => {
    expect(shouldExcludeFromDigest("tmp")).toBe(true)
    expect(shouldExcludeFromDigest("some/tmp/file.txt")).toBe(true)
  })

  it("does not exclude paths containing 'tmp' as a substring", () => {
    expect(shouldExcludeFromDigest("contemporary-art.ts")).toBe(false)
  })
})

// ── collectFileEntries ─────────────────────────────────────────────────────

describe("collectFileEntries", () => {
  it("collects files recursively", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-collect-"))
    try {
      await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true })
      await fs.writeFile(path.join(tmpDir, "root.txt"), "root")
      await fs.writeFile(path.join(tmpDir, "sub", "nested.txt"), "nested")

      const entries = await collectFileEntries(tmpDir)
      expect(entries).toHaveLength(2)
      const paths = entries.map((e) => e.relativePath).sort()
      expect(paths).toEqual(["root.txt", "sub/nested.txt"])
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("skips excluded directories", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-collect-skip-"))
    try {
      await fs.mkdir(path.join(tmpDir, "node_modules", "pkg"), { recursive: true })
      await fs.mkdir(path.join(tmpDir, ".git", "objects"), { recursive: true })
      await fs.writeFile(path.join(tmpDir, "keep.txt"), "keep")
      await fs.writeFile(path.join(tmpDir, "node_modules", "pkg", "index.js"), "skip")
      await fs.writeFile(path.join(tmpDir, ".git", "HEAD"), "ref")

      const entries = await collectFileEntries(tmpDir)
      expect(entries).toHaveLength(1)
      expect(entries[0].relativePath).toBe("keep.txt")
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("computes digests for each collected file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-collect-digest-"))
    try {
      await fs.writeFile(path.join(tmpDir, "data.bin"), "hello world")
      const entries = await collectFileEntries(tmpDir)
      expect(entries).toHaveLength(1)
      expect(entries[0].relativePath).toBe("data.bin")
      expect(entries[0].digest).toMatch(/^[0-9a-f]{64}$/)
      expect(entries[0].mode).toBeTruthy()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("returns empty array for an empty directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-collect-empty-"))
    try {
      const entries = await collectFileEntries(tmpDir)
      expect(entries).toEqual([])
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("uses POSIX-separator relative paths", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-collect-posix-"))
    try {
      await fs.mkdir(path.join(tmpDir, "deeply", "nested"), { recursive: true })
      await fs.writeFile(path.join(tmpDir, "deeply", "nested", "leaf.txt"), "leaf")
      const entries = await collectFileEntries(tmpDir)
      expect(entries[0].relativePath).toBe("deeply/nested/leaf.txt")
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
