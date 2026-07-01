/**
 * Phase 1 — Core Codex Types: Tests
 *
 * Verifies type construction, helper defaults, and error class behavior.
 */

import { describe, test, expect } from "bun:test"
import {
  createBenefitPolicy,
  createDatasetEligibility,
  createCodexEntry,
} from "../codex-types"
import type {
  CodexClaim,
  ScopeDescriptor,
  EvidenceRef,
  CodexEntryStatus,
  CodexVisibilityClass,
  KnowledgeClass,
  ClaimType,
  EvidenceQuality,
  ReproducibilityStatus,
  IngestionMode,
  QueryEligibility,
  DerivativeUsePolicy,
  CandidateStatus,
  DatasetReleaseClass,
  DatasetExportAuthority,
  DatasetProjectionClass,
  BenefitAllocationKind,
  BenefitPolicy,
  DatasetEligibility,
  CodexEntry,
  CodexBenefitEvent,
  CodexCandidate,
  CodexRevision,
  FullDatasetExportAuthorization,
  DatasetExportGrant,
  DatasetExportReceipt,
  CodexDatasetRelease,
  DatasetProjection,
} from "../codex-types"
import {
  CodexError,
  DatasetExportError,
  BenefitAccountingError,
} from "../codex-errors"

// ── Primitives ───────────────────────────────────────────────────────────────

describe("CodexEntryStatus", () => {
  test("all six statuses are assignable and distinct", () => {
    const all: CodexEntryStatus[] = [
      "draft",
      "proposed",
      "published",
      "superseded",
      "contested",
      "revoked",
    ]
    expect(new Set(all).size).toBe(6)
  })
})

describe("CodexVisibilityClass", () => {
  test("all three classes are assignable and distinct", () => {
    const all: CodexVisibilityClass[] = ["session", "contributor", "public"]
    expect(new Set(all).size).toBe(3)
  })
})

describe("KnowledgeClass", () => {
  test("all nine classes are assignable and distinct", () => {
    const all: KnowledgeClass[] = [
      "implementation_pattern",
      "architecture_decision",
      "debugging_finding",
      "performance_evidence",
      "compatibility_fact",
      "failure_mode",
      "governance_precedent",
      "research_result",
      "workflow_pattern",
    ]
    expect(new Set(all).size).toBe(9)
  })
})

describe("ClaimType", () => {
  test("all six claim types are assignable and distinct", () => {
    const all: ClaimType[] = [
      "fact",
      "procedure",
      "constraint",
      "recommendation",
      "measurement",
      "decision",
    ]
    expect(new Set(all).size).toBe(6)
  })
})

describe("EvidenceQuality", () => {
  test("all three levels are assignable and distinct", () => {
    const all: EvidenceQuality[] = ["high", "medium", "low"]
    expect(new Set(all).size).toBe(3)
  })
})

describe("ReproducibilityStatus", () => {
  test("all four statuses are assignable and distinct", () => {
    const all: ReproducibilityStatus[] = [
      "unverified",
      "reproduced",
      "independently_reproduced",
      "contradicted",
    ]
    expect(new Set(all).size).toBe(4)
  })
})

describe("IngestionMode", () => {
  test("all three modes are assignable and distinct", () => {
    const all: IngestionMode[] = [
      "automatic",
      "curator_proposed",
      "curator_approved",
    ]
    expect(new Set(all).size).toBe(3)
  })
})

describe("QueryEligibility", () => {
  test("all three levels are assignable and distinct", () => {
    const all: QueryEligibility[] = ["all", "authenticated", "grant_required"]
    expect(new Set(all).size).toBe(3)
  })
})

describe("DerivativeUsePolicy", () => {
  test("all four policies are assignable and distinct", () => {
    const all: DerivativeUsePolicy[] = [
      "permitted",
      "research_only",
      "attribution_required",
      "restricted",
    ]
    expect(new Set(all).size).toBe(4)
  })
})

describe("CandidateStatus", () => {
  test("all six statuses are assignable and distinct", () => {
    const all: CandidateStatus[] = [
      "pending_validation",
      "validated",
      "duplicate_found",
      "contradiction_found",
      "proposed",
      "rejected",
    ]
    expect(new Set(all).size).toBe(6)
  })
})

describe("DatasetReleaseClass", () => {
  test("all four classes are assignable and distinct", () => {
    const all: DatasetReleaseClass[] = [
      "internal_only",
      "research_partner",
      "public_redacted",
      "public_open",
    ]
    expect(new Set(all).size).toBe(4)
  })
})

describe("DatasetExportAuthority", () => {
  test("all four authorities are assignable and distinct", () => {
    const all: DatasetExportAuthority[] = [
      "none",
      "scoped_export",
      "public_release",
      "full_dataset_export",
    ]
    expect(new Set(all).size).toBe(4)
  })
})

describe("DatasetProjectionClass", () => {
  test("all four projection classes are assignable and distinct", () => {
    const all: DatasetProjectionClass[] = [
      "claims",
      "episodes",
      "evaluations",
      "analytics",
    ]
    expect(new Set(all).size).toBe(4)
  })
})

describe("BenefitAllocationKind", () => {
  test("all five kinds are assignable and distinct", () => {
    const all: BenefitAllocationKind[] = [
      "original_evidence",
      "synthesis",
      "review",
      "reproduction",
      "maintenance",
    ]
    expect(new Set(all).size).toBe(5)
  })
})

// ── EvidenceRef ──────────────────────────────────────────────────────────────

describe("EvidenceRef", () => {
  test("constructs correctly", () => {
    const ref: EvidenceRef = {
      receiptDigest: "abc123",
      contributionId: "c_001",
      artifactDigest: "def456",
      description: "Benchmark results",
    }
    expect(ref.receiptDigest).toBe("abc123")
    expect(ref.contributionId).toBe("c_001")
    expect(ref.artifactDigest).toBe("def456")
    expect(ref.description).toBe("Benchmark results")
  })
})

// ── ScopeDescriptor ──────────────────────────────────────────────────────────

describe("ScopeDescriptor", () => {
  test("constructs correctly", () => {
    const scope: ScopeDescriptor = {
      hardwareTargets: ["Apple M1"],
      softwareVersions: ["macOS 15"],
      modelFamilies: ["llama-3"],
      contextNotes: ["single-node"],
    }
    expect(scope.hardwareTargets).toEqual(["Apple M1"])
    expect(scope.softwareVersions).toEqual(["macOS 15"])
    expect(scope.modelFamilies).toEqual(["llama-3"])
    expect(scope.contextNotes).toEqual(["single-node"])
  })

  test("empty arrays are valid", () => {
    const scope: ScopeDescriptor = {
      hardwareTargets: [],
      softwareVersions: [],
      modelFamilies: [],
      contextNotes: [],
    }
    expect(scope.hardwareTargets).toEqual([])
  })
})

// ── CodexClaim ───────────────────────────────────────────────────────────────

describe("CodexClaim", () => {
  test("constructs with required fields", () => {
    const claim: CodexClaim = {
      claimId: "cl_001",
      statement: "Model X achieves 95% accuracy on Y",
      claimType: "fact",
      supportRefs: [],
      scope: {
        hardwareTargets: ["NVIDIA A100"],
        softwareVersions: [],
        modelFamilies: ["model-x"],
        contextNotes: [],
      },
      confidence: 0.95,
    }
    expect(claim.claimId).toBe("cl_001")
    expect(claim.claimType).toBe("fact")
    expect(claim.confidence).toBe(0.95)
  })
})

// ── CodexEntry ───────────────────────────────────────────────────────────────

describe("CodexEntry", () => {
  test("constructs via createCodexEntry with required provenance", () => {
    const claim: CodexClaim = {
      claimId: "cl_001",
      statement: "Test",
      claimType: "fact",
      supportRefs: [],
      scope: {
        hardwareTargets: [],
        softwareVersions: [],
        modelFamilies: [],
        contextNotes: [],
      },
      confidence: 0.5,
    }

    const entry = createCodexEntry(
      "ce_001",
      "Test Entry",
      "implementation_pattern",
      "public",
      [claim],
    )

    expect(entry.codexEntryId).toBe("ce_001")
    expect(entry.title).toBe("Test Entry")
    expect(entry.knowledgeClass).toBe("implementation_pattern")
    expect(entry.visibilityClass).toBe("public")
    expect(entry.claims).toHaveLength(1)
    expect(entry.claims[0].claimId).toBe("cl_001")

    // provenance must be fully populated
    expect(entry.provenance.createdFromReceiptIds).toBeDefined()
    expect(entry.provenance.derivationPolicyVersion).toBe("1.0.0")
    expect(entry.provenance.ingestionMode).toBe("curator_approved")
    expect(entry.provenance.authoredBy).toBeDefined()
    expect(entry.provenance.approvedBy).toBeDefined()
    expect(entry.provenance.createdAtLogicalTime).toBeDefined()
    expect(entry.provenance.createdAtLogicalTime.length).toBeGreaterThan(0)

    // default fields
    expect(entry.schemaVersion).toBe(1)
    expect(entry.status).toBe("draft")
    expect(entry.quality.evidenceQuality).toBe("low")
    expect(entry.quality.corroborationCount).toBe(0)
    expect(entry.quality.reproducibilityStatus).toBe("unverified")
    expect(entry.quality.confidence).toBe(0)
    expect(entry.policy.queryEligibility).toBe("all")
    expect(entry.policy.derivativeUsePolicy).toBe("restricted")
    expect(entry.signatures).toEqual([])
  })

  test("status transitions are type-safe", () => {
    const entry: CodexEntry = createCodexEntry(
      "ce_002",
      "",
      "architecture_decision",
      "contributor",
      [],
    )
    expect(entry.status).toBe("draft")
    // All valid statuses are assignable
    const statuses: CodexEntryStatus[] = [
      "draft",
      "proposed",
      "published",
      "superseded",
      "contested",
      "revoked",
    ]
    statuses.forEach((s) => {
      const e: CodexEntry = { ...entry, status: s }
      expect(e.status).toBe(s)
    })
  })
})

// ── CodexCandidate ───────────────────────────────────────────────────────────

describe("CodexCandidate", () => {
  test("constructs correctly", () => {
    const candidate: CodexCandidate = {
      candidateId: "cd_001",
      sourceContributionIds: ["c_001"],
      knowledgeClass: "debugging_finding",
      claims: [],
      evidenceRefs: [],
      visibilityClass: "session",
      status: "pending_validation",
      duplicateAnalysis: null,
      createdAt: "2025-06-01T00:00:00Z",
    }
    expect(candidate.candidateId).toBe("cd_001")
    expect(candidate.status).toBe("pending_validation")
    expect(candidate.duplicateAnalysis).toBeNull()
  })
})

// ── CodexRevision ────────────────────────────────────────────────────────────

describe("CodexRevision", () => {
  test("constructs correctly", () => {
    const rev: CodexRevision = {
      revisionId: "rev_001",
      codexEntryId: "ce_001",
      revisionNumber: 1,
      changes: "Updated confidence",
      previousContentDigest: "abc",
      newContentDigest: "def",
      approvedBy: "did:dht:bob",
      approvedAt: "2025-06-01T00:00:00Z",
    }
    expect(rev.revisionId).toBe("rev_001")
    expect(rev.revisionNumber).toBe(1)
  })
})

// ── Dataset Types ────────────────────────────────────────────────────────────

describe("DatasetEligibility", () => {
  test("createDatasetEligibility defaults to blocked", () => {
    const de = createDatasetEligibility()
    expect(de.eligible).toBe(false)
    expect(de.releaseClass).toBe("internal_only")
    expect(de.license.datasetLicense).toBe("internal")
    expect(de.license.derivativeModelPolicy).toBe("restricted")
    expect(de.privacyReview.piiStatus).toBe("blocked")
    expect(de.privacyReview.secretScanStatus).toBe("blocked")
    expect(de.privacyReview.sourceCodeStatus).toBe("blocked")
    expect(de.consent.revocable).toBe(false)
    expect(de.consent.contributorConsentRef).toBeUndefined()
  })
})

describe("DatasetExportGrant", () => {
  test("constructs correctly", () => {
    const grant: DatasetExportGrant = {
      grantId: "g_001",
      subjectIdentity: "did:dht:alice",
      authority: "scoped_export",
      allowedVisibilityClasses: ["session", "contributor"],
      allowedProjectionClasses: ["claims"],
      issuedBy: "did:dht:steward",
      signature: "sig_abc",
    }
    expect(grant.grantId).toBe("g_001")
    expect(grant.authority).toBe("scoped_export")
    expect(grant.maxScope).toBeUndefined()
    expect(grant.expiresAtLogicalTime).toBeUndefined()
  })
})

describe("FullDatasetExportAuthorization", () => {
  test("constructs correctly", () => {
    const auth: FullDatasetExportAuthorization = {
      authorizationId: "auth_001",
      requestedBy: "did:dht:alice",
      exportManifestDigest: "digest_abc",
      sourceSnapshot: {
        autobaseHeads: ["head1", "head2"],
        codexSchemaVersion: "1.0.0",
        datasetProjectionVersion: "1.0.0",
      },
      releasePolicyDigest: "policy_digest",
      issuedAtLogicalTime: "2025-06-01T00:00:00Z",
      expiresAtLogicalTime: "2025-07-01T00:00:00Z",
      rootAuthoritySignature: "root_sig",
    }
    expect(auth.authorizationId).toBe("auth_001")
    expect(auth.sourceSnapshot.autobaseHeads).toHaveLength(2)
    expect(auth.recipientBinding).toBeUndefined()
  })
})

describe("DatasetExportReceipt", () => {
  test("constructs correctly", () => {
    const receipt: DatasetExportReceipt = {
      receiptId: "r_001",
      exportManifestDigest: "manifest_abc",
      requester: "did:dht:alice",
      authorityUsed: "full_dataset_export",
      entryCount: 42,
      excludedEntryCount: 3,
      visibilityClassesIncluded: ["session", "contributor", "public"],
      outputDigest: "output_abc",
      logicalTime: "2025-06-01T00:00:00Z",
      authorizedBy: ["did:dht:steward"],
      signatures: ["sig1"],
    }
    expect(receipt.receiptId).toBe("r_001")
    expect(receipt.entryCount).toBe(42)
    expect(receipt.recipientBinding).toBeUndefined()
  })
})

describe("DatasetProjection", () => {
  test("constructs correctly", () => {
    const proj: DatasetProjection = {
      projectionClass: "claims",
      entryCount: 100,
      format: "jsonl",
      storageRef: "ipfs://QmX",
    }
    expect(proj.projectionClass).toBe("claims")
    expect(proj.format).toBe("jsonl")
  })
})

describe("CodexDatasetRelease", () => {
  test("constructs correctly", () => {
    const release: CodexDatasetRelease = {
      datasetId: "ds_001",
      version: "1.0.0",
      createdAtLogicalTime: "2025-06-01T00:00:00Z",
      sourceCodexSnapshot: {
        autobaseHeads: ["h1", "h2"],
        entryCount: 50,
        claimCount: 120,
        excludedEntryCount: 5,
      },
      projections: [],
      policyVersion: "1.0.0",
      redactionPipelineDigest: "redact_digest",
      deduplicationPipelineDigest: "dedup_digest",
      splitPolicy: {
        train: "0.8",
        validation: "0.1",
        test: "0.1",
        leakageControls: [],
      },
      provenanceManifestRef: "prov_manifest",
      licenseManifestRef: "license_manifest",
      revocationManifestRef: "revoke_manifest",
    }
    expect(release.datasetId).toBe("ds_001")
    expect(release.sourceCodexSnapshot.entryCount).toBe(50)
    expect(release.projections).toEqual([])
  })
})

// ── Benefit Types ────────────────────────────────────────────────────────────

describe("BenefitPolicy", () => {
  test("createBenefitPolicy has default shares", () => {
    const bp = createBenefitPolicy("bp_001")
    expect(bp.policyId).toBe("bp_001")
    expect(bp.version).toBe("1.0.0")
    expect(bp.allocationShares.original_evidence).toBe(0.4)
    expect(bp.allocationShares.synthesis).toBe(0.15)
    expect(bp.allocationShares.review).toBe(0.2)
    expect(bp.allocationShares.reproduction).toBe(0.1)
    expect(bp.allocationShares.maintenance).toBe(0.15)
    expect(bp.minEvidenceQuality).toBe("low")
    expect(bp.requireAccepted).toBe(true)
  })

  test("shares sum to 1.0", () => {
    const bp = createBenefitPolicy("bp_002")
    const sum =
      bp.allocationShares.original_evidence +
      bp.allocationShares.synthesis +
      bp.allocationShares.review +
      bp.allocationShares.reproduction +
      bp.allocationShares.maintenance
    expect(sum).toBe(1.0)
  })
})

describe("BenefitPolicy assignability", () => {
  test("all allocation kinds can be set", () => {
    const bp: BenefitPolicy = {
      policyId: "bp_custom",
      version: "2.0.0",
      allocationShares: {
        original_evidence: 1.0,
        synthesis: 0.0,
        review: 0.0,
        reproduction: 0.0,
        maintenance: 0.0,
      },
      minEvidenceQuality: "high",
      requireAccepted: false,
    }
    expect(bp.allocationShares.original_evidence).toBe(1.0)
  })
})

describe("CodexBenefitEvent", () => {
  test("constructs correctly", () => {
    const event: CodexBenefitEvent = {
      eventId: "bev_001",
      codexEntryId: "ce_001",
      benefitKind: "citation",
      sourceContributionId: "c_001",
      allocations: [
        {
          kind: "original_evidence",
          recipientIdentityDigest: "did:dht:alice",
          share: 0.6,
        },
        {
          kind: "review",
          recipientIdentityDigest: "did:dht:bob",
          share: 0.4,
        },
      ],
      policyVersion: "1.0.0",
      recordedAt: "2025-06-01T00:00:00Z",
    }
    expect(event.eventId).toBe("bev_001")
    expect(event.allocations).toHaveLength(2)
    // shares sum to 1.0
    const sum = event.allocations.reduce((a, b) => a + b.share, 0)
    expect(sum).toBe(1.0)
  })
})

// ── Error Types ──────────────────────────────────────────────────────────────

describe("CodexError", () => {
  test("constructs with code and message", () => {
    const err = new CodexError("CODEX_ERR", "Something went wrong")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(CodexError)
    expect(err.name).toBe("CodexError")
    expect(err.code).toBe("CODEX_ERR")
    expect(err.message).toBe("Something went wrong")
  })
})

describe("DatasetExportError", () => {
  test("constructs with default code", () => {
    const err = new DatasetExportError("Export failed")
    expect(err).toBeInstanceOf(CodexError)
    expect(err.name).toBe("DatasetExportError")
    expect(err.code).toBe("DATASET_EXPORT_ERROR")
    expect(err.message).toBe("Export failed")
  })

  test("constructs with custom code", () => {
    const err = new DatasetExportError("Unauthorized", "EXPORT_UNAUTHORIZED")
    expect(err.code).toBe("EXPORT_UNAUTHORIZED")
  })
})

describe("BenefitAccountingError", () => {
  test("constructs with default code", () => {
    const err = new BenefitAccountingError("Allocation overflow")
    expect(err).toBeInstanceOf(CodexError)
    expect(err.name).toBe("BenefitAccountingError")
    expect(err.code).toBe("BENEFIT_ACCOUNTING_ERROR")
    expect(err.message).toBe("Allocation overflow")
  })

  test("constructs with custom code", () => {
    const err = new BenefitAccountingError("Bad policy", "BAD_POLICY")
    expect(err.code).toBe("BAD_POLICY")
  })
})
