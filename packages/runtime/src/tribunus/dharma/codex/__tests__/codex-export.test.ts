/**
 * Codex Phase 3 — Dataset Export Service Tests
 *
 * Covers: eligibility computation, grant verification, all 4 gates,
 * executeExport (scoped vs full), root invariant (canProduceCompleteCorpus),
 * createReleaseManifest, computeManifestDigest.
 */

import { describe, test, expect } from "bun:test"
import type {
  CodexEntry,
  CodexVisibilityClass,
  CodexEntryStatus,
  KnowledgeClass,
  EvidenceQuality,
  DatasetExportGrant,
  DatasetExportAuthority,
  FullDatasetExportAuthorization,
  DatasetExportReceipt,
  CodexDatasetRelease,
  DatasetProjection,
} from "../codex-types"
import {
  computeDatasetEligibility,
  isDatasetEligible,
  allowedReleaseClass,
  canExportEntry,
  canExportFullCorpus,
  verifyExportAuthorization,
  gateValidateIdentity,
  gateResolvePolicyScope,
  gateVerifyFullAuthorization,
  gateEmitReceipt,
  executeExport,
  createReleaseManifest,
  computeManifestDigest,
  createProjection,
  isScopedExportAllowed,
  isPublicReleaseAllowed,
  isFullExportAuthValid,
  canProduceCompleteCorpus,
  type ExportRequest,
  type ExportResult,
} from "../codex-export"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePublishedEntry(
  overrides?: Omit<Partial<CodexEntry>, "quality"> & {
    canonicalId?: string
    visibilityClass?: CodexVisibilityClass
    knowledgeClass?: KnowledgeClass
    quality?: EvidenceQuality
  },
): CodexEntry {
  const applied = overrides ?? {}
  return {
    codexEntryId: applied.canonicalId ?? "entry-test-1",
    schemaVersion: 1,
    status: applied.status ?? "published",
    visibilityClass: applied.visibilityClass ?? "contributor",
    knowledgeClass: applied.knowledgeClass ?? "performance_evidence",
    title: "Test Entry",
    abstract: "test",
    claims: applied.claims ?? [],
    canonicalContentDigest: "abc123",
    sourceContributionIds: applied.sourceContributionIds ?? ["contrib-1"],
    sourceArtifactRefs: [],
    evidenceRefs: applied.evidenceRefs ?? [],
    provenance: {
      createdFromReceiptIds: ["receipt-1"],
      derivationPolicyVersion: "1.0.0",
      ingestionMode: "curator_approved",
      authoredBy: ["auth-1"],
      approvedBy: [],
      createdAtLogicalTime: "2025-01-01T00:00:00.000Z",
    },
    quality: {
      evidenceQuality: applied.quality ?? "medium",
      corroborationCount: 2,
      reproducibilityStatus: "unverified",
      confidence: 0.8,
    },
    semanticIndex: {
      embeddingModelDigest: "",
      embeddingVectorRef: "",
      lexicalTerms: [],
      entityRefs: [],
    },
    lineage: {
      supersedes: null,
      supersededBy: null,
      relatedEntryIds: [],
    },
    policy: {
      queryEligibility: "all",
      derivativeUsePolicy: "research_only",
      benefitPolicyId: "",
    },
    signatures: [],
  }
}

function makeGrant(
  overrides: Partial<DatasetExportGrant> = {},
): DatasetExportGrant {
  return {
    grantId: "grant-1",
    subjectIdentity: "user-1",
    authority: "scoped_export",
    allowedVisibilityClasses: ["session", "contributor"],
    allowedProjectionClasses: ["claims", "episodes"],
    maxScope: undefined,
    expiresAtLogicalTime: undefined,
    issuedBy: "admin-1",
    signature: "sig-abc",
    ...overrides,
  }
}

function makeFullAuth(
  overrides: Partial<FullDatasetExportAuthorization> = {},
): FullDatasetExportAuthorization {
  return {
    authorizationId: "auth-1",
    requestedBy: "user-1",
    exportManifestDigest: "digest-abc",
    sourceSnapshot: {
      autobaseHeads: ["head-1", "head-2"],
      codexSchemaVersion: "1.0.0",
      datasetProjectionVersion: "1.0.0",
    },
    releasePolicyDigest: "policy-digest-abc",
    recipientBinding: undefined,
    issuedAtLogicalTime: "2025-01-01T00:00:00.000Z",
    expiresAtLogicalTime: "2099-12-31T23:59:59.999Z",
    rootAuthoritySignature: "root-sig-abc",
    ...overrides,
  }
}

function makeScopedRequest(
  overrides: Partial<ExportRequest> = {},
): ExportRequest {
  return {
    requestedBy: "user-1",
    exportClass: "scoped",
    requestedVisibilityClasses: ["session", "contributor"],
    requestedProjectionClasses: ["claims", "episodes"],
    ...overrides,
  }
}

function makeFullExportRequest(
  overrides: Partial<ExportRequest> = {},
): ExportRequest {
  return {
    requestedBy: "user-1",
    exportClass: "full",
    requestedVisibilityClasses: ["session", "contributor", "public"],
    requestedProjectionClasses: ["claims", "episodes", "evaluations", "analytics"],
    ...overrides,
  }
}

// ── Tests: Eligibility ───────────────────────────────────────────────────────

describe("computeDatasetEligibility", () => {
  test("published entry with high quality is eligible", () => {
    const entry = makePublishedEntry({
      visibilityClass: "public",
      quality: "high",
    })
    const eligibility = computeDatasetEligibility(entry)
    expect(eligibility.eligible).toBe(true)
    expect(eligibility.releaseClass).toBe("public_open")
  })

  test("published entry with medium quality contributor visibility is eligible as research_partner", () => {
    const entry = makePublishedEntry({
      visibilityClass: "contributor",
      quality: "medium",
    })
    const eligibility = computeDatasetEligibility(entry)
    expect(eligibility.eligible).toBe(true)
    expect(eligibility.releaseClass).toBe("research_partner")
  })

  test("draft entry is not eligible", () => {
    const entry = makePublishedEntry({ quality: "high" })
    entry.status = "draft" as CodexEntryStatus
    const eligibility = computeDatasetEligibility(entry)
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.releaseClass).toBe("internal_only")
  })

  test("entry with low quality is not eligible", () => {
    const entry = makePublishedEntry({ quality: "low" })
    const eligibility = computeDatasetEligibility(entry)
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.releaseClass).toBe("internal_only")
  })
})

describe("isDatasetEligible", () => {
  test("returns true when eligible field is true", () => {
    const eligibility = computeDatasetEligibility(
      makePublishedEntry({ quality: "high", visibilityClass: "public" }),
    )
    expect(isDatasetEligible(eligibility)).toBe(true)
  })

  test("returns false when eligible field is false", () => {
    const eligibility = computeDatasetEligibility(
      makePublishedEntry({ quality: "low" }),
    )
    expect(isDatasetEligible(eligibility)).toBe(false)
  })
})

describe("allowedReleaseClass", () => {
  test("public entry with high quality returns public_open", () => {
    const entry = makePublishedEntry({ visibilityClass: "public", quality: "high" })
    expect(allowedReleaseClass(entry)).toBe("public_open")
  })

  test("public entry with medium quality returns research_partner", () => {
    const entry = makePublishedEntry({ visibilityClass: "public", quality: "medium" })
    expect(allowedReleaseClass(entry)).toBe("research_partner")
  })

  test("contributor entry returns research_partner", () => {
    const entry = makePublishedEntry({ visibilityClass: "contributor", quality: "medium" })
    expect(allowedReleaseClass(entry)).toBe("research_partner")
  })

  test("session entry returns internal_only", () => {
    const entry = makePublishedEntry({ visibilityClass: "session", quality: "high" })
    expect(allowedReleaseClass(entry)).toBe("internal_only")
  })

  test("draft entry returns internal_only", () => {
    const entry = makePublishedEntry({ quality: "high" })
    entry.status = "draft" as CodexEntryStatus
    expect(allowedReleaseClass(entry)).toBe("internal_only")
  })
})

// ── Tests: Grant Verification ────────────────────────────────────────────────

describe("canExportEntry", () => {
  test("grant with matching visibility class allows export", () => {
    const grant = makeGrant({
      authority: "scoped_export",
      allowedVisibilityClasses: ["session", "contributor"],
    })
    const entry = makePublishedEntry({ visibilityClass: "contributor" })
    expect(canExportEntry(grant, entry)).toBe(true)
  })

  test("grant with insufficient authority rejects public entry", () => {
    const grant = makeGrant({
      authority: "scoped_export",
      allowedVisibilityClasses: ["session", "contributor", "public"],
    })
    const entry = makePublishedEntry({ visibilityClass: "public" })
    expect(canExportEntry(grant, entry)).toBe(false)
  })

  test("grant with none authority rejects all", () => {
    const grant = makeGrant({ authority: "none" })
    const entry = makePublishedEntry({ visibilityClass: "session" })
    expect(canExportEntry(grant, entry)).toBe(false)
  })

  test("grant without required visibility class rejects entry", () => {
    const grant = makeGrant({
      authority: "full_dataset_export",
      allowedVisibilityClasses: ["session"],
    })
    const entry = makePublishedEntry({ visibilityClass: "contributor" })
    expect(canExportEntry(grant, entry)).toBe(false)
  })

  test("expired grant rejects export", () => {
    const grant = makeGrant({
      authority: "scoped_export",
      expiresAtLogicalTime: "2020-01-01T00:00:00.000Z",
    })
    const entry = makePublishedEntry({ visibilityClass: "contributor" })
    expect(canExportEntry(grant, entry)).toBe(false)
  })

  test("grant with maxScope contributorIds filters non-matching entries", () => {
    const grant = makeGrant({
      authority: "scoped_export",
      maxScope: { contributorIds: ["auth-2"] },
    })
    const entry = makePublishedEntry({ visibilityClass: "contributor" })
    expect(canExportEntry(grant, entry)).toBe(false)
  })

  test("grant with matching maxScope contributorIds allows entry", () => {
    const grant = makeGrant({
      authority: "scoped_export",
      maxScope: { contributorIds: ["auth-1"] },
    })
    const entry = makePublishedEntry({ visibilityClass: "contributor" })
    expect(canExportEntry(grant, entry)).toBe(true)
  })

  test("public_release grant allows public entry", () => {
    const grant = makeGrant({
      authority: "public_release",
      allowedVisibilityClasses: ["session", "contributor", "public"],
    })
    const entry = makePublishedEntry({ visibilityClass: "public" })
    expect(canExportEntry(grant, entry)).toBe(true)
  })

  test("full_dataset_export grant allows public entry", () => {
    const grant = makeGrant({
      authority: "full_dataset_export",
      allowedVisibilityClasses: ["session", "contributor", "public"],
    })
    const entry = makePublishedEntry({ visibilityClass: "public" })
    expect(canExportEntry(grant, entry)).toBe(true)
  })
})

describe("canExportFullCorpus", () => {
  test("non-null valid auth returns true", () => {
    const auth = makeFullAuth()
    expect(canExportFullCorpus(auth)).toBe(true)
  })

  test("null auth returns false", () => {
    expect(canExportFullCorpus(null)).toBe(false)
  })

  test("auth without signature returns false", () => {
    const auth = makeFullAuth({ rootAuthoritySignature: "" })
    expect(canExportFullCorpus(auth)).toBe(false)
  })

  test("expired auth returns false", () => {
    const auth = makeFullAuth({
      expiresAtLogicalTime: "2020-01-01T00:00:00.000Z",
    })
    expect(canExportFullCorpus(auth)).toBe(false)
  })
})

describe("verifyExportAuthorization", () => {
  test("valid authorization passes verification", () => {
    expect(verifyExportAuthorization(makeFullAuth())).toBe(true)
  })

  test("null auth fails", () => {
    expect(verifyExportAuthorization(null as unknown as FullDatasetExportAuthorization)).toBe(false)
  })

  test("missing authorizationId fails", () => {
    const auth = makeFullAuth({ authorizationId: "" })
    expect(verifyExportAuthorization(auth)).toBe(false)
  })

  test("missing sourceSnapshot autobaseHeads fails", () => {
    const auth = makeFullAuth()
    auth.sourceSnapshot.autobaseHeads = []
    expect(verifyExportAuthorization(auth)).toBe(false)
  })

  test("expired auth fails", () => {
    const auth = makeFullAuth({
      expiresAtLogicalTime: "2020-01-01T00:00:00.000Z",
    })
    expect(verifyExportAuthorization(auth)).toBe(false)
  })

  test("missing signature fails", () => {
    const auth = makeFullAuth({ rootAuthoritySignature: "" })
    expect(verifyExportAuthorization(auth)).toBe(false)
  })
})

// ── Tests: 4 Gates ───────────────────────────────────────────────────────────

describe("gateValidateIdentity", () => {
  test("matching identity passes", () => {
    const request = makeScopedRequest({ requestedBy: "alice" })
    const result = gateValidateIdentity(request, "alice")
    expect(result.passed).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("non-matching identity fails", () => {
    const request = makeScopedRequest({ requestedBy: "alice" })
    const result = gateValidateIdentity(request, "bob")
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("does not match")
  })
})

describe("gateResolvePolicyScope", () => {
  test("full export class passes without grant", () => {
    const request = makeFullExportRequest()
    const result = gateResolvePolicyScope(request, null)
    expect(result.passed).toBe(true)
  })

  test("scoped export with valid grant passes", () => {
    const request = makeScopedRequest()
    const grant = makeGrant()
    const result = gateResolvePolicyScope(request, grant)
    expect(result.passed).toBe(true)
  })

  test("scoped export with no grant fails", () => {
    const request = makeScopedRequest()
    const result = gateResolvePolicyScope(request, null)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("No export grant")
  })

  test("scoped export with none authority fails", () => {
    const request = makeScopedRequest()
    const grant = makeGrant({ authority: "none" })
    const result = gateResolvePolicyScope(request, grant)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("no export authority")
  })

  test("scoped export with disallowed visibility class fails", () => {
    const request = makeScopedRequest({
      requestedVisibilityClasses: ["session", "contributor", "public"],
    })
    const grant = makeGrant({ allowedVisibilityClasses: ["session"] })
    const result = gateResolvePolicyScope(request, grant)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("not in grant")
  })

  test("public export with insufficient grant authority fails", () => {
    const request = makeScopedRequest({ exportClass: "public" })
    const grant = makeGrant({ authority: "scoped_export" })
    const result = gateResolvePolicyScope(request, grant)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("does not permit public release")
  })

  test("public export with public_release authority passes", () => {
    const request = makeScopedRequest({ exportClass: "public" })
    const grant = makeGrant({
      authority: "public_release",
      allowedVisibilityClasses: ["session", "contributor", "public"],
    })
    const result = gateResolvePolicyScope(request, grant)
    expect(result.passed).toBe(true)
  })

  test("expired grant fails", () => {
    const request = makeScopedRequest()
    const grant = makeGrant({
      expiresAtLogicalTime: "2020-01-01T00:00:00.000Z",
    })
    const result = gateResolvePolicyScope(request, grant)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("expired")
  })
})

describe("gateVerifyFullAuthorization", () => {
  test("scoped export passes without auth", () => {
    const request = makeScopedRequest()
    const result = gateVerifyFullAuthorization(request, null)
    expect(result.passed).toBe(true)
  })

  test("full export with valid auth passes", () => {
    const request = makeFullExportRequest()
    const auth = makeFullAuth()
    const result = gateVerifyFullAuthorization(request, auth)
    expect(result.passed).toBe(true)
  })

  test("full export without auth fails", () => {
    const request = makeFullExportRequest()
    const result = gateVerifyFullAuthorization(request, null)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("requires a FullDatasetExportAuthorization")
  })

  test("full export with invalid auth fails", () => {
    const request = makeFullExportRequest()
    const auth = makeFullAuth({ rootAuthoritySignature: "" })
    const result = gateVerifyFullAuthorization(request, auth)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain("failed verification")
  })
})

describe("gateEmitReceipt", () => {
  test("returns the receipt from the result", () => {
    const receipt: DatasetExportReceipt = {
      receiptId: "test-receipt",
      exportManifestDigest: "digest",
      requester: "user-1",
      authorityUsed: "scoped_export",
      entryCount: 5,
      excludedEntryCount: 2,
      visibilityClassesIncluded: ["contributor"],
      outputDigest: "output-abc",
      recipientBinding: undefined,
      logicalTime: "2025-01-01T00:00:00.000Z",
      authorizedBy: ["admin-1"],
      signatures: [],
    }
    const result: ExportResult = {
      receipt,
      entries: [],
      excludedCount: 2,
      error: null,
    }
    expect(gateEmitReceipt(result)).toBe(receipt)
  })
})

// ── Tests: executeExport ─────────────────────────────────────────────────────

describe("executeExport — scoped", () => {
  test("successful scoped export returns filtered entries and receipt", () => {
    const request = makeScopedRequest()
    const grant = makeGrant()
    const entry1 = makePublishedEntry({ canonicalId: "entry-1", visibilityClass: "contributor" })
    const entry2 = makePublishedEntry({ canonicalId: "entry-2", visibilityClass: "session" })
    const draftEntry = makePublishedEntry({ canonicalId: "entry-draft", visibilityClass: "contributor" })
    draftEntry.status = "draft" as CodexEntryStatus

    const result = executeExport(request, [entry1, entry2, draftEntry], grant, null, "user-1")

    expect(result.error).toBeNull()
    expect(result.entries.length).toBe(2)
    expect(result.entries[0].codexEntryId).toBe("entry-1")
    expect(result.entries[1].codexEntryId).toBe("entry-2")
    expect(result.excludedCount).toBe(1) // draft excluded
    expect(result.receipt.entryCount).toBe(2)
    expect(result.receipt.excludedEntryCount).toBe(1)
    expect(result.receipt.authorityUsed).toBe("scoped_export")
  })

  test("identity gate failure returns error", () => {
    const request = makeScopedRequest({ requestedBy: "alice" })
    const grant = makeGrant()
    const entry = makePublishedEntry()
    const result = executeExport(request, [entry], grant, null, "bob")
    expect(result.error).not.toBeNull()
    expect(result.error).toContain("does not match")
    expect(result.entries.length).toBe(0)
  })

  test("scope gate failure returns error", () => {
    const request = makeScopedRequest()
    const result = executeExport(request, [], null, null, "user-1")
    expect(result.error).not.toBeNull()
    expect(result.error).toContain("No export grant")
  })

  test("entry with visibility not in grant is excluded", () => {
    const request = makeScopedRequest({
      requestedVisibilityClasses: ["session"],
    })
    const grant = makeGrant({
      allowedVisibilityClasses: ["session"],
    })
    const entry1 = makePublishedEntry({ canonicalId: "entry-1", visibilityClass: "session" })
    const entry2 = makePublishedEntry({ canonicalId: "entry-2", visibilityClass: "contributor" })

    const result = executeExport(request, [entry1, entry2], grant, null, "user-1")
    expect(result.error).toBeNull()
    expect(result.entries.length).toBe(1)
    expect(result.entries[0].codexEntryId).toBe("entry-1")
    expect(result.excludedCount).toBe(1)
  })

  test("entry-level filter by contributor IDs works", () => {
    const request = makeScopedRequest({
      entryFilter: { contributorIds: ["auth-1"] },
    })
    const grant = makeGrant()
    const entry1 = makePublishedEntry({ canonicalId: "entry-1" })
    const entry2 = makePublishedEntry({ canonicalId: "entry-2" })
    entry2.provenance.authoredBy = ["auth-2"]

    const result = executeExport(request, [entry1, entry2], grant, null, "user-1")
    expect(result.entries.length).toBe(1)
    expect(result.entries[0].codexEntryId).toBe("entry-1")
    expect(result.excludedCount).toBe(1)
  })

  test("entry-level filter by min evidence quality works", () => {
    const request = makeScopedRequest({
      entryFilter: { minEvidenceQuality: "high" },
    })
    const grant = makeGrant()
    const entry1 = makePublishedEntry({ canonicalId: "entry-1", quality: "high" })
    const entry2 = makePublishedEntry({ canonicalId: "entry-2", quality: "medium" })
    const entry3 = makePublishedEntry({ canonicalId: "entry-3", quality: "low" })

    const result = executeExport(request, [entry1, entry2, entry3], grant, null, "user-1")
    expect(result.entries.length).toBe(1)
    expect(result.entries[0].codexEntryId).toBe("entry-1")
    expect(result.excludedCount).toBe(2)
  })
})

describe("executeExport — full", () => {
  test("successful full export returns all eligible entries", () => {
    const request = makeFullExportRequest()
    const grant = makeGrant({ authority: "full_dataset_export" })
    const auth = makeFullAuth()
    const entry1 = makePublishedEntry({ canonicalId: "entry-1", visibilityClass: "public" })
    const entry2 = makePublishedEntry({ canonicalId: "entry-2", visibilityClass: "contributor" })

    const result = executeExport(request, [entry1, entry2], grant, auth, "user-1")

    expect(result.error).toBeNull()
    expect(result.entries.length).toBe(2)
    expect(result.receipt.authorityUsed).toBe("full_dataset_export")
  })

  test("full export without auth fails gate 3", () => {
    const request = makeFullExportRequest()
    const grant = makeGrant({ authority: "full_dataset_export" })
    const entry = makePublishedEntry()

    const result = executeExport(request, [entry], grant, null, "user-1")

    expect(result.error).not.toBeNull()
    expect(result.error).toContain("requires a FullDatasetExportAuthorization")
    expect(result.entries.length).toBe(0)
  })

  test("full export with invalid auth fails gate 3", () => {
    const request = makeFullExportRequest()
    const grant = makeGrant({ authority: "full_dataset_export" })
    const auth = makeFullAuth({ rootAuthoritySignature: "" })
    const entry = makePublishedEntry()

    const result = executeExport(request, [entry], grant, auth, "user-1")

    expect(result.error).not.toBeNull()
    expect(result.entries.length).toBe(0)
  })

  test("full export excludes non-published entries", () => {
    const request = makeFullExportRequest()
    const grant = makeGrant({ authority: "full_dataset_export" })
    const auth = makeFullAuth()
    const entry1 = makePublishedEntry({ canonicalId: "entry-1" })
    const entry2 = makePublishedEntry({ canonicalId: "entry-2" })
    entry2.status = "superseded" as CodexEntryStatus

    const result = executeExport(request, [entry1, entry2], grant, auth, "user-1")

    expect(result.error).toBeNull()
    expect(result.entries.length).toBe(1)
    expect(result.entries[0].codexEntryId).toBe("entry-1")
    expect(result.excludedCount).toBe(1)
  })
})

// ── Tests: Release Manifest ──────────────────────────────────────────────────

describe("createReleaseManifest", () => {
  test("creates manifest with correct projections from entries", () => {
    const entry1 = makePublishedEntry({
      canonicalId: "entry-1",
      claims: [{
        claimId: "claim-1",
        statement: "test",
        claimType: "fact",
        supportRefs: [],
        scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
        confidence: 0.9,
      }],
    })
    const entries = [entry1]

    const manifest = createReleaseManifest(entries, "dataset-v1", "1.0.0")

    expect(manifest.datasetId).toBe("dataset-v1")
    expect(manifest.version).toBe("1.0.0")
    expect(manifest.projections.length).toBe(2) // claims + episodes
    expect(manifest.sourceCodexSnapshot.entryCount).toBe(1)
    expect(manifest.sourceCodexSnapshot.claimCount).toBe(1)
    expect(manifest.splitPolicy.train).toBe("0.80")
    expect(manifest.splitPolicy.test).toBe("0.10")
  })

  test("creates manifest with empty entries", () => {
    const manifest = createReleaseManifest([], "empty-ds", "0.0.1")
    expect(manifest.projections.length).toBe(0)
    expect(manifest.sourceCodexSnapshot.entryCount).toBe(0)
    expect(manifest.sourceCodexSnapshot.claimCount).toBe(0)
  })
})

describe("computeManifestDigest", () => {
  test("returns a consistent hex digest for the same manifest", () => {
    const manifest = createReleaseManifest(
      [makePublishedEntry({ canonicalId: "entry-1" })],
      "ds-1",
      "1.0.0",
    )
    const digest1 = computeManifestDigest(manifest)
    const digest2 = computeManifestDigest(manifest)

    expect(digest1).toBe(digest2)
    expect(digest1.length).toBe(64) // SHA-256 hex
  })

  test("returns different digests for different manifests", () => {
    const m1 = createReleaseManifest(
      [makePublishedEntry({ canonicalId: "entry-1" })],
      "ds-1",
      "1.0.0",
    )
    const m2 = createReleaseManifest(
      [makePublishedEntry({ canonicalId: "entry-2" })],
      "ds-2",
      "2.0.0",
    )

    expect(computeManifestDigest(m1)).not.toBe(computeManifestDigest(m2))
  })
})

describe("createProjection", () => {
  test("creates projection with correct entry count", () => {
    const entries = [
      makePublishedEntry({ canonicalId: "e1" }),
      makePublishedEntry({ canonicalId: "e2" }),
    ]
    const projection = createProjection(entries, "claims")
    expect(projection.projectionClass).toBe("claims")
    expect(projection.entryCount).toBe(2)
    expect(projection.format).toBe("jsonl")
    expect(projection.storageRef).toContain("claims")
  })

  test("creates projection with zero entries", () => {
    const projection = createProjection([], "analytics")
    expect(projection.entryCount).toBe(0)
    expect(projection.projectionClass).toBe("analytics")
  })
})

// ── Tests: Authority Helpers ─────────────────────────────────────────────────

describe("isScopedExportAllowed", () => {
  test("scoped_export authority returns true", () => {
    expect(isScopedExportAllowed(makeGrant({ authority: "scoped_export" }))).toBe(true)
  })

  test("public_release authority returns true", () => {
    expect(isScopedExportAllowed(makeGrant({ authority: "public_release" }))).toBe(true)
  })

  test("none authority returns false", () => {
    expect(isScopedExportAllowed(makeGrant({ authority: "none" }))).toBe(false)
  })

  test("null grant returns false", () => {
    expect(isScopedExportAllowed(null as unknown as DatasetExportGrant)).toBe(false)
  })
})

describe("isPublicReleaseAllowed", () => {
  test("public_release authority returns true", () => {
    expect(isPublicReleaseAllowed(makeGrant({ authority: "public_release" }))).toBe(true)
  })

  test("full_dataset_export authority returns true", () => {
    expect(isPublicReleaseAllowed(makeGrant({ authority: "full_dataset_export" }))).toBe(true)
  })

  test("scoped_export authority returns false", () => {
    expect(isPublicReleaseAllowed(makeGrant({ authority: "scoped_export" }))).toBe(false)
  })
})

describe("isFullExportAuthValid", () => {
  test("valid auth returns true", () => {
    expect(isFullExportAuthValid(makeFullAuth())).toBe(true)
  })

  test("null auth returns false", () => {
    expect(isFullExportAuthValid(null)).toBe(false)
  })

  test("expired auth returns false", () => {
    const auth = makeFullAuth({ expiresAtLogicalTime: "2020-01-01T00:00:00.000Z" })
    expect(isFullExportAuthValid(auth)).toBe(false)
  })

  test("auth without signature returns false", () => {
    const auth = makeFullAuth({ rootAuthoritySignature: "" })
    expect(isFullExportAuthValid(auth)).toBe(false)
  })
})

// ── Root Invariant ───────────────────────────────────────────────────────────

describe("canProduceCompleteCorpus — root invariant", () => {
  test("valid auth + full_dataset_export grant returns true", () => {
    const auth = makeFullAuth()
    const grant = makeGrant({ authority: "full_dataset_export" })
    expect(canProduceCompleteCorpus(auth, grant)).toBe(true)
  })

  test("null auth with full_dataset_export grant returns false", () => {
    const grant = makeGrant({ authority: "full_dataset_export" })
    expect(canProduceCompleteCorpus(null, grant)).toBe(false)
  })

  test("valid auth with null grant returns false", () => {
    const auth = makeFullAuth()
    expect(canProduceCompleteCorpus(auth, null)).toBe(false)
  })

  test("valid auth with scoped_export grant returns false", () => {
    const auth = makeFullAuth()
    const grant = makeGrant({ authority: "scoped_export" })
    expect(canProduceCompleteCorpus(auth, grant)).toBe(false)
  })

  test("valid auth with none grant returns false", () => {
    const auth = makeFullAuth()
    const grant = makeGrant({ authority: "none" })
    expect(canProduceCompleteCorpus(auth, grant)).toBe(false)
  })

  test("expired auth with full_dataset_export grant returns false", () => {
    const auth = makeFullAuth({ expiresAtLogicalTime: "2020-01-01T00:00:00.000Z" })
    const grant = makeGrant({ authority: "full_dataset_export" })
    expect(canProduceCompleteCorpus(auth, grant)).toBe(false)
  })

  test("auth without signature with full_dataset_export grant returns false", () => {
    const auth = makeFullAuth({ rootAuthoritySignature: "" })
    const grant = makeGrant({ authority: "full_dataset_export" })
    expect(canProduceCompleteCorpus(auth, grant)).toBe(false)
  })

  test("null auth + null grant returns false", () => {
    expect(canProduceCompleteCorpus(null, null)).toBe(false)
  })
})
