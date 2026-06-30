/**
 * Dharma Live Sandbox — Patch Builder
 *
 * Unified diff generation from overlay changes.
 * Compares overlay file states against canonical workspace files
 * and produces structured PatchChange entries for review and application.
 */

import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { PatchProposal, PatchReviewDecision } from "./live-types"
import { PatchConflictError } from "./live-errors"

// ── Types ──────────────────────────────────────────────────────────────────

export interface PatchChange {
  path: string
  kind: "add" | "modify" | "delete"
  beforeDigest: string | null
  afterDigest: string | null
  content: Uint8Array | null
}

// ── Digest Helpers ─────────────────────────────────────────────────────────

function digestFile(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

function digestFileFromPath(filePath: string): Promise<string | null> {
  return fs.readFile(filePath).then(
    (data) => digestFile(data),
    () => null,
  )
}

// ── Path Validation ────────────────────────────────────────────────────────

function isAllowedPath(absolutePath: string, canonicalDir: string, allowedPaths: string[]): boolean {
  // Must be within canonicalDir (i.e. resolved under the canonical workspace)
  const resolved = path.resolve(absolutePath)
  if (!resolved.startsWith(canonicalDir)) return false

  // Compute relative path and check against allowed path list
  const relative = path.relative(canonicalDir, resolved)
  for (const allowed of allowedPaths) {
    // Support glob-like patterns: trailing /** matches any depth
    const normalizedAllowed = allowed.endsWith("/") ? allowed : allowed
    const pattern = normalizedAllowed.endsWith("/**")
      ? normalizedAllowed.slice(0, -3)
      : normalizedAllowed
    if (relative === pattern || relative.startsWith(pattern + path.sep)) return true
    // Simple glob with single *
    if (pattern.includes("*")) {
      const reStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
      if (new RegExp(`^${reStr}$`).test(relative)) return true
    }
  }
  return false
}

function isAllowedPathSimple(scopePath: string, allowedPaths: string[]): boolean {
  for (const allowed of allowedPaths) {
    const normalizedAllowed = allowed.endsWith("/") ? allowed : allowed
    const pattern = normalizedAllowed.endsWith("/**")
      ? normalizedAllowed.slice(0, -3)
      : normalizedAllowed
    if (scopePath.startsWith(pattern)) return true
    if (pattern.includes("*")) {
      const reStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
      if (new RegExp(`^${reStr}$`).test(scopePath)) return true
    }
  }
  return false
}

// ── Changed Path Extraction ───────────────────────────────────────────────

/**
 * Extract changed paths between overlay and canonical directories.
 * Only considers files within the allowed path scope.
 */
export async function extractChangedPaths(
  overlayRoot: string,
  canonicalDir: string,
  allowedPaths: string[],
): Promise<PatchChange[]> {
  const changes: PatchChange[] = []

  // Collect all overlay files recursively
  async function collectOverlayFiles(dir: string): Promise<string[]> {
    const entries: string[] = []
    try {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of dirEntries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const sub = await collectOverlayFiles(fullPath)
          entries.push(...sub)
        } else if (entry.isFile()) {
          entries.push(fullPath)
        }
      }
    } catch {
      // Directory may not exist yet (empty overlay)
    }
    return entries
  }

  // Collect all canonical files
  async function collectCanonicalFiles(dir: string): Promise<Set<string>> {
    const files = new Set<string>()
    async function walk(d: string) {
      try {
        const dirEntries = await fs.readdir(d, { withFileTypes: true })
        for (const entry of dirEntries) {
          const fullPath = path.join(d, entry.name)
          if (entry.isDirectory()) {
            await walk(fullPath)
          } else if (entry.isFile()) {
            files.add(fullPath)
          }
        }
      } catch {
        // Canonical may not exist yet
      }
    }
    await walk(dir)
    return files
  }

  const [overlayFiles, canonicalFiles] = await Promise.all([
    collectOverlayFiles(overlayRoot),
    collectCanonicalFiles(canonicalDir),
  ])

  // Files present in overlay (additions or modifications vs canonical)
  for (const overlayFile of overlayFiles) {
    const relativePath = path.relative(overlayRoot, overlayFile)
    if (!isAllowedPathSimple(relativePath, allowedPaths)) continue

    const canonicalFile = path.join(canonicalDir, relativePath)
    const [overlayData, canonicalDigest] = await Promise.all([
      fs.readFile(overlayFile).then(
        (d) => d,
        () => null as Uint8Array | null,
      ),
      digestFileFromPath(canonicalFile),
    ])

    if (overlayData === null) continue

    const overlayDigest = digestFile(overlayData)

    if (canonicalDigest === null) {
      // File exists in overlay but not canonical → addition
      changes.push({
        path: relativePath,
        kind: "add",
        beforeDigest: null,
        afterDigest: overlayDigest,
        content: overlayData,
      })
    } else if (overlayDigest !== canonicalDigest) {
      // File changed between overlay and canonical → modification
      changes.push({
        path: relativePath,
        kind: "modify",
        beforeDigest: canonicalDigest,
        afterDigest: overlayDigest,
        content: overlayData,
      })
    }
    // If digests match, no change (skip)
  }

  // Files present in canonical but absent from overlay → deletion
  for (const canonicalFile of canonicalFiles) {
    const relativePath = path.relative(canonicalDir, canonicalFile)
    if (!isAllowedPathSimple(relativePath, allowedPaths)) continue

    const overlayFile = path.join(overlayRoot, relativePath)
    const overlayExists = await fs
      .access(overlayFile)
      .then(() => true)
      .catch(() => false)

    if (!overlayExists) {
      const canonicalDigest = await digestFileFromPath(canonicalFile)
      changes.push({
        path: relativePath,
        kind: "delete",
        beforeDigest: canonicalDigest,
        afterDigest: null,
        content: null,
      })
    }
  }

  return changes
}

// ── Patch Digest ───────────────────────────────────────────────────────────

/**
 * Compute a single deterministic digest from an ordered list of changes.
 */
export function computePatchDigest(changes: PatchChange[]): string {
  const hash = createHash("sha256")
  for (const change of changes) {
    hash.update(change.path)
    hash.update(change.kind)
    hash.update(change.beforeDigest ?? "\x00")
    hash.update(change.afterDigest ?? "\x00")
  }
  return hash.digest("hex")
}

// ── Patch Proposal Builder ─────────────────────────────────────────────────

/**
 * Build a patch proposal from an overlay's changed files.
 * Reads the overlay directory and compares against the canonical workspace.
 */
export async function buildPatchProposal(config: {
  proposalId: string
  sessionId: string
  membershipId: string
  grantId: string
  overlayId: string
  baseWorkspaceDigest: string
  overlayRoot: string
  canonicalDir: string
  allowedPaths: string[]
}): Promise<{ proposal: PatchProposal; changes: PatchChange[] }> {
  const changes = await extractChangedPaths(
    config.overlayRoot,
    config.canonicalDir,
    config.allowedPaths,
  )

  if (changes.length === 0) {
    throw new PatchConflictError("no changes detected in overlay")
  }

  const patchDigest = computePatchDigest(changes)
  const changedPaths = changes.map((c) => c.path)

  const proposal: PatchProposal = {
    proposalId: config.proposalId,
    sessionId: config.sessionId,
    membershipId: config.membershipId,
    grantId: config.grantId,
    overlayId: config.overlayId,
    baseWorkspaceDigest: config.baseWorkspaceDigest,
    patchDigest,
    changedPaths,
    patchReference: null,
    state: "pending",
    createdAt: new Date().toISOString(),
    signature: "",
  }

  return { proposal, changes }
}

// ── Review Decision ────────────────────────────────────────────────────────

/**
 * Create a patch review decision.
 */
export function createReviewDecision(config: {
  proposalId: string
  decision: "accepted" | "rejected"
  reviewedBy: string
  reason?: string
  expectedDigest: string
}): PatchReviewDecision {
  return {
    proposalId: config.proposalId,
    decision: config.decision,
    reviewedByIdentityPublicKey: config.reviewedBy,
    reviewReason: config.reason ?? null,
    expectedCanonicalDigest: config.expectedDigest,
    acceptedAt: config.decision === "accepted" ? new Date().toISOString() : null,
    signature: "",
  }
}
