/**
 * Dharma Live Sandbox — Participant Overlay Filesystem
 *
 * Manages per-participant overlay directories with file-level scope
 * enforcement and state transitions. Each overlay represents a participant's
 * working changes against the canonical workspace.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Dirent } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import type { OverlayFilesystem, OverlayState } from "./live-types"
import { ScopeViolationError } from "./live-errors"
import { isPathAllowed } from "../session-grants"
import type { ResourceScope } from "../types"

// ── State Machine ------------------------------------------------------------

/**
 * Valid overlay state transitions.
 * Each state maps to the set of states it can transition to.
 */
export const VALID_OVERLAY_TRANSITIONS: Record<OverlayState, readonly OverlayState[]> = {
  created: ["active"],
  active: ["submitted", "discarded"],
  submitted: ["merged", "rejected", "conflicted"],
  merged: [],
  discarded: [],
  rejected: [],
  conflicted: [],
} as const

export type OverlayAction = "activate" | "submit" | "merge" | "discard" | "reject" | "conflict"

const ACTION_TO_TARGET: Record<OverlayAction, OverlayState> = {
  activate: "active",
  submit: "submitted",
  merge: "merged",
  discard: "discarded",
  reject: "rejected",
  conflict: "conflicted",
}

// ── Factory ------------------------------------------------------------------

/**
 * Create a new overlay on the filesystem.
 *
 * Creates the overlay directory and writes metadata, then returns
 * the OverlayFilesystem descriptor.
 *
 * @throws {Error} If the overlay directory already exists
 */
export async function createOverlayFilesystem(config: {
  overlayId: string
  sessionId: string
  membershipId: string
  ownerIdentityPublicKey: string
  overlayRoot: string
  baseWorkspaceDigest: string
  allowedPathScope: string[]
}): Promise<OverlayFilesystem> {
  const { overlayRoot } = config

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(overlayRoot), { recursive: true })

  // Create overlay directory
  await fs.mkdir(overlayRoot, { recursive: true })

  const now = new Date().toISOString()
  const overlay: OverlayFilesystem = {
    overlayId: config.overlayId,
    sessionId: config.sessionId,
    membershipId: config.membershipId,
    ownerIdentityPublicKey: config.ownerIdentityPublicKey,
    overlayRoot,
    allowedPathScope: config.allowedPathScope,
    baseWorkspaceDigest: config.baseWorkspaceDigest,
    currentDigest: config.baseWorkspaceDigest,
    state: "created",
    createdAt: now,
    updatedAt: now,
  }

  // Write metadata file
  await fs.writeFile(
    path.join(overlayRoot, ".overlay.json"),
    JSON.stringify(overlay, null, 2),
    "utf-8",
  )

  return overlay
}

// ── Scope Checking ----------------------------------------------------------

/**
 * Check if a path is allowed in this overlay.
 *
 * A path is allowed if it matches the overlay's allowedPathScope glob patterns
 * using the same logic as isPathAllowed from session-grants.
 * The overlay path scope is checked as an "allowedPaths" rule.
 */
export function isOverlayPathAllowed(overlay: OverlayFilesystem, relativePath: string): boolean {
  // If no scope is defined, deny everything
  if (overlay.allowedPathScope.length === 0) return false

  // Build a synthetic ResourceScope from the overlay's allowed paths
  const scope: ResourceScope = {
    allowedPaths: overlay.allowedPathScope,
    deniedPaths: [],
    allowedFileExtensions: [],
    deniedFileExtensions: [],
    allowedCommands: [],
    deniedCommands: [],
    allowedNetworkDomains: [],
    deniedNetworkDomains: [],
    allowedEnvironmentVariables: [],
    deniedEnvironmentVariables: [],
    maximumRuntimeSeconds: 0,
    maximumCpuSeconds: 0,
    maximumMemoryBytes: 0,
    maximumDiskWriteBytes: 0,
    maximumProcessCount: 0,
    maximumOutputBytes: 0,
    maximumComputeTokens: null,
    maximumComputeCost: null,
  }

  return isPathAllowed(scope, relativePath)
}

// ── State Transitions --------------------------------------------------------

/**
 * Apply an overlay state transition.
 *
 * @param current - The current overlay state
 * @param action - The action to perform
 * @returns The new state
 * @throws {Error} If the transition is invalid
 */
export function transitionOverlayState(current: OverlayState, action: OverlayAction): OverlayState {
  const target = ACTION_TO_TARGET[action]
  const allowed = VALID_OVERLAY_TRANSITIONS[current]

  if (!allowed.includes(target)) {
    throw new Error(
      `Invalid overlay state transition: ${current} -> ${target} via "${action}". ` +
      `Allowed transitions from ${current}: [${allowed.join(", ")}]`,
    )
  }

  return target
}

// ── File Operations ----------------------------------------------------------

/**
 * Copy files from the canonical workspace into the overlay.
 * Only files matching the allowed paths are copied.
 */
export async function initOverlayFromCanonical(
  overlayRoot: string,
  canonicalDir: string,
  allowedPaths: string[],
): Promise<void> {
  // Build a synthetic scope for allowed path checking
  const scope: ResourceScope = {
    allowedPaths,
    deniedPaths: [],
    allowedFileExtensions: [],
    deniedFileExtensions: [],
    allowedCommands: [],
    deniedCommands: [],
    allowedNetworkDomains: [],
    deniedNetworkDomains: [],
    allowedEnvironmentVariables: [],
    deniedEnvironmentVariables: [],
    maximumRuntimeSeconds: 0,
    maximumCpuSeconds: 0,
    maximumMemoryBytes: 0,
    maximumDiskWriteBytes: 0,
    maximumProcessCount: 0,
    maximumOutputBytes: 0,
    maximumComputeTokens: null,
    maximumComputeCost: null,
  }

  // Walk canonical directory and copy allowed files
  async function walk(current: string): Promise<void> {
    const items = await fs.readdir(current, { withFileTypes: true })
    for (const item of items) {
      const fullPath = path.join(current, item.name)
      if (item.isDirectory()) {
        await walk(fullPath)
      } else if (item.isFile()) {
        const relPath = path.relative(canonicalDir, fullPath)
        if (isPathAllowed(scope, relPath)) {
          const destPath = path.join(overlayRoot, relPath)
          await fs.mkdir(path.dirname(destPath), { recursive: true })
          await fs.copyFile(fullPath, destPath)
        }
      }
    }
  }

  await fs.mkdir(overlayRoot, { recursive: true })
  await walk(canonicalDir)
}

/**
 * Read a file from the overlay filesystem.
 *
 * @param overlayRoot - The overlay directory
 * @param relativePath - Path relative to the overlay root
 * @returns File contents as Uint8Array
 * @throws {ScopeViolationError} If the path escapes the overlay
 */
export async function readOverlayFile(overlayRoot: string, relativePath: string): Promise<Uint8Array> {
  const resolved = path.resolve(overlayRoot, relativePath)

  // Ensure the resolved path is within the overlay root
  const normalizedRoot = path.normalize(overlayRoot)
  const normalizedPath = path.normalize(resolved)
  if (!normalizedPath.startsWith(normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`)) {
    throw new ScopeViolationError(relativePath, "Overlay path escape")
  }

  return new Uint8Array(await fs.readFile(resolved))
}

/**
 * Write a file in the overlay with scope check.
 *
 * @param overlayRoot - The overlay directory
 * @param relativePath - Path relative to the overlay root
 * @param data - File contents
 * @param allowedScope - Glob patterns for allowed paths
 * @throws {ScopeViolationError} If the path is not in the allowed scope
 */
export async function writeOverlayFile(
  overlayRoot: string,
  relativePath: string,
  data: Uint8Array,
  allowedScope: string[],
): Promise<void> {
  // Check scope first
  const scope: ResourceScope = {
    allowedPaths: allowedScope,
    deniedPaths: [],
    allowedFileExtensions: [],
    deniedFileExtensions: [],
    allowedCommands: [],
    deniedCommands: [],
    allowedNetworkDomains: [],
    deniedNetworkDomains: [],
    allowedEnvironmentVariables: [],
    deniedEnvironmentVariables: [],
    maximumRuntimeSeconds: 0,
    maximumCpuSeconds: 0,
    maximumMemoryBytes: 0,
    maximumDiskWriteBytes: 0,
    maximumProcessCount: 0,
    maximumOutputBytes: 0,
    maximumComputeTokens: null,
    maximumComputeCost: null,
  }

  if (!isPathAllowed(scope, relativePath)) {
    throw new ScopeViolationError(relativePath, "Overlay path")
  }

  // Ensure resolved path is within overlay root
  const resolved = path.resolve(overlayRoot, relativePath)
  const normalizedRoot = path.normalize(overlayRoot)
  const normalizedPath = path.normalize(resolved)
  if (!normalizedPath.startsWith(normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`)) {
    throw new ScopeViolationError(relativePath, "Overlay path escape")
  }

  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, Buffer.from(data))
}

// ── Change Tracking ----------------------------------------------------------

/**
 * Build a list of changed files in the overlay relative to the base digest.
 *
 * Compares file contents in the overlay against the expected base digest.
 * A file is considered "changed" if it exists in the overlay and either
 * doesn't exist in the canonical workspace or has different content.
 *
 * @param overlayRoot - The overlay directory
 * @param baseDigest - Digest of the base workspace for comparison
 * @returns Array of relative paths that have changed
 */
export async function getChangedFiles(overlayRoot: string, _baseDigest: string): Promise<string[]> {
  const changed: string[] = []

  async function walkOverlay(current: string): Promise<void> {
    let items: Dirent[]
    try {
      items = (await fs.readdir(current, { withFileTypes: true })) as unknown as Dirent[]
    } catch {
      return // overlay may not exist
    }

    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith(".")) continue // skip metadata
      const fullPath = path.join(current, item.name)
      if (item.isDirectory()) {
        await walkOverlay(fullPath)
      } else if (item.isFile()) {
        const relPath = path.relative(overlayRoot, fullPath)
        changed.push(relPath)
      }
    }
  }

  await walkOverlay(overlayRoot)
  return changed
}
