/**
 * Prism KV Handoff Protocol — Export Manifest
 *
 * Pure functions for creating, validating, and checking the expiry of
 * PrismKvExportManifest instances.
 */

import type { PrismKvExportManifest } from "./handoff-types"

/**
 * Create a PrismKvExportManifest from the essential fields.
 * Fields not specified by the caller receive sensible defaults.
 */
export function createExportManifest(
  handoffId: string,
  sourceWorkerId: string,
  sourceInstanceId: string,
  nsId: string,
  descDigest: string,
  seqLen: number,
  pages: number,
  bytes: number,
  contentDigest: string,
): PrismKvExportManifest {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 300_000) // 5 min default TTL

  return {
    manifestId: `manifest-${handoffId}`,
    handoffId,
    sourceWorkerId,
    sourceWorkerInstanceId: sourceInstanceId,
    sourceKvNamespaceId: nsId,
    modelArtifactDigest: "",
    tokenizerDigest: "",
    compatibilityDescriptorDigest: descDigest,
    transferRepresentation: "simulation",
    sequenceLength: seqLen,
    pageCount: pages,
    byteLength: bytes,
    deterministicContentDigest: contentDigest,
    exportGeneration: 1,
    exportedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sourceSignature: "",
  }
}

/**
 * Validate an export manifest against an expected handoff ID.
 * Checks structural integrity and field consistency.
 */
export function validateManifest(
  manifest: PrismKvExportManifest,
  expectedHandoffId: string,
): { valid: boolean; reason: string | null } {
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, reason: "Manifest is null or not an object" }
  }

  if (manifest.handoffId !== expectedHandoffId) {
    return { valid: false, reason: `Manifest handoffId "${manifest.handoffId}" does not match expected "${expectedHandoffId}"` }
  }

  if (!manifest.manifestId) {
    return { valid: false, reason: "Manifest manifestId is missing" }
  }

  if (!manifest.sourceWorkerId) {
    return { valid: false, reason: "Manifest sourceWorkerId is missing" }
  }

  if (!manifest.sourceKvNamespaceId) {
    return { valid: false, reason: "Manifest sourceKvNamespaceId is missing" }
  }

  if (!manifest.compatibilityDescriptorDigest) {
    return { valid: false, reason: "Manifest compatibilityDescriptorDigest is missing" }
  }

  if (manifest.sequenceLength <= 0) {
    return { valid: false, reason: "Manifest sequenceLength must be positive" }
  }

  if (manifest.pageCount <= 0) {
    return { valid: false, reason: "Manifest pageCount must be positive" }
  }

  if (manifest.byteLength <= 0) {
    return { valid: false, reason: "Manifest byteLength must be positive" }
  }

  if (manifest.exportGeneration <= 0) {
    return { valid: false, reason: "Manifest exportGeneration must be positive" }
  }

  if (!manifest.exportedAt) {
    return { valid: false, reason: "Manifest exportedAt is missing" }
  }

  if (!manifest.expiresAt) {
    return { valid: false, reason: "Manifest expiresAt is missing" }
  }

  return { valid: true, reason: null }
}

/**
 * Check whether an export manifest has expired based on its expiresAt timestamp.
 */
export function isManifestExpired(manifest: PrismKvExportManifest): boolean {
  if (!manifest.expiresAt) {
    return true
  }

  const expiry = new Date(manifest.expiresAt).getTime()
  if (Number.isNaN(expiry)) {
    return true
  }

  return Date.now() > expiry
}
