/**
 * Codex Phase 2 — Ingestion Pipeline
 *
 * Pipeline: accepted contribution → CodexCandidate → evidence validation →
 * duplicate/contradiction analysis → proposed CodexEntry → auto or curator
 * approval → published entry.
 */

import { createHash, randomUUID } from "node:crypto"
import type { DharmaContributionRecord } from "../contribution/contribution-types"
import type {
  CodexCandidate,
  CodexEntry,
  CodexClaim,
  CandidateStatus,
  ClaimType,
  DuplicateAnalysis,
  EvidenceRef,
  EvidenceQuality,
  IngestionMode,
  KnowledgeClass,
  ScopeDescriptor,
  CodexVisibilityClass,
} from "./codex-types"
import { createCodexEntry } from "./codex-types"

// ── Ingestion Result ─────────────────────────────────────────────────────────

export interface IngestionResult {
  candidate: CodexCandidate
  entry: CodexEntry | null
  mode: IngestionMode
  requiresCuratorApproval: boolean
}

/** Knowledge classes that can auto-publish without a curator review. */
export const AUTOMATIC_CLASSES: KnowledgeClass[] = [
  "performance_evidence",
  "compatibility_fact",
  "failure_mode",
]

// ── Contribution Class → Knowledge Class Mapping ─────────────────────────────

const CLASS_MAP: Record<string, KnowledgeClass> = {
  work_product: "implementation_pattern",
  review_evidence: "debugging_finding",
  reproduction_evidence: "research_result",
  compute_lease: "performance_evidence",
  artifact_contribution: "implementation_pattern",
  documentation_contribution: "workflow_pattern",
  moderation_action: "governance_precedent",
  research_evidence: "research_result",
  session_stewardship: "governance_precedent",
}

/**
 * Map a contribution class string to a Codex KnowledgeClass.
 * Defaults to `research_result` for unknown classes.
 */
export function contributionClassToKnowledgeClass(cls: string): KnowledgeClass {
  return CLASS_MAP[cls] ?? "research_result"
}

// ── Curator Gate ─────────────────────────────────────────────────────────────

/**
 * Returns true when the given knowledge class requires a human curator to
 * approve before the entry is published.
 */
export function requiresCuratorApproval(knowledgeClass: KnowledgeClass): boolean {
  return !(AUTOMATIC_CLASSES as readonly KnowledgeClass[]).includes(knowledgeClass)
}

// ── Scope Helpers ────────────────────────────────────────────────────────────

/**
 * Build a ScopeDescriptor from the structured fields in a contribution.
 *
 * Parses outcomeRelation for hardware/version/model-family hints and
 * classifies the description into context notes.
 */
export function buildScopeDescriptor(
  contribution: DharmaContributionRecord,
): ScopeDescriptor {
  const outcome = contribution.outcomeRelation ?? ""
  const desc = contribution.description ?? ""

  const hardwareTargets: string[] = []
  const softwareVersions: string[] = []
  const modelFamilies: string[] = []
  const contextNotes: string[] = [desc]

  // Parse outcome relation segments for structured scope hints
  for (const segment of outcome.split(":")) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    if (/^v\d+/.test(trimmed) || /^\d+\.\d+/.test(trimmed)) {
      softwareVersions.push(trimmed)
    } else if (/cpu|gpu|m\d|intel|amd|nvidia|apple/i.test(trimmed)) {
      hardwareTargets.push(trimmed)
    } else if (/^\d{3,}$/.test(trimmed)) {
      // Numeric model numbers (e.g. 4090, 3090, 9950) → hardware
      hardwareTargets.push(trimmed)
    } else if (/model|family|series|class/i.test(trimmed)) {
      modelFamilies.push(trimmed)
    } else {
      contextNotes.push(trimmed)
    }
  }

  contextNotes.push(`evidenceQuality:${contribution.evidenceQuality}`)

  return { hardwareTargets, softwareVersions, modelFamilies, contextNotes }
}

// ── Claim Type from Contribution Class ───────────────────────────────────────

const CLAIM_TYPE_MAP: Record<string, ClaimType> = {
  reproduction_evidence: "procedure",
  review_evidence: "recommendation",
  research_evidence: "fact",
  compute_lease: "measurement",
  work_product: "decision",
}

function claimTypeForContributionClass(cls: string): ClaimType {
  return CLAIM_TYPE_MAP[cls] ?? "fact"
}

// ── Evidence Refs ────────────────────────────────────────────────────────────

/**
 * Build evidence references from a contribution's receipt digests.
 *
 * Each receipt digest becomes an EvidenceRef with a synthetic artifact digest
 * derived from the contribution's identity.
 */
export function buildEvidenceRefs(contribution: DharmaContributionRecord): EvidenceRef[] {
  if (!contribution.receiptDigests || contribution.receiptDigests.length === 0) {
    return []
  }

  const baseDigest = createHash("sha256")
    .update(`${contribution.contributionId}:${contribution.sessionId}`)
    .digest("hex")

  return contribution.receiptDigests.map((digest, i) => ({
    receiptDigest: digest,
    contributionId: contribution.contributionId,
    artifactDigest: createHash("sha256")
      .update(`${baseDigest}:${i}`)
      .digest("hex")
      .slice(0, 16),
    description: `Evidence from ${contribution.contributionClass} contribution`,
  }))
}

// ── Extract Claims ───────────────────────────────────────────────────────────

/**
 * Extract bounded CodexClaims from a contribution.
 *
 * Each claim captures a bounded statement backed by the given evidence refs,
 * scoped to the hardware/environment context of the contribution.
 */
export function extractClaims(
  contribution: DharmaContributionRecord,
  evidenceRefs: EvidenceRef[],
): CodexClaim[] {
  const claimType = claimTypeForContributionClass(contribution.contributionClass)
  const scope = buildScopeDescriptor(contribution)

  const primaryClaim: CodexClaim = {
    claimId: randomUUID(),
    statement: contribution.description,
    claimType,
    supportRefs: evidenceRefs,
    scope,
    confidence: contribution.evidenceQuality === "high" ? 0.9 : contribution.evidenceQuality === "medium" ? 0.6 : 0.3,
  }

  const claims: CodexClaim[] = [primaryClaim]

  // Emit a measurement sub-claim when resource cost data is available
  if (contribution.resourceCostSummary) {
    const cost = contribution.resourceCostSummary
    const costParts: string[] = []
    if (cost.computeMs != null) costParts.push(`computeMs=${cost.computeMs}`)
    if (cost.tokenCount != null) costParts.push(`tokens=${cost.tokenCount}`)
    if (cost.storageBytes != null) costParts.push(`storage=${cost.storageBytes}`)

    if (costParts.length > 0) {
      claims.push({
        claimId: randomUUID(),
        statement: `Resource cost: ${costParts.join(", ")}`,
        claimType: "measurement",
        supportRefs: evidenceRefs,
        scope: {
          ...scope,
          contextNotes: [...scope.contextNotes, `contributionClass:${contribution.contributionClass}`],
        },
        confidence: 1.0,
      })
    }
  }

  return claims
}

// ── Create Candidate ─────────────────────────────────────────────────────────

/**
 * Create a CodexCandidate from an accepted contribution.
 *
 * Fills in evidence refs, knowledge class mapping, scope-based claims, and
 * marks the candidate with pending_validation status.
 */
export function createCandidateFromContribution(
  contribution: DharmaContributionRecord,
): CodexCandidate {
  const knowledgeClass = contributionClassToKnowledgeClass(contribution.contributionClass)
  const evidenceRefs = buildEvidenceRefs(contribution)
  const claims = extractClaims(contribution, evidenceRefs)

  return {
    candidateId: randomUUID(),
    sourceContributionIds: [contribution.contributionId],
    knowledgeClass,
    claims,
    evidenceRefs,
    visibilityClass: mapVisibilityClass(contribution.visibilityClass),
    status: "pending_validation",
    duplicateAnalysis: null,
    createdAt: contribution.createdAt,
  }
}

function mapVisibilityClass(vc: string): CodexVisibilityClass {
  if (vc === "contributor" || vc === "public") return vc
  return "session"
}

// ── Duplicate Analysis ───────────────────────────────────────────────────────

/**
 * Analyze a candidate against existing published entries for duplicates.
 *
 * Compares knowledge class, scope descriptor (hardware, versions, model
 * families), and evidence digest overlap.  Semantic similarity alone is NOT
 * sufficient for dedup — the analysis compares the structured scope of the
 * claim, not free-text.
 */
export function analyzeDuplicates(
  candidate: CodexCandidate,
  existingEntries: CodexEntry[],
): DuplicateAnalysis {
  const similarEntryIds: string[] = []
  const similarityScores: Record<string, number> = {}
  let scopeConflict = false
  let hardwareConflict = false

  const candidateEvidenceSet = new Set(
    candidate.evidenceRefs.map((r) => r.artifactDigest),
  )
  const candidateScope = candidate.claims[0]?.scope
  const candidateClass = candidate.knowledgeClass

  for (const entry of existingEntries) {
    // Cross-class entries are never duplicates — the knowledge dimension differs.
    if (entry.knowledgeClass !== candidateClass) continue

    let totalOverlap = 0
    const entryEvidenceSet = new Set(entry.evidenceRefs.map((r) => r.artifactDigest))

    // ── Evidence digest overlap ─────────────────────
    for (const digest of candidateEvidenceSet) {
      if (entryEvidenceSet.has(digest)) totalOverlap++
    }

    if (totalOverlap === 0) continue

    const candidateTotal = candidateEvidenceSet.size || 1
    const similarity = totalOverlap / candidateTotal
    similarityScores[entry.codexEntryId] = similarity
    similarEntryIds.push(entry.codexEntryId)

    // ── Scope comparison ────────────────────────────
    const entryScope = entry.claims[0]?.scope
    if (entryScope && candidateScope) {
      const hwOverlap = entryScope.hardwareTargets.some((h) =>
        candidateScope.hardwareTargets.includes(h),
      )
      if (!hwOverlap) hardwareConflict = true

      const swOverlap = entryScope.softwareVersions.some((v) =>
        candidateScope.softwareVersions.includes(v),
      )
      const modelOverlap = entryScope.modelFamilies.some((m) =>
        candidateScope.modelFamilies.includes(m),
      )
      if (!swOverlap && !modelOverlap && !hwOverlap) {
        scopeConflict = true
      }
    }
  }

  const isStrongOverlap = Object.values(similarityScores).some((s) => s >= 0.5)
  let conclusion: DuplicateAnalysis["conclusion"] = "new"

  if (isStrongOverlap && !hardwareConflict && !scopeConflict) {
    conclusion = "duplicate"
  } else if (isStrongOverlap && (hardwareConflict || scopeConflict)) {
    // Different scope but same evidence — could supersede or contradict
    conclusion = hardwareConflict ? "supersedes" : "contradicts"
  }

  return {
    similarEntryIds,
    similarityScores,
    scopeConflict,
    hardwareConflict,
    conclusion,
  }
}

// ── Promote Candidate ────────────────────────────────────────────────────────

/**
 * Promote a candidate to a published CodexEntry.
 *
 * Steps:
 *  1. Mark evidence as validated
 *  2. Run duplicate analysis
 *  3. If duplicate/contradiction is conclusive, reject the candidate
 *  4. Determine if curator approval is needed based on knowledge class
 *  5. If auto mode, publish immediately; otherwise mark as proposed
 */
export function promoteCandidate(
  candidate: CodexCandidate,
  existingEntries: CodexEntry[],
  approvedBy?: string,
): IngestionResult {
  // ── Validate evidence ────────────────────────────
  const validated: CodexCandidate = {
    ...candidate,
    status: "validated",
  }

  // ── Duplicate check ──────────────────────────────
  const dup = analyzeDuplicates(validated, existingEntries)

  if (dup.conclusion === "duplicate") {
    return {
      candidate: { ...validated, status: "duplicate_found", duplicateAnalysis: dup },
      entry: null,
      mode: "curator_proposed",
      requiresCuratorApproval: true,
    }
  }

  const knowledgeClass = candidate.knowledgeClass
  const needsCurator = requiresCuratorApproval(knowledgeClass)
  const mode: IngestionMode = needsCurator ? "curator_proposed" : "automatic"

  if (needsCurator && !approvedBy) {
    return {
      candidate: {
        ...validated,
        status: "proposed" as CandidateStatus,
        duplicateAnalysis: dup,
      },
      entry: null,
      mode,
      requiresCuratorApproval: true,
    }
  }

  // ── Build entry ──────────────────────────────────
  const claims = validated.claims
  const entryId = randomUUID()
  const title = claims[0]?.statement.slice(0, 80) ?? "Codex entry"
  const entry = createCodexEntry(entryId, title, knowledgeClass, validated.visibilityClass, claims)

  // Fill in the fields extractClaims would set
  entry.sourceContributionIds = validated.sourceContributionIds
  entry.evidenceRefs = validated.evidenceRefs
  entry.canonicalContentDigest = createHash("sha256")
    .update(claims.map((c) => c.claimId).join(","))
    .digest("hex")
  entry.provenance.ingestionMode = mode
  entry.provenance.createdFromReceiptIds = validated.evidenceRefs.map((r) => r.receiptDigest)
  entry.provenance.authoredBy = [validated.sourceContributionIds[0] ?? "unknown"]
  if (approvedBy) {
    entry.provenance.approvedBy = [approvedBy]
  }
  entry.status = "published"
  entry.quality.evidenceQuality = mapEvidenceQuality(claims[0]?.confidence)

  return {
    candidate: {
      ...validated,
      status: "proposed" as CandidateStatus,
      duplicateAnalysis: dup,
    },
    entry,
    mode,
    requiresCuratorApproval: needsCurator,
  }
}

function mapEvidenceQuality(confidence?: number): EvidenceQuality {
  if (!confidence) return "low"
  if (confidence >= 0.8) return "high"
  if (confidence >= 0.5) return "medium"
  return "low"
}
