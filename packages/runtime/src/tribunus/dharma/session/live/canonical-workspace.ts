/**
 * Dharma Live Sandbox — Canonical Workspace Management
 *
 * Manages the canonical workspace directory — the authoritative source tree
 * that represents the session's current state. All overlay merges and
 * mutations converge here.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import type { WorkspaceMutation } from "../types"
import { WorkspaceConflictError } from "../session-errors"

// ── Types --------------------------------------------------------------------

export interface CanonicalWorkspace {
  /** The root directory of the canonical workspace */
  rootDir: string
  /** Current SHA-256 digest of the workspace contents */
  currentDigest: string
  /** Number of successful mutations applied */
  mutationCount: number
}

// ── Digest -------------------------------------------------------------------

/**
 * Compute a deterministic SHA-256 digest for a workspace directory.
 *
 * Produces a hash of all files sorted by relative path with their
 * contents. Empty directories produce no hash contribution.
 */
export async function computeWorkspaceDigest(workspaceDir: string): Promise<string> {
  const hash = createHash("sha256")
  const fileEntries: Array<{ relPath: string; fullPath: string }> = []

  async function walk(current: string, baseRel: string): Promise<void> {
    let items: Dirent[]
    try {
      items = (await fs.readdir(current, { withFileTypes: true })) as unknown as Dirent[]
    } catch {
      return
    }

    // Sort for deterministic ordering
    items.sort((a, b) => a.name.localeCompare(b.name))

    for (const item of items) {
      if (item.name.startsWith(".")) continue // skip metadata/hidden files
      const fullPath = path.join(current, item.name)
      const relPath = baseRel ? `${baseRel}/${item.name}` : item.name
      if (item.isDirectory()) {
        await walk(fullPath, relPath)
      } else if (item.isFile()) {
        fileEntries.push({ relPath, fullPath })
      }
    }
  }

  await walk(workspaceDir, "")

  for (const entry of fileEntries) {
    const content = await fs.readFile(entry.fullPath)
    hash.update(entry.relPath)
    hash.update("\0")
    hash.update(content)
    hash.update("\0")
  }

  return hash.digest("hex")
}

/**
 * Read the canonical workspace metadata file if it exists.
 */
async function readMeta(canonicalDir: string): Promise<{ mutationCount: number } | null> {
  const metaPath = path.join(canonicalDir, ".canonical-meta.json")
  try {
    return JSON.parse(await fs.readFile(metaPath, "utf-8"))
  } catch {
    return null
  }
}

/**
 * Write the canonical workspace metadata file.
 */
async function writeMeta(canonicalDir: string, data: { mutationCount: number }): Promise<void> {
  const metaPath = path.join(canonicalDir, ".canonical-meta.json")
  await fs.writeFile(metaPath, JSON.stringify(data, null, 2), "utf-8")
}

// ── Operations ---------------------------------------------------------------

/**
 * Initialize canonical workspace from base source.
 *
 * Copies all files from baseDir into canonicalDir and computes
 * the initial workspace digest. Creates the target directory if
 * it doesn't exist.
 */
export async function initCanonicalWorkspace(
  canonicalDir: string,
  baseDir: string,
): Promise<CanonicalWorkspace> {
  await fs.mkdir(canonicalDir, { recursive: true })

  // Copy files from baseDir to canonicalDir
  async function copyFromBase(src: string, dest: string): Promise<void> {
    const items = await fs.readdir(src, { withFileTypes: true })
    for (const item of items) {
      if (item.name.startsWith(".")) continue
      const srcPath = path.join(src, item.name)
      const destPath = path.join(dest, item.name)
      if (item.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true })
        await copyFromBase(srcPath, destPath)
      } else if (item.isFile()) {
        await fs.copyFile(srcPath, destPath)
      }
    }
  }

  try {
    await copyFromBase(baseDir, canonicalDir)
  } catch {
    // baseDir might not exist yet — that's fine for an empty init
  }

  const currentDigest = await computeWorkspaceDigest(canonicalDir)
  await writeMeta(canonicalDir, { mutationCount: 0 })

  return {
    rootDir: canonicalDir,
    currentDigest,
    mutationCount: 0,
  }
}

/**
 * Apply a set of file changes to the canonical workspace.
 *
 * Applies changes (create, update, delete) and verifies the workspace
 * was at the expected base digest before applying (conflict detection).
 *
 * @param canonicalDir - The canonical workspace directory
 * @param changes - Array of changes where each entry has a relative path
 *                   and optional data (null = delete the file)
 * @param expectedBaseDigest - The digest the workspace should currently have
 * @returns The new workspace digest after changes
 * @throws {WorkspaceConflictError} If current digest doesn't match expected
 */
export async function applyChangesToCanonical(
  canonicalDir: string,
  changes: Array<{ path: string; data: Uint8Array | null }>,
  expectedBaseDigest: string,
): Promise<string> {
  // Verify no conflict: current digest must match expected
  const currentDigest = await computeWorkspaceDigest(canonicalDir)
  if (currentDigest !== expectedBaseDigest) {
    throw new WorkspaceConflictError(
      `Workspace conflict: expected digest ${expectedBaseDigest} but found ${currentDigest}`,
    )
  }

  // Apply changes
  for (const change of changes) {
    const resolved = path.resolve(canonicalDir, change.path)

    // Ensure path doesn't escape canonicalDir
    const normalizedDir = path.normalize(canonicalDir)
    const normalizedPath = path.normalize(resolved)
    const rootWithSep = normalizedDir.endsWith("/") ? normalizedDir : `${normalizedDir}/`
    if (!normalizedPath.startsWith(rootWithSep)) {
      throw new WorkspaceConflictError(
        `Change path escapes canonical workspace: ${change.path}`,
      )
    }

    if (change.data === null) {
      // Delete the file
      try {
        await fs.unlink(resolved)
      } catch {
        // File may not exist — idempotent delete
      }
    } else {
      // Write the file (create or update)
      await fs.mkdir(path.dirname(resolved), { recursive: true })
      await fs.writeFile(resolved, Buffer.from(change.data))
    }
  }

  // Compute new digest after applying changes
  const newDigest = await computeWorkspaceDigest(canonicalDir)

  // Update metadata
  const meta = await readMeta(canonicalDir)
  await writeMeta(canonicalDir, { mutationCount: (meta?.mutationCount ?? 0) + 1 })

  return newDigest
}

/**
 * Verify canonical workspace digest matches expected value.
 */
export async function verifyCanonicalDigest(
  canonicalDir: string,
  expectedDigest: string,
): Promise<boolean> {
  const actual = await computeWorkspaceDigest(canonicalDir)
  return actual === expectedDigest
}

/**
 * Get current canonical workspace state.
 */
export async function getCanonicalState(canonicalDir: string): Promise<CanonicalWorkspace> {
  const currentDigest = await computeWorkspaceDigest(canonicalDir)
  const meta = await readMeta(canonicalDir)

  return {
    rootDir: canonicalDir,
    currentDigest,
    mutationCount: meta?.mutationCount ?? 0,
  }
}
