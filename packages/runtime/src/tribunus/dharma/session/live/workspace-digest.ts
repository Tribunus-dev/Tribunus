/**
 * Dharma Live Sandbox — Workspace Digest Computation
 *
 * Deterministic workspace digest computation for verifying sandbox state.
 * Uses canonical file-tree encoding with SHA-256 hashing.
 */

import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface FileDigestEntry {
  relativePath: string
  mode: string
  digest: string
}

/**
 * Compute a deterministic workspace digest for a directory.
 *
 * Walks the directory tree, collects file entries (excluding non-canonical
 * paths), and produces a single SHA-256 digest over the canonical JSON
 * representation sorted lexicographically by relative path.
 */
export async function computeWorkspaceDigest(
  workspaceDir: string,
): Promise<{ digest: string; entries: FileDigestEntry[] }> {
  const entries = await collectFileEntries(workspaceDir)
  // Sort entries by path for canonical ordering
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const digest = digestFromEntries(entries)
  return { digest, entries }
}

/**
 * Compute a digest from pre-collected file entries.
 * The entries are used in the order provided (no internal sort).
 */
export function digestFromEntries(entries: FileDigestEntry[]): string {
  const json = JSON.stringify(entries)
  return createHash("sha256").update(json, "utf-8").digest("hex")
}

/**
 * Compute the SHA-256 hex digest for a byte array.
 */
export function hashBytes(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

/**
 * Check whether a file or directory should be excluded from digest computation.
 *
 * Excludes runtime logs, temp directories, dependency trees, version control,
 * metadata files, and socket files.
 */
export function shouldExcludeFromDigest(filePath: string): boolean {
  const segments = filePath.split(/[\\/]/)
  const basename = segments[segments.length - 1] ?? ""

  // Version control
  if (segments.includes(".git")) return true

  // Dependencies
  if (segments.includes("node_modules")) return true

  // Metadata / OS artifacts
  if (basename === ".DS_Store" || basename === "Thumbs.db") return true

  // Temporary directories (any path with /tmp/ or starting with tmp)
  if (segments.some((s) => s === "tmp")) return true

  // Runtime logs
  if (filePath.endsWith(".log")) return true

  // Socket files
  if (filePath.endsWith(".socket")) return true

  return false
}

/**
 * Recursively collect file entries from a directory, excluding paths
 * matched by shouldExcludeFromDigest.
 */
export async function collectFileEntries(
  dirPath: string,
  prefix?: string,
): Promise<FileDigestEntry[]> {
  const entries: FileDigestEntry[] = []
  const resolvedDir = prefix ? path.resolve(dirPath, prefix) : path.resolve(dirPath)
  const names = await fs.readdir(resolvedDir)

  for (const name of names) {
    const childPath = path.join(resolvedDir, name)
    const relativePath = prefix ? path.posix.join(prefix, name) : name

    if (shouldExcludeFromDigest(relativePath)) continue

    let stat
    try {
      stat = await fs.stat(childPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      const sub = await collectFileEntries(dirPath, relativePath)
      entries.push(...sub)
    } else if (stat.isFile()) {
      const data = await fs.readFile(childPath)
      const digest = hashBytes(data)
      const mode = (stat.mode & 0o777).toString(8).padStart(3, "0")
      entries.push({ relativePath, mode, digest })
    }
  }

  return entries
}
