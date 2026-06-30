/**
 * Dharma Live Sandbox — Overlay Filesystem Tests
 *
 * Verifies overlay creation, path scope enforcement, state transitions,
 * and file read/write operations.
 */

import { describe, test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

import {
  createOverlayFilesystem,
  isOverlayPathAllowed,
  transitionOverlayState,
  initOverlayFromCanonical,
  readOverlayFile,
  writeOverlayFile,
  getChangedFiles,
  VALID_OVERLAY_TRANSITIONS,
} from "../overlay-filesystem"
import type { OverlayFilesystem } from "../live-types"
import { ScopeViolationError } from "../live-errors"

// ── Helpers ------------------------------------------------------------------

function makeOverlayRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "dharma-overlay-test-"))
  return dir
}

function makeCanonicalDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dharma-canonical-test-"))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "index.ts"), 'console.log("hello")')
  writeFileSync(join(dir, "README.md"), "# Test")
  const nested = join(dir, "src")
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(nested, "main.ts"), 'export const x = 1')
  writeFileSync(join(nested, "utils.ts"), 'export const util = true')
  return dir
}

// ── Tests: createOverlayFilesystem -------------------------------------------

describe("createOverlayFilesystem", () => {
  test("creates valid overlay", async () => {
    const root = makeOverlayRoot()
    const overlayId = "overlay_test_001"
    const sessionId = "session_001"
    const membershipId = "member_001"
    const publicKey = "pk_test_abc"
    const baseDigest = "digest_base_abc123"

    const overlay = await createOverlayFilesystem({
      overlayId,
      sessionId,
      membershipId,
      ownerIdentityPublicKey: publicKey,
      overlayRoot: root,
      baseWorkspaceDigest: baseDigest,
      allowedPathScope: ["src/**", "*.ts"],
    })

    // Verify returned object
    expect(overlay.overlayId).toBe(overlayId)
    expect(overlay.sessionId).toBe(sessionId)
    expect(overlay.membershipId).toBe(membershipId)
    expect(overlay.ownerIdentityPublicKey).toBe(publicKey)
    expect(overlay.overlayRoot).toBe(root)
    expect(overlay.allowedPathScope).toEqual(["src/**", "*.ts"])
    expect(overlay.baseWorkspaceDigest).toBe(baseDigest)
    expect(overlay.currentDigest).toBe(baseDigest)
    expect(overlay.state).toBe("created")
    expect(overlay.createdAt).toBeTruthy()
    expect(overlay.updatedAt).toBeTruthy()
  })

  test("creates overlay directory on filesystem", async () => {
    const root = makeOverlayRoot()
    const overlayId = "overlay_test_002"

    await createOverlayFilesystem({
      overlayId,
      sessionId: "sess_1",
      membershipId: "m_1",
      ownerIdentityPublicKey: "pk_1",
      overlayRoot: root,
      baseWorkspaceDigest: "base",
      allowedPathScope: [],
    })

    // Verify .overlay.json was written
    const metaPath = join(root, ".overlay.json")
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
    expect(meta.overlayId).toBe(overlayId)
    expect(meta.state).toBe("created")
  })
})

// ── Tests: isOverlayPathAllowed -----------------------------------------------

describe("isOverlayPathAllowed", () => {
  test("allows matching paths", () => {
    const overlay: OverlayFilesystem = {
      overlayId: "o1",
      sessionId: "s1",
      membershipId: "m1",
      ownerIdentityPublicKey: "pk1",
      overlayRoot: "/tmp/o1",
      allowedPathScope: ["src/**", "*.ts"],
      baseWorkspaceDigest: "base",
      currentDigest: "base",
      state: "active",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    }

    expect(isOverlayPathAllowed(overlay, "src/main.ts")).toBe(true)
    expect(isOverlayPathAllowed(overlay, "src/deep/test.ts")).toBe(true)
    expect(isOverlayPathAllowed(overlay, "index.ts")).toBe(true)
  })

  test("denies non-matching paths", () => {
    const overlay: OverlayFilesystem = {
      overlayId: "o1",
      sessionId: "s1",
      membershipId: "m1",
      ownerIdentityPublicKey: "pk1",
      overlayRoot: "/tmp/o1",
      allowedPathScope: ["src/**", "*.ts"],
      baseWorkspaceDigest: "base",
      currentDigest: "base",
      state: "active",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    }

    expect(isOverlayPathAllowed(overlay, "README.md")).toBe(false)
    expect(isOverlayPathAllowed(overlay, "dist/bundle.js")).toBe(false)
    expect(isOverlayPathAllowed(overlay, "config/secret.json")).toBe(false)
  })

  test("empty scope denies everything", () => {
    const overlay: OverlayFilesystem = {
      overlayId: "o1",
      sessionId: "s1",
      membershipId: "m1",
      ownerIdentityPublicKey: "pk1",
      overlayRoot: "/tmp/o1",
      allowedPathScope: [],
      baseWorkspaceDigest: "base",
      currentDigest: "base",
      state: "created",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    }

    expect(isOverlayPathAllowed(overlay, "anything.ts")).toBe(false)
  })
})

// ── Tests: VALID_OVERLAY_TRANSITIONS ------------------------------------------

describe("VALID_OVERLAY_TRANSITIONS", () => {
  test("created → active is valid", () => {
    expect(VALID_OVERLAY_TRANSITIONS.created).toContain("active")
  })

  test("active → discarded is valid", () => {
    expect(VALID_OVERLAY_TRANSITIONS.active).toContain("submitted")
    expect(VALID_OVERLAY_TRANSITIONS.active).toContain("discarded")
  })

  test("merged state has no outgoing transitions", () => {
    expect(VALID_OVERLAY_TRANSITIONS.merged).toEqual([])
  })

  test("discarded state has no outgoing transitions", () => {
    expect(VALID_OVERLAY_TRANSITIONS.discarded).toEqual([])
  })

  test("submitted → merged is valid", () => {
    expect(VALID_OVERLAY_TRANSITIONS.submitted).toContain("merged")
    expect(VALID_OVERLAY_TRANSITIONS.submitted).toContain("rejected")
    expect(VALID_OVERLAY_TRANSITIONS.submitted).toContain("conflicted")
  })
})

// ── Tests: transitionOverlayState ---------------------------------------------

describe("transitionOverlayState", () => {
  test("created → active valid", () => {
    expect(transitionOverlayState("created", "activate")).toBe("active")
  })

  test("active → submitted valid", () => {
    expect(transitionOverlayState("active", "submit")).toBe("submitted")
  })

  test("active → discarded valid", () => {
    expect(transitionOverlayState("active", "discard")).toBe("discarded")
  })

  test("submitted → merged valid", () => {
    expect(transitionOverlayState("submitted", "merge")).toBe("merged")
  })

  test("submitted → rejected valid", () => {
    expect(transitionOverlayState("submitted", "reject")).toBe("rejected")
  })

  test("created → merged invalid", () => {
    expect(() => transitionOverlayState("created", "merge")).toThrow("Invalid overlay state transition")
  })

  test("created → submitted invalid", () => {
    expect(() => transitionOverlayState("created", "submit")).toThrow()
  })

  test("merged → active invalid (terminal state)", () => {
    expect(() => transitionOverlayState("merged", "activate")).toThrow()
  })

  test("discarded → submit invalid (terminal state)", () => {
    expect(() => transitionOverlayState("discarded", "submit")).toThrow()
  })
})

// ── Tests: writeOverlayFile ---------------------------------------------------

describe("writeOverlayFile", () => {
  test("with allowed path succeeds", async () => {
    const root = makeOverlayRoot()
    await writeOverlayFile(root, "src/main.ts", new Uint8Array([1, 2, 3]), ["src/**"])
    const content = readFileSync(join(root, "src/main.ts"))
    expect(new Uint8Array(content)).toEqual(new Uint8Array([1, 2, 3]))
  })

  test("with denied path throws ScopeViolationError", async () => {
    const root = makeOverlayRoot()
    await expect(
      writeOverlayFile(root, "secret/key.json", new Uint8Array([1, 2, 3]), ["src/**", "*.ts"]),
    ).rejects.toThrow(ScopeViolationError)
  })

  test("with empty scope throws ScopeViolationError", async () => {
    const root = makeOverlayRoot()
    await expect(
      writeOverlayFile(root, "file.ts", new Uint8Array([1]), []),
    ).rejects.toThrow(ScopeViolationError)
  })

  test("creates intermediate directories", async () => {
    const root = makeOverlayRoot()
    await writeOverlayFile(
      root,
      "a/deeply/nested/path/file.txt",
      new Uint8Array([100]),
      ["a/**"],
    )
    const content = readFileSync(join(root, "a/deeply/nested/path/file.txt"))
    expect(new Uint8Array(content)).toEqual(new Uint8Array([100]))
  })

  test("overwrites existing file", async () => {
    const root = makeOverlayRoot()
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src/main.ts"), "old content")

    await writeOverlayFile(root, "src/main.ts", new Uint8Array([99]), ["src/**"])
    const content = readFileSync(join(root, "src/main.ts"))
    expect(new Uint8Array(content)).toEqual(new Uint8Array([99]))
  })
})

// ── Tests: readOverlayFile ----------------------------------------------------

describe("readOverlayFile", () => {
  test("reads existing file", async () => {
    const root = makeOverlayRoot()
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src/data.bin"), Buffer.from([10, 20, 30]))

    const data = await readOverlayFile(root, "src/data.bin")
    expect(new Uint8Array(data)).toEqual(new Uint8Array([10, 20, 30]))
  })

  test("marked as async function", async () => {
    const root = makeOverlayRoot()
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src/data.bin"), Buffer.from([10, 20, 30]))
    const data = await readOverlayFile(root, "src/data.bin")
    expect(data).toBeTruthy()
  })
})

// ── Tests: getChangedFiles ----------------------------------------------------

describe("getChangedFiles", () => {
  test("lists changed files in overlay", async () => {
    const root = makeOverlayRoot()
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src/main.ts"), 'export const a = 1')
    writeFileSync(join(root, "README.md"), "# Overlay changes")
    writeFileSync(join(root, ".overlay.json"), '{"ignored": true}')

    const files = await getChangedFiles(root, "base_digest")
    // Hidden files should be skipped
    expect(files).not.toContain(".overlay.json")
    expect(files).toContain("src/main.ts")
    expect(files).toContain("README.md")
  })

  test("returns empty array for empty overlay", async () => {
    const root = makeOverlayRoot()
    const files = await getChangedFiles(root, "base_digest")
    expect(files).toEqual([])
  })

  test("sorts files deterministically", async () => {
    const root = makeOverlayRoot()
    mkdirSync(join(root, "z-dir"), { recursive: true })
    mkdirSync(join(root, "a-dir"), { recursive: true })
    writeFileSync(join(root, "z-dir/file.txt"), "z")
    writeFileSync(join(root, "a-dir/file.txt"), "a")
    writeFileSync(join(root, "readme.md"), "top")

    const files = await getChangedFiles(root, "base")
    expect(files).toEqual(["a-dir/file.txt", "readme.md", "z-dir/file.txt"])
  })
})

// ── Tests: initOverlayFromCanonical -------------------------------------------

describe("initOverlayFromCanonical", () => {
  test("copies allowed files from canonical", async () => {
    const overlayRoot = makeOverlayRoot()
    const canonicalDir = makeCanonicalDir()

    await initOverlayFromCanonical(overlayRoot, canonicalDir, ["src/**", "*.ts"])

    // Should have src/main.ts and src/utils.ts
    expect(readFileSync(join(overlayRoot, "src/main.ts"), "utf-8")).toBe('export const x = 1')
    expect(readFileSync(join(overlayRoot, "src/utils.ts"), "utf-8")).toBe('export const util = true')
    // Should NOT have README.md (not in scope)
    expect(() => readFileSync(join(overlayRoot, "README.md"))).toThrow()
    // Should NOT have index.ts (matches *.ts but index.ts is *.ts — actually wait, *.ts matches "index.ts")
    // Actually *.ts does match index.ts — let me check: README.md should be excluded.
    // *.ts matches "index.ts" but README.md should not. Let me verify.
    expect(() => readFileSync(join(overlayRoot, "README.md"))).toThrow()
    // index.ts matches *.ts so it should be copied
    expect(readFileSync(join(overlayRoot, "index.ts"), "utf-8")).toBe('console.log("hello")')
  })

  test("copies nothing for empty scope", async () => {
    const overlayRoot = makeOverlayRoot()
    const canonicalDir = makeCanonicalDir()

    await initOverlayFromCanonical(overlayRoot, canonicalDir, [])

    // With empty scope, no files should be copied
    const { readdirSync } = require("node:fs")
    const items = readdirSync(overlayRoot)
    // Only metadata/dotfiles allowed (none written by initOverlayFromCanonical)
    const visibleFiles = items.filter((f: string) => !f.startsWith("."))
    expect(visibleFiles).toEqual([])
  })
})
