/**
 * Tests for Git-based source materialization.
 */

import { describe, it, expect } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

import {
  resolveCommitHash,
  computeSourceDigest,
  fileDigest,
  buildSourceManifest,
  validatePathInRoot,
  scanSourceFiles,
} from "../source-materializer"
import type { SourceFileEntry } from "../live-types"

// ── resolveCommitHash ──────────────────────────────────────────────────────

describe("resolveCommitHash", () => {
  it("produces a 40-character hex hash for HEAD", async () => {
    const hash = await resolveCommitHash(process.cwd(), "HEAD")
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
  })

  it("produces a 40-character hex hash for a specific ref like HEAD~0", async () => {
    const hash = await resolveCommitHash(process.cwd(), "HEAD")
    expect(hash.length).toBe(40)
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
  })
})

// ── computeSourceDigest ────────────────────────────────────────────────────

describe("computeSourceDigest", () => {
  const fileA: SourceFileEntry = { path: "a.ts", mode: "644", digest: createHash("sha256").update("a").digest("hex") }
  const fileB: SourceFileEntry = { path: "b.ts", mode: "644", digest: createHash("sha256").update("b").digest("hex") }

  it("produces a deterministic digest for the same files", () => {
    const d1 = computeSourceDigest([fileA, fileB])
    const d2 = computeSourceDigest([fileA, fileB])
    expect(d1).toBe(d2)
  })

  it("produces the same digest regardless of input order (sorts by path)", () => {
    const d1 = computeSourceDigest([fileB, fileA])
    const d2 = computeSourceDigest([fileA, fileB])
    expect(d1).toBe(d2)
    expect(d1).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes when file content differs", () => {
    const fileA_alt: SourceFileEntry = { path: "a.ts", mode: "644", digest: createHash("sha256").update("different").digest("hex") }
    const d1 = computeSourceDigest([fileA, fileB])
    const d2 = computeSourceDigest([fileA_alt, fileB])
    expect(d1).not.toBe(d2)
  })

  it("changes when file count differs", () => {
    const d1 = computeSourceDigest([fileA, fileB])
    const d2 = computeSourceDigest([fileA])
    expect(d1).not.toBe(d2)
  })

  it("returns a 64-character hex string", () => {
    const d = computeSourceDigest([fileA, fileB])
    expect(d).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── fileDigest ─────────────────────────────────────────────────────────────

describe("fileDigest", () => {
  it("produces a correct SHA-256 hex digest for a known input", () => {
    const data = new TextEncoder().encode("hello")
    const expected = createHash("sha256").update("hello").digest("hex")
    expect(fileDigest(data)).toBe(expected)
  })

  it("produces deterministic results", () => {
    const data = new TextEncoder().encode("deterministic test content")
    expect(fileDigest(data)).toBe(fileDigest(data))
  })

  it("handles empty data", () => {
    const data = new Uint8Array(0)
    const expected = createHash("sha256").update(data).digest("hex")
    expect(fileDigest(data)).toBe(expected)
  })

  it("returns a 64-character hex string", () => {
    const data = new TextEncoder().encode("test")
    expect(fileDigest(data)).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── validatePathInRoot ─────────────────────────────────────────────────────

describe("validatePathInRoot", () => {
  const root = "/home/user/sandbox"

  it("accepts a path within the root", () => {
    expect(validatePathInRoot("/home/user/sandbox/src/file.ts", root)).toBe(true)
  })

  it("accepts the root directory itself", () => {
    expect(validatePathInRoot(root, root)).toBe(true)
  })

  it("rejects a path outside the root", () => {
    expect(validatePathInRoot("/home/user/other/file.ts", root)).toBe(false)
  })

  it("rejects path traversal attempts", () => {
    expect(validatePathInRoot("/home/user/sandbox/../../etc/passwd", root)).toBe(false)
  })

  it("accepts deeply nested paths within the root", () => {
    expect(validatePathInRoot("/home/user/sandbox/a/b/c/d/e/f.ts", root)).toBe(true)
  })

  it("rejects paths with same prefix but outside root", () => {
    // /home/user/sandbox-other is not under /home/user/sandbox
    expect(validatePathInRoot("/home/user/sandbox-other/evil.ts", root)).toBe(false)
  })

  it("rejects paths with no common prefix", () => {
    expect(validatePathInRoot("/var/log/audit", root)).toBe(false)
  })

  it("accepts relative paths that resolve inside root", () => {
    const absRoot = path.resolve(".")
    expect(validatePathInRoot("src/file.ts", absRoot)).toBe(true)
  })
})

// ── scanSourceFiles ────────────────────────────────────────────────────────

describe("scanSourceFiles", () => {
  it("scans files in a directory recursively", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-scan-test-"))
    try {
      await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true })
      await fs.writeFile(path.join(tmpDir, "root.txt"), "root")
      await fs.writeFile(path.join(tmpDir, "sub", "nested.txt"), "nested")

      const files = await scanSourceFiles(tmpDir)
      const paths = files.map((f) => f.path).sort()
      expect(paths).toEqual(["root.txt", path.posix.join("sub", "nested.txt")])
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("skips node_modules and .git directories", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-scan-skip-"))
    try {
      await fs.mkdir(path.join(tmpDir, "node_modules", "pkg"), { recursive: true })
      await fs.mkdir(path.join(tmpDir, ".git", "objects"), { recursive: true })
      await fs.writeFile(path.join(tmpDir, "node_modules", "pkg", "index.js"), "skip")
      await fs.writeFile(path.join(tmpDir, ".git", "HEAD"), "ref")
      await fs.writeFile(path.join(tmpDir, "keep.txt"), "keep")

      const files = await scanSourceFiles(tmpDir)
      const paths = files.map((f) => f.path)
      expect(paths).toEqual(["keep.txt"])
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("computes a digest for each file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-scan-digest-"))
    try {
      await fs.writeFile(path.join(tmpDir, "hello.txt"), "world")
      const files = await scanSourceFiles(tmpDir)
      expect(files).toHaveLength(1)
      expect(files[0].digest).toMatch(/^[0-9a-f]{64}$/)
      expect(files[0].path).toBe("hello.txt")
      expect(files[0].mode).toBeTruthy()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

// ── buildSourceManifest ────────────────────────────────────────────────────

describe("buildSourceManifest", () => {
  it("builds a manifest including all files in the directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-manifest-"))
    try {
      await fs.writeFile(path.join(tmpDir, "a.txt"), "aaa")
      await fs.writeFile(path.join(tmpDir, "b.txt"), "bbb")

      const manifest = await buildSourceManifest(tmpDir, "abcd1234abcd1234abcd1234abcd1234abcd1234", "repo-digest")
      expect(manifest.resolvedCommitHash).toBe("abcd1234abcd1234abcd1234abcd1234abcd1234")
      expect(manifest.totalFileCount).toBe(2)
      expect(manifest.totalBytes).toBe(6) // "aaa" + "bbb" = 6 bytes
      expect(manifest.files).toHaveLength(2)
      expect(manifest.manifestDigest).toMatch(/^[0-9a-f]{64}$/)
      expect(manifest.createdAt).toBeTruthy()
      expect(typeof manifest.createdAt).toBe("string")

      const paths = manifest.files.map((f) => f.path).sort()
      expect(paths).toEqual(["a.txt", "b.txt"])
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("produces an empty manifest for an empty directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-manifest-empty-"))
    try {
      const manifest = await buildSourceManifest(tmpDir, "abcd1234abcd1234abcd1234abcd1234abcd1234", "")
      expect(manifest.totalFileCount).toBe(0)
      expect(manifest.totalBytes).toBe(0)
      expect(manifest.files).toEqual([])
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("includes correct digests per file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dharma-manifest-digest-"))
    try {
      await fs.writeFile(path.join(tmpDir, "data.bin"), "content")
      const manifest = await buildSourceManifest(tmpDir, "0000000000000000000000000000000000000000", "x")
      expect(manifest.files).toHaveLength(1)
      const expectedDigest = createHash("sha256").update("content").digest("hex")
      expect(manifest.files[0].digest).toBe(expectedDigest)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
