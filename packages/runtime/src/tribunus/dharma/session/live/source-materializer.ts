/**
 * Dharma Live Sandbox — Git-Based Source Materialization
 *
 * Materializes a Git source revision into an isolated sandbox directory
 * by extracting tracked content via git archive piped through tar.
 * Provides helpers for commit resolution, file scanning, and digest
 * computation.
 */

import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import type { SourceManifest, SourceFileEntry } from "./live-types"
import { MaterializationError } from "./live-errors"
import { buildSandboxLayout } from "./sandbox-layout"

// ── Exported Types ─────────────────────────────────────────────────────────

export interface MaterializationResult {
  manifest: SourceManifest
  baseDir: string
  commitHash: string
}

// ── Core Materialization ───────────────────────────────────────────────────

/**
 * Materialize a Git source revision into an isolated sandbox directory.
 *
 * Resolves the revision to an immutable commit hash, extracts tracked
 * content via `git archive`, and builds a source manifest over the
 * extracted files.
 */
export async function materializeSource(
  repoPath: string,
  revision: string,
  targetDir: string,
): Promise<MaterializationResult> {
  const commitHash = await resolveCommitHash(repoPath, revision)
  await fs.mkdir(targetDir, { recursive: true })

  // Archive the commit and extract into targetDir
  const archive = execFileSync("git", ["archive", commitHash], {
    cwd: repoPath,
    encoding: null,
    maxBuffer: 500 * 1024 * 1024, // 500 MB limit for large repos
  })
  const tarPath = path.join(os.tmpdir(), `dharma-${randomUUID()}.tar`)
  try {
    await fs.writeFile(tarPath, archive)
    execFileSync("tar", ["x", "-C", targetDir, "-f", tarPath])
  } catch (cause) {
    await fs.rm(tarPath, { force: true })
    throw new MaterializationError(
      `Failed to extract git archive for revision ${commitHash} into ${targetDir}`,
      cause,
    )
  } finally {
    await fs.unlink(tarPath).catch(() => {})
  }

  const repoIdentityDigest = await getRepoIdentityDigest(repoPath)
  const manifest = await buildSourceManifest(targetDir, commitHash, repoIdentityDigest)
  return { manifest, baseDir: targetDir, commitHash }
}

// ── Commit Resolution ──────────────────────────────────────────────────────

/**
 * Resolve a Git revision to an immutable 40-character commit hash.
 */
export async function resolveCommitHash(repoPath: string, revision: string): Promise<string> {
  try {
    const hash = execFileSync("git", ["rev-parse", revision], {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim()
    if (!/^[0-9a-f]{40}$/.test(hash)) {
      throw new Error(`Revision resolved but result is not a 40-char hex hash: "${hash}"`)
    }
    return hash
  } catch (cause) {
    throw new MaterializationError(`Cannot resolve revision "${revision}" in ${repoPath}`, cause)
  }
}

/**
 * Get a SHA-256 digest identifying the Git repository.
 * Uses the origin remote URL if available, otherwise hashes the repo path.
 */
export async function getRepoIdentityDigest(repoPath: string): Promise<string> {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim()
    if (remote) {
      return createHash("sha256").update(remote, "utf-8").digest("hex")
    }
  } catch {
    // No remote configured — fall through to path-based identity
  }
  return createHash("sha256").update(path.resolve(repoPath), "utf-8").digest("hex")
}

// ── Digest Computation ─────────────────────────────────────────────────────

/**
 * Compute the source tree digest from file entries.
 *
 * SHA-256 of canonical JSON of all file entries sorted by path.
 */
export function computeSourceDigest(files: SourceFileEntry[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const json = JSON.stringify(sorted)
  return createHash("sha256").update(json, "utf-8").digest("hex")
}

/**
 * Compute the SHA-256 hex digest for a byte array of file contents.
 */
export function fileDigest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

// ── Manifest Building ──────────────────────────────────────────────────────

/**
 * Build a source manifest from extracted files in a directory.
 *
 * Scans baseDir recursively for source files, computes per-file digests
 * and total byte count, then produces a complete SourceManifest with
 * a manifest-level digest.
 */
export async function buildSourceManifest(
  baseDir: string,
  commitHash: string,
  repoIdentityDigest: string,
): Promise<SourceManifest> {
  const files = await scanSourceFiles(baseDir)
  const manifestDigest = computeSourceDigest(files)

  let totalBytes = 0
  for (const entry of files) {
    try {
      const stat = await fs.stat(path.resolve(baseDir, entry.path))
      totalBytes += stat.size
    } catch {
      // File removed between scan and stat — skip
    }
  }

  return {
    sourceRevision: commitHash,
    resolvedCommitHash: commitHash,
    repositoryIdentityDigest: repoIdentityDigest,
    files,
    totalFileCount: files.length,
    totalBytes,
    manifestDigest,
    createdAt: new Date().toISOString(),
  }
}

// ── File Scanning ──────────────────────────────────────────────────────────

/**
 * Scan a directory recursively for source files, computing a digest for each.
 *
 * Skips node_modules and .git directories.
 */
export async function scanSourceFiles(baseDir: string): Promise<SourceFileEntry[]> {
  const entries: SourceFileEntry[] = []
  await scanDir(baseDir, baseDir, entries)
  return entries
}

async function scanDir(rootDir: string, currentDir: string, entries: SourceFileEntry[]): Promise<void> {
  const names = await fs.readdir(currentDir)
  for (const name of names) {
    const childPath = path.join(currentDir, name)
    let stat
    try {
      stat = await fs.stat(childPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue
      await scanDir(rootDir, childPath, entries)
    } else if (stat.isFile()) {
      const relativePath = path.relative(rootDir, childPath)
      const data = await fs.readFile(childPath)
      const digest = fileDigest(data)
      const mode = (stat.mode & 0o777).toString(8).padStart(3, "0")
      entries.push({ path: relativePath, mode, digest })
    }
  }
}

// ── Path Validation ────────────────────────────────────────────────────────

/**
 * Validate that a path does not escape its expected root directory.
 *
 * Resolves both paths to absolute form and checks that the target
 * is a child (or equal) to the root.
 */
export function validatePathInRoot(targetPath: string, rootDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootDir)
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(resolvedRoot + path.sep)
  )
}
