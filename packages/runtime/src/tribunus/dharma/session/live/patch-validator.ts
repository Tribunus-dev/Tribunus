/**
 * Dharma Live Sandbox — Patch Validator
 *
 * Patch validation before application.
 * Validates path scoping, size limits, file count limits,
 * protected file restrictions, and binary file policy.
 */

import type { PatchProposal } from "./live-types"
import type { PatchChange } from "./patch-builder"
import type { ResourceScope } from "../types"
import { PatchValidationError } from "./live-errors"
import { isPathAllowed } from "../session-grants"

// ── Types ──────────────────────────────────────────────────────────────────

export interface PatchValidationResult {
  valid: boolean
  errors: string[]
  validatedChanges: PatchChange[]
}

// ── Path Validation ────────────────────────────────────────────────────────

/**
 * Check every changed path is within the allowed resource scope.
 * Returns an array of error messages, empty if all paths are valid.
 */
export function validateChangedPaths(
  changes: PatchChange[],
  scope: ResourceScope,
): string[] {
  const errors: string[] = []
  for (const change of changes) {
    if (!isPathAllowed(scope, change.path)) {
      errors.push(`Path "${change.path}" is not within the allowed resource scope`)
    }
  }
  return errors
}

// ── Size Validation ───────────────────────────────────────────────────────

/**
 * Check that the total patch byte size is within limits.
 * Computed from the content of added/modified files.
 */
export function validatePatchSize(
  changes: PatchChange[],
  maxBytes: number,
): boolean {
  let totalBytes = 0
  for (const change of changes) {
    if (change.content) {
      totalBytes += change.content.byteLength
    }
  }
  return totalBytes <= maxBytes
}

// ── File Count Validation ──────────────────────────────────────────────────

/**
 * Check that the number of changed files is within limits.
 */
export function validateFileCount(
  changes: PatchChange[],
  maxFiles: number,
): boolean {
  return changes.length <= maxFiles
}

// ── Protected File Validation ──────────────────────────────────────────────

/**
 * Check that no protected files (config, secrets, etc.) are changed.
 * Protected paths are compared as simple prefix matches.
 * Returns an array of error messages, empty if no protected paths are touched.
 */
export function validateNoProtectedFiles(
  changes: PatchChange[],
  protectedPaths: string[],
): string[] {
  const errors: string[] = []
  for (const change of changes) {
    for (const protectedPath of protectedPaths) {
      if (change.path.startsWith(protectedPath)) {
        errors.push(
          `Path "${change.path}" is protected and cannot be modified`,
        )
      }
    }
  }
  return errors
}

// ── Binary Policy Validation ───────────────────────────────────────────────

/**
 * Check that no binary files are affected (unless binary files are allowed).
 * A file is considered binary if it contains null bytes or
 * has a binary file extension.
 */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".wasm", ".o", ".obj", ".lib", ".a", ".so", ".dylib", ".dll", ".exe",
  ".keystore", ".jks", ".p12", ".pfx",
])

/**
 * Check if file content is binary (contains a null byte in first 8KB).
 */
function isBinaryContent(data: Uint8Array | null): boolean {
  if (!data) return false
  const limit = Math.min(data.byteLength, 8192)
  for (let i = 0; i < limit; i++) {
    if (data[i] === 0) return true
  }
  return false
}

/**
 * Check if a file path has a binary extension.
 */
function hasBinaryExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

/**
 * Validate that binary files are only included when allowed.
 * Returns an array of error messages, empty if policy passes.
 */
export function validateBinaryPolicy(
  changes: PatchChange[],
  allowBinary: boolean,
): string[] {
  if (allowBinary) return []

  const errors: string[] = []
  for (const change of changes) {
    if (
      change.kind === "add" || change.kind === "modify"
    ) {
      const extBinary = hasBinaryExtension(change.path)
      const contentBinary = isBinaryContent(change.content)
      if (extBinary || contentBinary) {
        errors.push(
          `Path "${change.path}" appears to be binary and binary files are not allowed`,
        )
      }
    }
  }
  return errors
}

// ── Full Patch Validation ─────────────────────────────────────────────────

/**
 * Full patch validation: signature, session, grant, paths, limits.
 *
 * NOTE: This validates the structural and scoping constraints of a patch.
 * Cryptographic signature verification is expected to be handled by the
 * caller against the session key material.
 */
export function validatePatchProposal(
  proposal: PatchProposal,
  changes: PatchChange[],
  resourceScope: ResourceScope,
  keyEpoch: number,
  baseDigest: string,
): PatchValidationResult {
  const errors: string[] = []

  // Validate base digest match
  if (proposal.baseWorkspaceDigest !== baseDigest) {
    errors.push(
      `Base workspace digest mismatch: expected "${baseDigest}", got "${proposal.baseWorkspaceDigest}"`,
    )
  }

  // Validate changedPaths array matches actual changes
  const changePaths = changes.map((c) => c.path)
  if (
    changePaths.length !== proposal.changedPaths.length ||
    !changePaths.every((p, i) => p === proposal.changedPaths[i])
  ) {
    errors.push("Changed paths mismatch between proposal and computed changes")
  }

  // Validate all changed paths are within the resource scope
  const pathErrors = validateChangedPaths(changes, resourceScope)
  errors.push(...pathErrors)

  // Validate file count against scope
  const maxFiles = resourceScope.maximumProcessCount > 0
    ? Math.max(resourceScope.maximumProcessCount * 10, 100)
    : 100
  if (!validateFileCount(changes, maxFiles)) {
    errors.push(`File count exceeds limit of ${maxFiles}`)
  }

  // Validate total patch size
  const maxPatchBytes = resourceScope.maximumDiskWriteBytes > 0
    ? resourceScope.maximumDiskWriteBytes
    : 10 * 1024 * 1024 // 10MB default
  if (!validatePatchSize(changes, maxPatchBytes)) {
    errors.push(`Patch size exceeds limit of ${maxPatchBytes} bytes`)
  }

  // Validate no protected paths. Protected paths are a config-time concern;
  // we guard known sensitive locations by default.
  const protectedPaths = [
    ".env",
    ".env.local",
    "node_modules/",
    ".git/",
  ]
  const protectedErrors = validateNoProtectedFiles(changes, protectedPaths)
  errors.push(...protectedErrors)

  // Validate binary policy (default: disallow binary files)
  const binaryErrors = validateBinaryPolicy(changes, false)
  errors.push(...binaryErrors)

  // Validate proposal state is pending
  if (proposal.state !== "pending") {
    errors.push(
      `Proposal is in state "${proposal.state}", expected "pending"`,
    )
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      validatedChanges: [],
    }
  }

  return {
    valid: true,
    errors: [],
    validatedChanges: changes,
  }
}
