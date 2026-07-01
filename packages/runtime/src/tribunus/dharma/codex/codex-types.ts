/**
 * Phase 1 — Core Codex Types
 *
 * The governed semantic layer over accepted contributions.
 * 3 layers: contribution evidence, Codex derivation, and benefit accounting.
 *
 * CodexEntry is NOT a contribution with an embedding. It is a bounded claim
 * about reusable knowledge backed by evidence.
 * Benefits are event-based and auditable, not a mutable reputation counter.
 */

// ── Base Primitives ──────────────────────────────────────────────────────────

export type CodexEntryStatus =
  | "draft"
  | "proposed"
  | "published"
  | "superseded"
  | "contested"
  | "revoked"

export type CodexVisibilityClass = "session" | "contributor" | "public"

export type KnowledgeClass =
  | "implementation_pattern"
  | "architecture_decision"
  | "debugging_finding"
  | "performance_evidence"
  | "compatibility_fact"
  | "failure_mode"
  | "governance_precedent"
  | "research_result"
  | "workflow_pattern"

export type ClaimType =
  | "fact"
  | "procedure"
  | "constraint"
  | "recommendation"
  | "measurement"
  | "decision"

export type EvidenceQuality = "high" | "medium" | "low"

export type ReproducibilityStatus =
  | "unverified"
  | "reproduced"
  | "independently_reproduced"
  | "contradicted"

export type IngestionMode = "automatic" | "curator_proposed" | "curator_approved"

export type QueryEligibility = "all" | "authenticated" | "grant_required"

export type DerivativeUsePolicy =
  | "permitted"
  | "research_only"
  | "attribution_required"
  | "restricted"

// ── Evidence & Scope ─────────────────────────────────────────────────────────

export interface EvidenceRef {
  receiptDigest: string
  contributionId: string
  artifactDigest: string
  description: string
}

export interface ScopeDescriptor {
  hardwareTargets: string[]
  softwareVersions: string[]
  modelFamilies: string[]
  contextNotes: string[]
}

export interface SourceArtifactRef {
  artifactDigest: string
  artifactClass: string
  description: string
}

export interface EntityRef {
  entityType: string
  entityId: string
  label: string
}

export interface SignedApproval {
  approverIdentityDigest: string
  approvedAt: string
  signature: string
}

// ── Claim ────────────────────────────────────────────────────────────────────

export interface CodexClaim {
  claimId: string
  statement: string
  claimType: ClaimType
  supportRefs: EvidenceRef[]
  scope: ScopeDescriptor
  confidence: number // 0.0–1.0
}

// ── Codex Entry ──────────────────────────────────────────────────────────────

export interface CodexProvenance {
  createdFromReceiptIds: string[]
  derivationPolicyVersion: string
  ingestionMode: IngestionMode
  authoredBy: string[]
  approvedBy: string[]
  createdAtLogicalTime: string
}

export interface CodexQuality {
  evidenceQuality: EvidenceQuality
  corroborationCount: number
  reproducibilityStatus: ReproducibilityStatus
  confidence: number
}

export interface SemanticIndex {
  embeddingModelDigest: string
  embeddingVectorRef: string
  lexicalTerms: string[]
  entityRefs: EntityRef[]
}

export interface EntryLineage {
  supersedes: string | null
  supersededBy: string | null
  relatedEntryIds: string[]
}

export interface EntryPolicy {
  queryEligibility: QueryEligibility
  derivativeUsePolicy: DerivativeUsePolicy
  benefitPolicyId: string
}

export interface CodexEntry {
  codexEntryId: string
  schemaVersion: number
  status: CodexEntryStatus
  visibilityClass: CodexVisibilityClass
  knowledgeClass: KnowledgeClass
  title: string
  abstract: string
  claims: CodexClaim[]
  canonicalContentDigest: string
  sourceContributionIds: string[]
  sourceArtifactRefs: SourceArtifactRef[]
  evidenceRefs: EvidenceRef[]
  provenance: CodexProvenance
  quality: CodexQuality
  semanticIndex: SemanticIndex
  lineage: EntryLineage
  policy: EntryPolicy
  signatures: SignedApproval[]
}

// ── Candidate ────────────────────────────────────────────────────────────────

export type CandidateStatus =
  | "pending_validation"
  | "validated"
  | "duplicate_found"
  | "contradiction_found"
  | "proposed"
  | "rejected"

export interface DuplicateAnalysis {
  similarEntryIds: string[]
  similarityScores: Record<string, number>
  scopeConflict: boolean
  hardwareConflict: boolean
  conclusion: "new" | "duplicate" | "supersedes" | "contradicts"
}

export interface CodexCandidate {
  candidateId: string
  sourceContributionIds: string[]
  knowledgeClass: KnowledgeClass
  claims: CodexClaim[]
  evidenceRefs: EvidenceRef[]
  visibilityClass: CodexVisibilityClass
  status: CandidateStatus
  duplicateAnalysis: DuplicateAnalysis | null
  createdAt: string
}

// ── Revision ─────────────────────────────────────────────────────────────────

export interface CodexRevision {
  revisionId: string
  codexEntryId: string
  revisionNumber: number
  changes: string
  previousContentDigest: string
  newContentDigest: string
  approvedBy: string
  approvedAt: string
}

// ── Dataset Types ────────────────────────────────────────────────────────────

export type DatasetReleaseClass =
  | "internal_only"
  | "research_partner"
  | "public_redacted"
  | "public_open"

export type DatasetExportAuthority =
  | "none"
  | "scoped_export"
  | "public_release"
  | "full_dataset_export"

export type DatasetProjectionClass =
  | "claims"
  | "episodes"
  | "evaluations"
  | "analytics"

export interface DatasetLicense {
  sourceLicense?: string
  datasetLicense: string
  derivativeModelPolicy: DerivativeUsePolicy
}

export interface PrivacyReview {
  piiStatus: "clear" | "redacted" | "blocked"
  secretScanStatus: "clear" | "redacted" | "blocked"
  sourceCodeStatus: "allowed" | "partial" | "blocked"
}

export interface ContributorConsent {
  contributorConsentRef?: string
  revocable: boolean
}

export interface DatasetEligibility {
  eligible: boolean
  releaseClass: DatasetReleaseClass
  license: DatasetLicense
  privacyReview: PrivacyReview
  consent: ContributorConsent
}

export interface DatasetExportGrant {
  grantId: string
  subjectIdentity: string
  authority: DatasetExportAuthority
  allowedVisibilityClasses: CodexVisibilityClass[]
  allowedProjectionClasses: DatasetProjectionClass[]
  maxScope?: {
    contributorIds?: string[]
    codexEntryIds?: string[]
    datasetReleaseClasses?: string[]
  }
  expiresAtLogicalTime?: string
  issuedBy: string
  signature: string
}

export interface FullDatasetExportAuthorization {
  authorizationId: string
  requestedBy: string
  exportManifestDigest: string
  sourceSnapshot: {
    autobaseHeads: string[]
    codexSchemaVersion: string
    datasetProjectionVersion: string
  }
  releasePolicyDigest: string
  recipientBinding?: string
  issuedAtLogicalTime: string
  expiresAtLogicalTime: string
  rootAuthoritySignature: string
}

export interface DatasetExportReceipt {
  receiptId: string
  exportManifestDigest: string
  requester: string
  authorityUsed: DatasetExportAuthority
  entryCount: number
  excludedEntryCount: number
  visibilityClassesIncluded: string[]
  outputDigest: string
  recipientBinding?: string
  logicalTime: string
  authorizedBy: string[]
  signatures: string[]
}

export interface DatasetProjection {
  projectionClass: DatasetProjectionClass
  entryCount: number
  format: string
  storageRef: string
}

export interface CodexDatasetRelease {
  datasetId: string
  version: string
  createdAtLogicalTime: string
  sourceCodexSnapshot: {
    autobaseHeads: string[]
    entryCount: number
    claimCount: number
    excludedEntryCount: number
  }
  projections: DatasetProjection[]
  policyVersion: string
  redactionPipelineDigest: string
  deduplicationPipelineDigest: string
  splitPolicy: {
    train: string
    validation: string
    test: string
    leakageControls: string[]
  }
  provenanceManifestRef: string
  licenseManifestRef: string
  revocationManifestRef: string
}

// ── Benefit Types ────────────────────────────────────────────────────────────

export type BenefitAllocationKind =
  | "original_evidence"
  | "synthesis"
  | "review"
  | "reproduction"
  | "maintenance"

export interface BenefitAllocation {
  kind: BenefitAllocationKind
  recipientIdentityDigest: string
  share: number // 0.0–1.0, sum per event = 1.0
}

export interface CodexBenefitEvent {
  eventId: string
  codexEntryId: string
  benefitKind: "citation" | "reuse" | "independent_reproduction" | "maintenance"
  sourceContributionId: string
  allocations: BenefitAllocation[]
  policyVersion: string
  recordedAt: string
}

export interface BenefitPolicy {
  policyId: string
  version: string
  allocationShares: Record<BenefitAllocationKind, number>
  minEvidenceQuality: EvidenceQuality
  requireAccepted: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a BenefitPolicy with default allocation shares.
 *
 * Defaults:
 *  - original_evidence: 0.40
 *  - synthesis:         0.15
 *  - review:            0.20
 *  - reproduction:      0.10
 *  - maintenance:       0.15
 *  - minEvidenceQuality: "low"
 *  - requireAccepted:    true
 */
export function createBenefitPolicy(policyId: string): BenefitPolicy {
  return {
    policyId,
    version: "1.0.0",
    allocationShares: {
      original_evidence: 0.4,
      synthesis: 0.15,
      review: 0.2,
      reproduction: 0.1,
      maintenance: 0.15,
    },
    minEvidenceQuality: "low",
    requireAccepted: true,
  }
}

/**
 * Create a DatasetEligibility with safe defaults (blocked).
 *
 * Defaults:
 *  - eligible: false
 *  - releaseClass: "internal_only"
 *  - license: { datasetLicense: "internal", derivativeModelPolicy: "restricted" }
 *  - privacyReview: { piiStatus: "blocked", secretScanStatus: "blocked", sourceCodeStatus: "blocked" }
 *  - consent: { revocable: false }
 */
export function createDatasetEligibility(): DatasetEligibility {
  return {
    eligible: false,
    releaseClass: "internal_only",
    license: {
      datasetLicense: "internal",
      derivativeModelPolicy: "restricted",
    },
    privacyReview: {
      piiStatus: "blocked",
      secretScanStatus: "blocked",
      sourceCodeStatus: "blocked",
    },
    consent: {
      revocable: false,
    },
  }
}

/**
 * Create a CodexEntry with a fully populated provenance.
 */
export function createCodexEntry(
  entryId: string,
  title: string,
  knowledgeClass: KnowledgeClass,
  visibilityClass: CodexVisibilityClass,
  claims: CodexClaim[],
): CodexEntry {
  return {
    codexEntryId: entryId,
    schemaVersion: 1,
    status: "draft",
    visibilityClass,
    knowledgeClass,
    title,
    abstract: "",
    claims,
    canonicalContentDigest: "",
    sourceContributionIds: [],
    sourceArtifactRefs: [],
    evidenceRefs: [],
    provenance: {
      createdFromReceiptIds: [],
      derivationPolicyVersion: "1.0.0",
      ingestionMode: "curator_approved",
      authoredBy: [],
      approvedBy: [],
      createdAtLogicalTime: new Date().toISOString(),
    },
    quality: {
      evidenceQuality: "low",
      corroborationCount: 0,
      reproducibilityStatus: "unverified",
      confidence: 0.0,
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
      derivativeUsePolicy: "restricted",
      benefitPolicyId: "",
    },
    signatures: [],
  }
}
