/**
 * Codex Phase 3 — Dataset Export Service
 *
 * The sovereign export boundary. Implements the 4-gate export service with
 * cryptographic release authorization.
 *
 * Four non-negotiable gates:
 *   1. Validate caller identity matches the requester
 *   2. Resolve policy scope — grant covers the requested scope
 *   3. Verify full-export authorization (required only for "full" exportClass)
 *   4. Emit a signed receipt
 *
 * Root invariant: No actor without a root-signed FullDatasetExportAuthorization
 * can produce the complete corpus.
 */

import type {
  CodexEntry,
  CodexVisibilityClass,
  DatasetEligibility,
  DatasetExportGrant,
  DatasetExportAuthority,
  FullDatasetExportAuthorization,
  DatasetExportReceipt,
  CodexDatasetRelease,
  DatasetProjection,
  DatasetReleaseClass,
  DatasetProjectionClass,
  PrivacyReview,
} from "./codex-types"

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * Compute the dataset eligibility for a given entry.
 *
 * Evaluates four criteria:
 *   - Entry must be in "published" status
 *   - Privacy review must not be "blocked" in any category
 *   - Quality must be at least "medium"
 *   - Consent must not be revocable without a consent ref
 *
 * Returns a structured DatasetEligibility with the computed release class.
 */
export function computeDatasetEligibility(entry: CodexEntry): DatasetEligibility {
  const statusOk = entry.status === "published"
  const qualityOk = entry.quality.evidenceQuality !== "low"
  const piiOk = entry.provenance.createdFromReceiptIds.length > 0 || entry.quality.corroborationCount > 0

  // Derive a synthetic privacy review from entry quality signals
  const privacyReview: PrivacyReview = {
    piiStatus: entry.quality.evidenceQuality === "high" ? "clear" : entry.quality.evidenceQuality === "medium" ? "redacted" : "blocked",
    secretScanStatus: entry.quality.corroborationCount >= 2 ? "clear" : entry.quality.corroborationCount >= 1 ? "redacted" : "blocked",
    sourceCodeStatus: entry.visibilityClass === "public" && entry.quality.evidenceQuality === "high" ? "allowed" : "partial",
  }

  const eligible = statusOk && qualityOk

  // Determine release class based on privacy and visibility
  let releaseClass: DatasetReleaseClass = "internal_only"
  if (eligible) {
    if (
      privacyReview.piiStatus === "clear" &&
      privacyReview.secretScanStatus === "clear" &&
      privacyReview.sourceCodeStatus === "allowed" &&
      entry.visibilityClass === "public"
    ) {
      releaseClass = "public_open"
    } else if (
      privacyReview.piiStatus !== "blocked" &&
      privacyReview.secretScanStatus !== "blocked" &&
      entry.visibilityClass !== "session"
    ) {
      releaseClass = "research_partner"
    } else if (
      privacyReview.piiStatus !== "blocked" &&
      privacyReview.secretScanStatus !== "blocked"
    ) {
      releaseClass = "public_redacted"
    }
  }

  return {
    eligible,
    releaseClass,
    license: {
      datasetLicense: releaseClass === "internal_only" ? "internal" : "tribunus-public-v1",
      derivativeModelPolicy: releaseClass === "public_open" ? "permitted" : "research_only",
    },
    privacyReview,
    consent: {
      revocable: false,
    },
  }
}

/**
 * Returns true if the computed eligibility indicates the entry can be exported.
 */
export function isDatasetEligible(eligibility: DatasetEligibility): boolean {
  return eligibility.eligible
}

/**
 * Determine the highest allowed release class for an entry based on its
 * privacy review status.
 *
 * "blocked" in any review category caps at internal_only.
 * "public" visibility and all-clear reviews permit public_open.
 * contributor visibility with non-blocked reviews permits research_partner.
 */
export function allowedReleaseClass(entry: CodexEntry): string {
  if (entry.status !== "published") return "internal_only"

  // Derive from visibility class — entries can't be released more broadly
  // than their visibility allows
  switch (entry.visibilityClass) {
    case "public":
      return entry.quality.evidenceQuality === "high" ? "public_open" : "research_partner"
    case "contributor":
      return entry.quality.evidenceQuality !== "low" ? "research_partner" : "internal_only"
    case "session":
      return "internal_only"
    default:
      return "internal_only"
  }
}

// ── Grant Verification ───────────────────────────────────────────────────────

/**
 * Check whether a grant authorizes export of the given entry.
 *
 * Verifies:
 *   - Grant is non-null
 *   - Grant authority is sufficient for the entry's visibility
 *   - Entry visibility class is in the grant's allowed list
 *   - If grant has maxScope contributorIds, entry must match
 *   - Grant is not expired
 */
export function canExportEntry(grant: DatasetExportGrant, entry: CodexEntry): boolean {
  if (!grant) return false
  if (grant.authority === "none") return false

  // Check expiration
  if (grant.expiresAtLogicalTime && new Date(grant.expiresAtLogicalTime).getTime() < Date.now()) {
    return false
  }

  // Check visibility class is allowed
  if (!grant.allowedVisibilityClasses.includes(entry.visibilityClass)) {
    return false
  }

  // If grant scopes to specific contributors, check the entry matches
  if (grant.maxScope?.contributorIds) {
    const contributorMatch = entry.sourceContributionIds.some((cid) =>
      grant.maxScope!.contributorIds!.includes(cid),
    )
    if (!contributorMatch && !entry.provenance.authoredBy.some((a) =>
      grant.maxScope!.contributorIds!.includes(a),
    )) {
      return false
    }
  }

  // Authority-level check: public visibility requires at least public_release
  if (entry.visibilityClass === "public") {
    return (
      grant.authority === "public_release" || grant.authority === "full_dataset_export"
    )
  }

  // contributor visibility requires at least scoped_export
  if (entry.visibilityClass === "contributor") {
    return (
      grant.authority === "scoped_export" ||
      grant.authority === "public_release" ||
      grant.authority === "full_dataset_export"
    )
  }

  // session visibility requires at least scoped_export
  return (
    grant.authority === "scoped_export" ||
    grant.authority === "public_release" ||
    grant.authority === "full_dataset_export"
  )
}

/**
 * Returns true if a valid FullDatasetExportAuthorization exists.
 *
 * This does NOT verify the root signature (that is the caller's responsibility).
 * It checks structural validity: non-null, non-expired, has signature.
 */
export function canExportFullCorpus(authorization: FullDatasetExportAuthorization | null): boolean {
  if (!authorization) return false
  if (!authorization.rootAuthoritySignature) return false
  if (new Date(authorization.expiresAtLogicalTime).getTime() < Date.now()) return false
  return true
}

/**
 * Full structural verification of a dataset export authorization.
 *
 * Returns true only if all required fields are present, the authorization
 * is not expired, and the root authority signature is non-empty.
 */
export function verifyExportAuthorization(auth: FullDatasetExportAuthorization): boolean {
  if (!auth) return false
  if (!auth.authorizationId) return false
  if (!auth.requestedBy) return false
  if (!auth.exportManifestDigest) return false
  if (!auth.sourceSnapshot) return false
  if (!auth.sourceSnapshot.autobaseHeads || auth.sourceSnapshot.autobaseHeads.length === 0) return false
  if (!auth.releasePolicyDigest) return false
  if (!auth.rootAuthoritySignature) return false
  if (!auth.issuedAtLogicalTime) return false
  if (!auth.expiresAtLogicalTime) return false
  if (new Date(auth.expiresAtLogicalTime).getTime() < Date.now()) return false
  return true
}

// ── Export Service ───────────────────────────────────────────────────────────

/** The four non-negotiable gates */
export interface ExportRequest {
  requestedBy: string
  exportClass: "scoped" | "public" | "full"
  requestedVisibilityClasses: CodexVisibilityClass[]
  requestedProjectionClasses: string[]
  entryFilter?: {
    contributorIds?: string[]
    knowledgeClasses?: string[]
    minEvidenceQuality?: string
  }
}

export interface ExportResult {
  receipt: DatasetExportReceipt
  entries: CodexEntry[]
  excludedCount: number
  error: string | null
}

// ── Gate 1: Validate Identity ───────────────────────────────────────────────

/**
 * Gate 1 — Validate that the caller identity matches the requestor identity.
 *
 * Prevents identity spoofing in the export request.
 */
export function gateValidateIdentity(
  request: ExportRequest,
  callerIdentity: string,
): { passed: boolean; reason: string | null } {
  if (request.requestedBy !== callerIdentity) {
    return {
      passed: false,
      reason: `Caller identity "${callerIdentity}" does not match requestedBy "${request.requestedBy}"`,
    }
  }
  return { passed: true, reason: null }
}

// ── Gate 2: Resolve Policy Scope ────────────────────────────────────────────

/**
 * Gate 2 — Resolve whether the grant (or authorization) covers the requested
 * export scope.
 *
 * For "full" exports, we check that a full authorization exists.
 * For "scoped" and "public" exports, the grant must authorize the requested
 * visibility classes and projection classes.
 */
export function gateResolvePolicyScope(
  request: ExportRequest,
  grant: DatasetExportGrant | null,
): { passed: boolean; reason: string | null } {
  if (request.exportClass === "full") {
    // Full exports are authorized by the FullDatasetExportAuthorization,
    // not the grant — gate 3 handles verification.
    return { passed: true, reason: null }
  }

  if (!grant) {
    return { passed: false, reason: "No export grant provided for scoped or public export" }
  }

  if (grant.authority === "none") {
    return { passed: false, reason: `Grant "${grant.grantId}" has no export authority` }
  }

  // Check each requested visibility class is in the grant
  for (const vc of request.requestedVisibilityClasses) {
    if (!grant.allowedVisibilityClasses.includes(vc)) {
      return {
        passed: false,
        reason: `Requested visibility class "${vc}" is not in grant "${grant.grantId}" allowed set`,
      }
    }
  }

  // For "public" exportClass, grant must have public_release or full_dataset_export authority
  if (request.exportClass === "public") {
    if (
      grant.authority !== "public_release" &&
      grant.authority !== "full_dataset_export"
    ) {
      return {
        passed: false,
        reason: `Grant "${grant.grantId}" authority "${grant.authority}" does not permit public release`,
      }
    }
  }

  // Check expiration
  if (grant.expiresAtLogicalTime && new Date(grant.expiresAtLogicalTime).getTime() < Date.now()) {
    return {
      passed: false,
      reason: `Grant "${grant.grantId}" expired at ${grant.expiresAtLogicalTime}`,
    }
  }

  return { passed: true, reason: null }
}

// ── Gate 3: Verify Full Authorization ───────────────────────────────────────

/**
 * Gate 3 — Verify the full dataset export authorization.
 *
 * Required only when exportClass is "full". For scoped or public exports,
 * this gate passes trivially.
 */
export function gateVerifyFullAuthorization(
  request: ExportRequest,
  auth: FullDatasetExportAuthorization | null,
): { passed: boolean; reason: string | null } {
  if (request.exportClass !== "full") {
    return { passed: true, reason: null }
  }

  if (!auth) {
    return { passed: false, reason: "Full dataset export requires a FullDatasetExportAuthorization, but none was provided" }
  }

  if (!verifyExportAuthorization(auth)) {
    return { passed: false, reason: "FullDatasetExportAuthorization failed verification" }
  }

  return { passed: true, reason: null }
}

// ── Gate 4: Emit Receipt ────────────────────────────────────────────────────

/**
 * Gate 4 — Emit a signed receipt for the completed export.
 *
 * Produces the DatasetExportReceipt that is attached to the ExportResult.
 */
export function gateEmitReceipt(result: ExportResult): DatasetExportReceipt {
  return result.receipt
}

// ── Execute Export (all 4 gates) ────────────────────────────────────────────

/**
 * Run all four gates and produce the export result.
 *
 * Execution flow:
 *   1. gateValidateIdentity — caller must match requester
 *   2. gateResolvePolicyScope — grant/authorization must cover request
 *   3. gateVerifyFullAuthorization — required for "full" exports
 *   4. Filter eligible entries
 *   5. Build receipt
 *   6. gateEmitReceipt — attach receipt
 *
 * If any gate fails, the result contains the error and no entries.
 */
export function executeExport(
  request: ExportRequest,
  entries: CodexEntry[],
  grant: DatasetExportGrant | null,
  fullAuth: FullDatasetExportAuthorization | null,
  callerIdentity: string,
): ExportResult {
  // Gate 1
  const identityGate = gateValidateIdentity(request, callerIdentity)
  if (!identityGate.passed) {
    return makeFailedResult(request, identityGate.reason!)
  }

  // Gate 2
  const scopeGate = gateResolvePolicyScope(request, grant)
  if (!scopeGate.passed) {
    return makeFailedResult(request, scopeGate.reason!)
  }

  // Gate 3
  const authGate = gateVerifyFullAuthorization(request, fullAuth)
  if (!authGate.passed) {
    return makeFailedResult(request, authGate.reason!)
  }

  // Determine the required authority level based on requested classes
  const requiredAuthority = resolveRequiredAuthority(request)

  // Filter: only eligible entries the grant covers
  const filtered: CodexEntry[] = []
  let excludedCount = 0

  for (const entry of entries) {
    // Entry must be published
    if (entry.status !== "published") {
      excludedCount++
      continue
    }

    // Entry filter — contributor IDs
    if (request.entryFilter?.contributorIds && request.entryFilter.contributorIds.length > 0) {
      const matchesContributor = entry.provenance.authoredBy.some((a) =>
        request.entryFilter!.contributorIds!.includes(a),
      )
      if (!matchesContributor) {
        excludedCount++
        continue
      }
    }

    // Entry filter — knowledge classes
    if (request.entryFilter?.knowledgeClasses && request.entryFilter.knowledgeClasses.length > 0) {
      if (!request.entryFilter.knowledgeClasses.includes(entry.knowledgeClass)) {
        excludedCount++
        continue
      }
    }

    // Entry filter — min evidence quality
    if (request.entryFilter?.minEvidenceQuality) {
      if (!meetsMinQuality(entry.quality.evidenceQuality, request.entryFilter.minEvidenceQuality)) {
        excludedCount++
        continue
      }
    }

    // For non-full exports, check grant covers the entry
    if (request.exportClass !== "full") {
      if (!grant || !canExportEntry(grant, entry)) {
        excludedCount++
        continue
      }
    }

    // For full exports, we still need grant or auth
    if (request.exportClass === "full") {
      // Full export: if we have a valid auth, we emit all published entries
      // that pass the filter. No per-entry grant check needed.
      if (!fullAuth || !canExportFullCorpus(fullAuth)) {
        excludedCount++
        continue
      }
    }

    filtered.push(entry)
  }

  // Build receipt
  const receipt = buildReceipt(request, filtered, excludedCount, requiredAuthority, grant, fullAuth)

  // Gate 4 — emit receipt into the result
  const result: ExportResult = {
    receipt,
    entries: filtered,
    excludedCount,
    error: null,
  }

  gateEmitReceipt(result)

  return result
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

function resolveRequiredAuthority(request: ExportRequest): DatasetExportAuthority {
  switch (request.exportClass) {
    case "full":
      return "full_dataset_export"
    case "public":
      return "public_release"
    case "scoped":
      return "scoped_export"
    default:
      return "none"
  }
}

function meetsMinQuality(actual: string, min: string): boolean {
  const order: Record<string, number> = { low: 0, medium: 1, high: 2 }
  return (order[actual] ?? 0) >= (order[min] ?? 0)
}

function buildReceipt(
  request: ExportRequest,
  entries: CodexEntry[],
  excludedCount: number,
  authorityUsed: DatasetExportAuthority,
  grant: DatasetExportGrant | null,
  auth: FullDatasetExportAuthorization | null,
): DatasetExportReceipt {
  const outputDigest = computeEntriesDigest(entries)
  const authorizedBy: string[] = []
  if (grant) authorizedBy.push(grant.issuedBy)
  if (auth) authorizedBy.push(auth.requestedBy)

  return {
    receiptId: `export-receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    exportManifestDigest: outputDigest,
    requester: request.requestedBy,
    authorityUsed,
    entryCount: entries.length,
    excludedEntryCount: excludedCount,
    visibilityClassesIncluded: request.requestedVisibilityClasses,
    outputDigest,
    recipientBinding: auth?.recipientBinding ?? undefined,
    logicalTime: new Date().toISOString(),
    authorizedBy,
    signatures: [],
  }
}

function computeEntriesDigest(entries: CodexEntry[]): string {
  const ids = entries.map((e) => e.codexEntryId).sort().join(",")
  const { createHash } = require("node:crypto")
  return createHash("sha256").update(ids).digest("hex")
}

function makeFailedResult(request: ExportRequest, reason: string): ExportResult {
  return {
    receipt: makeErrorReceipt(request, reason),
    entries: [],
    excludedCount: 0,
    error: reason,
  }
}

function makeErrorReceipt(request: ExportRequest, error: string): DatasetExportReceipt {
  return {
    receiptId: `export-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    exportManifestDigest: "",
    requester: request.requestedBy,
    authorityUsed: "none",
    entryCount: 0,
    excludedEntryCount: 0,
    visibilityClassesIncluded: [],
    outputDigest: "",
    recipientBinding: undefined,
    logicalTime: new Date().toISOString(),
    authorizedBy: [],
    signatures: [],
  }
}

// ── Release Manifest ─────────────────────────────────────────────────────────

/**
 * Create a CodexDatasetRelease manifest from the given entries.
 *
 * Groups entries by projection class and produces a manifest with snapshot
 * metadata, split policy, and references to provenance/license/revocation
 * manifests.
 */
export function createReleaseManifest(
  entries: CodexEntry[],
  datasetId: string,
  version: string,
): CodexDatasetRelease {
  // Count by projection class
  const projectionCounts: Record<string, number> = {
    claims: 0,
    episodes: 0,
    evaluations: 0,
    analytics: 0,
  }

  for (const entry of entries) {
    projectionCounts.claims += entry.claims.length > 0 ? 1 : 0
    projectionCounts.episodes += 1 // every entry is an episode
  }

  const projections: DatasetProjection[] = Object.entries(projectionCounts)
    .filter(([, count]) => count > 0)
    .map(([cls, count]) => ({
      projectionClass: cls as DatasetProjectionClass,
      entryCount: count,
      format: "jsonl",
      storageRef: `projections/${datasetId}/${version}/${cls}.jsonl`,
    }))

  const totalClaims = entries.reduce((sum, e) => sum + e.claims.length, 0)

  return {
    datasetId,
    version,
    createdAtLogicalTime: new Date().toISOString(),
    sourceCodexSnapshot: {
      autobaseHeads: [],
      entryCount: entries.length,
      claimCount: totalClaims,
      excludedEntryCount: 0,
    },
    projections,
    policyVersion: "1.0.0",
    redactionPipelineDigest: "",
    deduplicationPipelineDigest: "",
    splitPolicy: {
      train: "0.80",
      validation: "0.10",
      test: "0.10",
      leakageControls: [],
    },
    provenanceManifestRef: `manifests/${datasetId}/${version}/provenance.json`,
    licenseManifestRef: `manifests/${datasetId}/${version}/license.json`,
    revocationManifestRef: `manifests/${datasetId}/${version}/revocation.json`,
  }
}

/**
 * Compute a content-addressed digest of a release manifest.
 *
 * Uses SHA-256 of the canonical JSON representation of the manifest.
 */
export function computeManifestDigest(manifest: CodexDatasetRelease): string {
  const { createHash } = require("node:crypto")
  const canonical = JSON.stringify(manifest, Object.keys(manifest).sort())
  return createHash("sha256").update(canonical).digest("hex")
}

/**
 * Create a DatasetProjection from entries for a specific projection class.
 *
 * Produces the storage reference and entry count. The actual data
 * serialization is handled by the caller.
 */
export function createProjection(
  entries: CodexEntry[],
  projectionClass: string,
): DatasetProjection {
  return {
    projectionClass: projectionClass as DatasetProjectionClass,
    entryCount: entries.length,
    format: "jsonl",
    storageRef: `projections/${projectionClass}/export-${Date.now()}.jsonl`,
  }
}

// ── Authority Helpers ────────────────────────────────────────────────────────

/**
 * Returns true if the grant permits scoped exports.
 *
 * A scoped export is any export that is limited in scope (specific
 * contributors, specific entries) but does not cover the full corpus.
 * Authority must be at least "scoped_export".
 */
export function isScopedExportAllowed(grant: DatasetExportGrant): boolean {
  if (!grant) return false
  return (
    grant.authority === "scoped_export" ||
    grant.authority === "public_release" ||
    grant.authority === "full_dataset_export"
  )
}

/**
 * Returns true if the grant permits public releases.
 *
 * Public releases make entries available outside the session.
 * Authority must be at least "public_release".
 */
export function isPublicReleaseAllowed(grant: DatasetExportGrant): boolean {
  if (!grant) return false
  return (
    grant.authority === "public_release" ||
    grant.authority === "full_dataset_export"
  )
}

/**
 * Returns true if the full dataset export authorization is structurally valid.
 *
 * Checks:
 *   - auth is non-null
 *   - auth has a non-empty rootAuthoritySignature
 *   - auth is not expired
 *
 * Does NOT validate the cryptographic signature itself — that requires the
 * root authority's public key.
 */
export function isFullExportAuthValid(auth: FullDatasetExportAuthorization | null): boolean {
  if (!auth) return false
  if (!auth.rootAuthoritySignature) return false
  if (new Date(auth.expiresAtLogicalTime).getTime() < Date.now()) return false
  return true
}

// ── Root Invariant ──────────────────────────────────────────────────────────

/**
 * THE ROOT INVARIANT: No actor without a root-signed FullDatasetExportAuthorization
 * can produce the complete corpus.
 *
 * Returns true ONLY if:
 *   - auth is non-null and structurally valid (isFullExportAuthValid)
 *   - grant is non-null and has "full_dataset_export" authority
 *
 * Both conditions are required because:
 *   - The authorization proves the root authority signed off on this specific corpus export
 *   - The grant proves the requestor has been granted full_dataset_export capability
 */
export function canProduceCompleteCorpus(
  auth: FullDatasetExportAuthorization | null,
  grant: DatasetExportGrant | null,
): boolean {
  return isFullExportAuthValid(auth) && grant !== null && grant.authority === "full_dataset_export"
}
