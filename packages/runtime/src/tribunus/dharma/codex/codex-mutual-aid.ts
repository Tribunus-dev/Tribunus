/**
 * Codex — Mutual-Aid Debug System
 *
 * A user submits a DebugRequest describing a bug. Contributors submit
 * DebugProposals with potential fixes or debugging approaches. Each
 * proposal must be NOVEL — if the same approach has already been
 * proposed, it is rejected.
 *
 * Novelty is determined by comparing:
 *   - Codex pattern references (same pattern → duplicate)
 *   - Evidence references (same evidence → duplicate)
 *   - Claim statement overlap (high lexical overlap → duplicate)
 *   - Scope descriptors (different hardware/software → NOT duplicate)
 *
 * This prevents redundant work and ensures diverse approaches.
 */

import { randomUUID } from "node:crypto"
import type { CodexClaim, EvidenceRef, ScopeDescriptor } from "./codex-types"

// ── Debug Request ─────────────────────────────────────────────────────

export type BugSeverity = "cosmetic" | "minor" | "major" | "critical" | "security"
export type BugCategory = "crash" | "hang" | "data_loss" | "incorrect_output" | "performance" | "compatibility" | "regression" | "other"

export interface DebugRequest {
  requestId: string
  title: string
  description: string
  environment: {
    os: string
    hardware: string[]
    softwareVersions: Record<string, string>
    relevantLogs?: string
  }
  symptoms: string[]
  evidenceRefs: EvidenceRef[]
  severity: BugSeverity
  category: BugCategory
  sessionId: string
  requestedBy: string
  status: "open" | "in_progress" | "resolved" | "closed"
  createdAt: string
  proposalCount: number
}

export function createDebugRequest(
  title: string,
  description: string,
  sessionId: string,
  requestedBy: string,
  severity: BugSeverity,
  category: BugCategory,
): DebugRequest {
  return {
    requestId: randomUUID(),
    title,
    description,
    environment: { os: "", hardware: [], softwareVersions: {} },
    symptoms: [],
    evidenceRefs: [],
    severity,
    category,
    sessionId,
    requestedBy,
    status: "open",
    createdAt: new Date().toISOString(),
    proposalCount: 0,
  }
}

// ── Debug Proposal ────────────────────────────────────────────────────

export interface DebugProposal {
  proposalId: string
  requestId: string
  title: string
  description: string
  /** The Codex patterns this proposal is based on */
  codexPatternIds: string[]
  claims: CodexClaim[]
  evidenceRefs: EvidenceRef[]
  scope: ScopeDescriptor
  proposedBy: string
  status: "pending" | "accepted" | "rejected_duplicate" | "rejected_invalid" | "implemented"
  noveltyResult: NoveltyResult | null
  createdAt: string
}

export function createDebugProposal(
  requestId: string,
  title: string,
  description: string,
  proposedBy: string,
): DebugProposal {
  return {
    proposalId: randomUUID(),
    requestId,
    title,
    description,
    codexPatternIds: [],
    claims: [],
    evidenceRefs: [],
    scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
    proposedBy,
    status: "pending",
    noveltyResult: null,
    createdAt: new Date().toISOString(),
  }
}

// ── Novelty Check ─────────────────────────────────────────────────────

export type NoveltyVerdict = "novel" | "duplicate_pattern" | "duplicate_evidence" | "duplicate_claim" | "duplicate_scope"

export interface NoveltyResult {
  verdict: NoveltyVerdict
  similarProposalId: string | null
  reason: string
  similarityScore: number
}

/**
 * Check a proposal for novelty against existing proposals for the same
 * debug request. A proposal is rejected if it overlaps too much with
 * any existing proposal on ANY of these dimensions:
 *
 * 1. Same Codex pattern IDs → duplicate_pattern
 * 2. Same evidence refs → duplicate_evidence
 * 3. High claim statement overlap → duplicate_claim
 * 4. Same scope + high overall overlap → duplicate_scope
 *
 * A proposal is novel ONLY if it differs on ALL dimensions.
 */
export function checkNovelty(
  proposal: DebugProposal,
  existingProposals: DebugProposal[],
): NoveltyResult {
  const { codexPatternIds, evidenceRefs, claims, scope } = proposal

  // Build claim text corpus for similarity comparison
  const proposalClaimText = claims.map((c) => c.statement.toLowerCase()).join(" ")

  for (const existing of existingProposals) {
    // 1. Pattern overlap
    const sharedPatterns = codexPatternIds.filter((id) => existing.codexPatternIds.includes(id))
    if (sharedPatterns.length > 0) {
      return {
        verdict: "duplicate_pattern",
        similarProposalId: existing.proposalId,
        reason: `Already proposed: Codex pattern(s) ${sharedPatterns.join(", ")} are referenced in proposal ${existing.proposalId}`,
        similarityScore: sharedPatterns.length / Math.max(codexPatternIds.length, 1),
      }
    }

    // 2. Evidence overlap
    const existingEvidenceDigests = new Set(existing.evidenceRefs.map((r) => r.receiptDigest))
    const sharedEvidence = evidenceRefs.filter((r) => existingEvidenceDigests.has(r.receiptDigest))
    if (sharedEvidence.length >= 1) {
      return {
        verdict: "duplicate_evidence",
        similarProposalId: existing.proposalId,
        reason: `Already proposed: ${sharedEvidence.length} evidence receipt(s) overlap with proposal ${existing.proposalId}`,
        similarityScore: sharedEvidence.length / Math.max(evidenceRefs.length, 1),
      }
    }

    // 3. Claim statement overlap — high overlap alone is sufficient
    const existingClaimText = existing.claims.map((c) => c.statement.toLowerCase()).join(" ")
    const overlap = computeWordJaccard(proposalClaimText, existingClaimText)
    if (overlap >= 0.75) {
      return {
        verdict: "duplicate_claim",
        similarProposalId: existing.proposalId,
        reason: `Already proposed: ${Math.round(overlap * 100)}% word overlap with proposal ${existing.proposalId}`,
        similarityScore: overlap,
      }
    }

    // 4. Moderate claim + scope overlap
    const scopeMatch = computeScopeOverlap(scope, existing.scope)
    if (scopeMatch >= 0.5 && overlap >= 0.4) {
      return {
        verdict: "duplicate_scope",
        similarProposalId: existing.proposalId,
        reason: `Already proposed: scope overlap ${Math.round(scopeMatch * 100)}% and claim overlap ${Math.round(overlap * 100)}% with proposal ${existing.proposalId}`,
        similarityScore: (scopeMatch + overlap) / 2,
      }
    }
  }

  return {
    verdict: "novel",
    similarProposalId: null,
    reason: "Proposal is novel — no overlap with existing proposals",
    similarityScore: 0,
  }
}

/**
 * Compute lexical overlap between two strings as a fraction of shared
 * word bigrams over total unique bigrams.
 */
export function computeLexicalOverlap(a: string, b: string): number {
  const bigramsA = extractBigrams(a)
  const bigramsB = extractBigrams(b)

  if (bigramsA.size === 0 || bigramsB.size === 0) return 0

  let intersection = 0
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++
  }

  const union = new Set([...bigramsA, ...bigramsB])
  return intersection / union.size
}

function extractBigrams(text: string): Set<string> {
  const words = text.split(/\s+/).filter((w) => w.length > 2)
  const bigrams = new Set<string>()
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`)
  }
  return bigrams
}

/**
 * Compute word-level Jaccard similarity between two strings.
 */
export function computeWordJaccard(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++
  }

  const union = new Set([...wordsA, ...wordsB])
  return intersection / union.size
}

/**
 * Compute scope overlap between two scope descriptors.
 * Checks hardware targets, software versions, and model families.
 */
export function computeScopeOverlap(a: ScopeDescriptor, b: ScopeDescriptor): number {
  const fields = [
    { label: "hardware", values: a.hardwareTargets, other: b.hardwareTargets },
    { label: "software", values: a.softwareVersions, other: b.softwareVersions },
    { label: "models", values: a.modelFamilies, other: b.modelFamilies },
  ]

  let totalOverlap = 0
  let totalFields = 0

  for (const field of fields) {
    // Both empty means unspecified — don't count for or against overlap
    if (field.values.length === 0 && field.other.length === 0) {
      continue  // skip field entirely
    }
    totalFields++
    const aSet = new Set(field.values)
    const shared = field.other.filter((v) => aSet.has(v)).length
    const union = new Set([...field.values, ...field.other])
    totalOverlap += shared / Math.max(union.size, 1)
  }

  return totalFields > 0 ? totalOverlap / totalFields : 0
}

// ── Proposal Lifecycle ────────────────────────────────────────────────

export function acceptProposal(proposal: DebugProposal): DebugProposal {
  return { ...proposal, status: "accepted" }
}

export function rejectAsDuplicate(proposal: DebugProposal, noveltyResult: NoveltyResult): DebugProposal {
  return { ...proposal, status: "rejected_duplicate", noveltyResult }
}

export function rejectAsInvalid(proposal: DebugProposal, reason: string): DebugProposal {
  return { ...proposal, status: "rejected_invalid" }
}

export function markImplemented(proposal: DebugProposal): DebugProposal {
  return { ...proposal, status: "implemented" }
}

// ── Debug Request Store ───────────────────────────────────────────────

export interface DebugStore {
  requests: Map<string, DebugRequest>
  proposals: Map<string, DebugProposal>
  proposalsByRequest: Map<string, string[]>  // requestId → proposalIds
}

export function createDebugStore(): DebugStore {
  return { requests: new Map(), proposals: new Map(), proposalsByRequest: new Map() }
}

export function addRequest(store: DebugStore, request: DebugRequest): DebugStore {
  const updated = new Map(store.requests)
  updated.set(request.requestId, request)
  return { ...store, requests: updated }
}

export function addProposal(store: DebugStore, proposal: DebugProposal, checkNoveltyAgainstExisting: boolean): { store: DebugStore; noveltyResult: NoveltyResult } {
  if (checkNoveltyAgainstExisting) {
    const existing = store.proposalsByRequest.get(proposal.requestId) || []
    const existingProposals = existing.map((id) => store.proposals.get(id)).filter(Boolean) as DebugProposal[]
    const novelty = checkNovelty(proposal, existingProposals)

    if (novelty.verdict !== "novel") {
      const rejected = rejectAsDuplicate(proposal, novelty)
      const updatedProposals = new Map(store.proposals)
      updatedProposals.set(rejected.proposalId, rejected)

      const updatedByRequest = new Map(store.proposalsByRequest)
      const existingList = updatedByRequest.get(proposal.requestId) || []
      updatedByRequest.set(proposal.requestId, [...existingList, rejected.proposalId])

      return { store: { ...store, proposals: updatedProposals, proposalsByRequest: updatedByRequest }, noveltyResult: novelty }
    }

    // Novel — accept
    const accepted = { ...proposal, noveltyResult: novelty, status: "pending" as const }
    const updatedProposals = new Map(store.proposals)
    updatedProposals.set(accepted.proposalId, accepted)

    const updatedByRequest = new Map(store.proposalsByRequest)
    const existingList = updatedByRequest.get(proposal.requestId) || []
    updatedByRequest.set(proposal.requestId, [...existingList, accepted.proposalId])

    // Increment proposal count on request
    const req = store.requests.get(proposal.requestId)
    if (req) {
      const updatedReqs = new Map(store.requests)
      updatedReqs.set(req.requestId, { ...req, proposalCount: req.proposalCount + 1 })
      return { store: { ...store, proposals: updatedProposals, proposalsByRequest: updatedByRequest, requests: updatedReqs }, noveltyResult: novelty }
    }

    return { store: { ...store, proposals: updatedProposals, proposalsByRequest: updatedByRequest }, noveltyResult: novelty }
  }

  // Skip novelty check
  const updatedProposals = new Map(store.proposals)
  updatedProposals.set(proposal.proposalId, proposal)

  const updatedByRequest = new Map(store.proposalsByRequest)
  const existingList = updatedByRequest.get(proposal.requestId) || []
  updatedByRequest.set(proposal.requestId, [...existingList, proposal.proposalId])

  return {
    store: { ...store, proposals: updatedProposals, proposalsByRequest: updatedByRequest },
    noveltyResult: { verdict: "novel", similarProposalId: null, reason: "Novelty check skipped", similarityScore: 0 },
  }
}

export function getProposalsByRequest(store: DebugStore, requestId: string): DebugProposal[] {
  const ids = store.proposalsByRequest.get(requestId) || []
  return ids.map((id) => store.proposals.get(id)).filter(Boolean) as DebugProposal[]
}

export function getNovelProposals(store: DebugStore, requestId: string): DebugProposal[] {
  return getProposalsByRequest(store, requestId).filter((p) => p.status !== "rejected_duplicate")
}

export function getAcceptedProposal(store: DebugStore, requestId: string): DebugProposal | undefined {
  return getProposalsByRequest(store, requestId).find((p) => p.status === "accepted")
}
