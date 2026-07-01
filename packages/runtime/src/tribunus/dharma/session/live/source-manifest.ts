/**
 * Dharma Live Sandbox — Source Manifest Helpers
 *
 * Utility functions for creating, querying, and computing digests
 * over SourceManifest objects.
 */

import { createHash } from "node:crypto"
import type { SourceManifest } from "./live-types"

/**
 * Create an empty manifest for the given commit hash.
 * Used as a placeholder before materialization completes.
 */
export function createEmptyManifest(commitHash: string): SourceManifest {
  return {
    sourceRevision: commitHash,
    resolvedCommitHash: commitHash,
    repositoryIdentityDigest: "",
    files: [],
    totalFileCount: 0,
    totalBytes: 0,
    manifestDigest: "",
    createdAt: new Date().toISOString(),
  }
}

/**
 * Compute a deterministic digest for a manifest's file table.
 * SHA-256 of canonical JSON of all file entries sorted by path.
 */
export function computeManifestDigest(manifest: SourceManifest): string {
  const sorted = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path))
  const json = JSON.stringify(sorted)
  return createHash("sha256").update(json, "utf-8").digest("hex")
}

/**
 * Check whether the manifest contains a file entry for the given path.
 */
export function manifestContainsPath(manifest: SourceManifest, filePath: string): boolean {
  return manifest.files.some((f) => f.path === filePath)
}

/**
 * Get the total byte count of all files recorded in the manifest.
 */
export function getManifestTotalSize(manifest: SourceManifest): number {
  return manifest.totalBytes
}
