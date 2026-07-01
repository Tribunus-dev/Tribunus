/**
 * Phase 5 — Codex Query Surface
 *
 * Three retrieval modes:
 *   - discovery   — Semantic/broad, returns entries ranked by relevance
 *   - evidence    — Exact/provenance-heavy, returns entries with full evidence trail
 *   - operational — Only entries meeting a caller's declared minimum threshold
 *
 * Scope matching is semantic (set-overlap, version-range aware) rather than
 * textual. Lineage warnings surface for superseded, contested, and revoked entries.
 */

import type {
  CodexEntry,
  CodexVisibilityClass,
  KnowledgeClass,
  EvidenceQuality,
  ScopeDescriptor,
} from "./codex-types"

// ── Retrieval Mode ───────────────────────────────────────────────────────────

export type RetrievalMode = "discovery" | "evidence" | "operational"

// ── Query ────────────────────────────────────────────────────────────────────

export interface CodexQuery {
  mode: RetrievalMode
  query: string
  filters?: {
    knowledgeClasses?: KnowledgeClass[]
    visibilityClasses?: CodexVisibilityClass[]
    contributorIds?: string[]
    sourceArtifactDigests?: string[]
    hardwareTargets?: string[]
    softwareVersions?: string[]
    evidenceQuality?: EvidenceQuality
    reproducibilityStatus?: string
    minConfidence?: number
    logicalTimeRange?: { from: string; to: string }
  }
  limit?: number
  offset?: number
}

export interface CodexQueryResult {
  mode: RetrievalMode
  items: CodexQueryItem[]
  totalCount: number
  hasMore: boolean
}

export interface CodexQueryItem {
  entry: CodexEntry
  relevanceScore: number
  matchReason: string
  provenanceSummary: {
    authoredBy: string[]
    approvedBy: string[]
    ingestionMode: string
    evidenceCount: number
  }
  qualitySummary: {
    evidenceQuality: EvidenceQuality
    corroborationCount: number
    reproducibilityStatus: string
    confidence: number
  }
  lineageWarning: string | null
  scopeContext: ScopeDescriptor
  eligibilitySummary: string
}

// ── Sorting Helpers ──────────────────────────────────────────────────────────

const QUALITY_RANK: Record<EvidenceQuality, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

const REPRODUCIBILITY_RANK: Record<string, number> = {
  independently_reproduced: 4,
  reproduced: 3,
  unverified: 2,
  contradicted: 1,
}

// ── Discovery Mode ───────────────────────────────────────────────────────────

/**
 * Discovery mode returns ALL entries matching filters, sorted by relevance.
 * Relevance is computed via lexical term matching across title, abstract,
 * and claim statements.
 */
export function discoveryQuery(entries: CodexEntry[], query: CodexQuery): CodexQueryResult {
  const eligible = applyFilters(entries, query.filters)
  const terms = tokenize(query.query)

  const items: CodexQueryItem[] = eligible.map((entry) => {
    const score = scoreRelevance(entry, query.query)
    const matchTerms = terms.filter((t) => {
      const lc = t.toLowerCase()
      return (
        entry.title.toLowerCase().includes(lc) ||
        entry.abstract.toLowerCase().includes(lc) ||
        entry.claims.some((c) => c.statement.toLowerCase().includes(lc))
      )
    })
    const reason =
      matchTerms.length > 0
        ? `Matched terms: ${matchTerms.slice(0, 5).join(", ")}${matchTerms.length > 5 ? "..." : ""}`
        : "No term match"
    return formatQueryItem(entry, score, reason)
  })

  const sorted = sortByRelevance(items)
  return paginateResult("discovery", sorted, query.limit, query.offset)
}

/**
 * Score an entry's relevance to a query string.
 * Returns a score in [0, 1] based on how many query terms appear in
 * title (weighted 3x), abstract (weighted 2x), and claim statements (1x).
 */
export function scoreRelevance(entry: CodexEntry, query: string): number {
  const terms = tokenize(query)
  if (terms.length === 0) return 0

  let weightedHits = 0
  let weightedTotal = 0

  for (const term of terms) {
    // Title: 3x weight
    weightedTotal += 3
    if (tokenize(entry.title).some((t) => t.startsWith(term) || term.startsWith(t))) {
      weightedHits += 3
      continue
    }

    // Abstract: 2x weight
    weightedTotal += 2
    if (tokenize(entry.abstract).some((t) => t.startsWith(term) || term.startsWith(t))) {
      weightedHits += 2
      continue
    }

    // Claim statements: 1x weight
    const inClaims = entry.claims.some((c) =>
      tokenize(c.statement).some((t) => t.startsWith(term) || term.startsWith(t)),
    )
    weightedTotal += 1
    if (inClaims) {
      weightedHits += 1
    }
  }

  return weightedTotal > 0 ? weightedHits / weightedTotal : 0
}

/**
 * Count how many of the given terms appear anywhere in the entry
 * (title, abstract, or claim statements).
 */
export function lexicalMatch(entry: CodexEntry, terms: string[]): number {
  if (terms.length === 0) return 0
  return terms.filter((t) => {
    const lc = t.toLowerCase()
    return (
      entry.title.toLowerCase().includes(lc) ||
      entry.abstract.toLowerCase().includes(lc) ||
      entry.claims.some((c) => c.statement.toLowerCase().includes(lc))
    )
  }).length
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean)
}

// ── Evidence Mode ────────────────────────────────────────────────────────────

/**
 * Evidence mode returns only entries with evidenceQuality >= the specified
 * minimum, sorted by quality (high -> medium -> low), then by corroboration count.
 */
export function evidenceQuery(entries: CodexEntry[], query: CodexQuery): CodexQueryResult {
  let eligible = applyFilters(entries, query.filters)

  const minQuality = query.filters?.evidenceQuality ?? "low"
  eligible = filterByEvidenceQuality(eligible, minQuality)

  const items: CodexQueryItem[] = eligible.map((entry) => {
    const q = entry.quality.evidenceQuality
    const reason =
      q === "high" ? "High quality evidence" :
      q === "medium" ? "Medium quality evidence" :
      "Low quality evidence"
    return formatQueryItem(entry, QUALITY_RANK[q] ?? 0, reason)
  })

  const sorted = sortByEvidenceQuality(items)
  return paginateResult("evidence", sorted, query.limit, query.offset)
}

/**
 * Filter entries to only those with evidence quality >= the minimum.
 */
export function filterByEvidenceQuality(
  entries: CodexEntry[],
  minQuality: EvidenceQuality,
): CodexEntry[] {
  const minRank = QUALITY_RANK[minQuality] ?? 1
  return entries.filter((e) => (QUALITY_RANK[e.quality.evidenceQuality] ?? 1) >= minRank)
}

/**
 * Filter entries to only those whose provenance includes any of the given contributor IDs.
 */
export function filterByProvenance(
  entries: CodexEntry[],
  contributorIds: string[],
): CodexEntry[] {
  if (contributorIds.length === 0) return entries
  const set = new Set(contributorIds)
  return entries.filter(
    (e) =>
      e.provenance.authoredBy.some((id) => set.has(id)) ||
      e.provenance.approvedBy.some((id) => set.has(id)),
  )
}

/**
 * Filter entries by visibility class.
 */
export function filterByVisibility(
  entries: CodexEntry[],
  classes: CodexVisibilityClass[],
): CodexEntry[] {
  if (classes.length === 0) return entries
  const set = new Set(classes)
  return entries.filter((e) => set.has(e.visibilityClass))
}

// ── Operational Mode ─────────────────────────────────────────────────────────

/**
 * Operational mode returns only entries meeting a caller's declared minimum
 * threshold for evidence quality, confidence, and reproducibility.
 */
export function operationalQuery(entries: CodexEntry[], query: CodexQuery): CodexQueryResult {
  const eligible = applyFilters(entries, query.filters)
  const minQuality = query.filters?.evidenceQuality ?? "low"
  const minConfidence = query.filters?.minConfidence ?? 0.5
  const minReproducibility = query.filters?.reproducibilityStatus ?? "unverified"

  const passing = eligible.filter((e) =>
    meetsOperationalThreshold(e, minQuality, minConfidence, minReproducibility),
  )

  const items: CodexQueryItem[] = passing.map((entry) => {
    return formatQueryItem(entry, scoreRelevance(entry, query.query), "Meets operational threshold")
  })

  // Operational mode sorts by relevance among qualifying entries
  const sorted = sortByRelevance(items)
  return paginateResult("operational", sorted, query.limit, query.offset)
}

/**
 * Check whether an entry meets the caller's minimum operational thresholds.
 */
export function meetsOperationalThreshold(
  entry: CodexEntry,
  minQuality: EvidenceQuality,
  minConfidence: number,
  minReproducibility: string,
): boolean {
  const qRank = QUALITY_RANK[entry.quality.evidenceQuality] ?? 1
  const minQRank = QUALITY_RANK[minQuality] ?? 1
  if (qRank < minQRank) return false

  if (entry.quality.confidence < minConfidence) return false

  const rRank = REPRODUCIBILITY_RANK[entry.quality.reproducibilityStatus] ?? 0
  const minRRank = REPRODUCIBILITY_RANK[minReproducibility] ?? 0
  if (rRank < minRRank) return false

  return true
}

// ── Query Execution ──────────────────────────────────────────────────────────

const MODE_DISPATCH: Record<
  RetrievalMode,
  (entries: CodexEntry[], query: CodexQuery) => CodexQueryResult
> = {
  discovery: discoveryQuery,
  evidence: evidenceQuery,
  operational: operationalQuery,
}

/**
 * Dispatch to the correct retrieval mode based on query.mode.
 */
export function executeQuery(entries: CodexEntry[], query: CodexQuery): CodexQueryResult {
  const handler = MODE_DISPATCH[query.mode]
  if (!handler) {
    return {
      mode: query.mode,
      items: [],
      totalCount: 0,
      hasMore: false,
    }
  }
  return handler(entries, query)
}

// ── Result Formatting ────────────────────────────────────────────────────────

/**
 * Build a CodexQueryItem from an entry, score, and match reason.
 */
export function formatQueryItem(
  entry: CodexEntry,
  score: number,
  reason: string,
): CodexQueryItem {
  return {
    entry,
    relevanceScore: score,
    matchReason: reason,
    provenanceSummary: {
      authoredBy: [...entry.provenance.authoredBy],
      approvedBy: [...entry.provenance.approvedBy],
      ingestionMode: entry.provenance.ingestionMode,
      evidenceCount: entry.evidenceRefs.length,
    },
    qualitySummary: {
      evidenceQuality: entry.quality.evidenceQuality,
      corroborationCount: entry.quality.corroborationCount,
      reproducibilityStatus: entry.quality.reproducibilityStatus,
      confidence: entry.quality.confidence,
    },
    lineageWarning: getLineageWarning(entry),
    scopeContext: {
      ...(entry.claims[0]?.scope ?? { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }),
    },
    eligibilitySummary: getEligibilitySummary(entry),
  }
}

/**
 * Generate a lineage warning for entries that are superseded, contested,
 * or revoked.
 */
export function getLineageWarning(entry: CodexEntry): string | null {
  switch (entry.status) {
    case "superseded":
      if (entry.lineage.supersededBy) {
        return `Superseded by ${entry.lineage.supersededBy}`
      }
      return "Superseded"
    case "contested":
      return "Contested"
    case "revoked":
      return "Revoked"
    default:
      return null
  }
}

/**
 * Generate a human-readable summary of an entry's query eligibility.
 */
export function getEligibilitySummary(entry: CodexEntry): string {
  const el = entry.policy.queryEligibility
  const vc = entry.visibilityClass
  const status = entry.status

  if (status === "revoked" || status === "contested") {
    return `Not eligible — entry is ${status}`
  }
  if (status === "draft" || status === "proposed") {
    return `Limited eligibility — entry is ${status}`
  }

  switch (el) {
    case "all":
      return "Eligible for all queries"
    case "authenticated":
      return "Eligible for authenticated queries only"
    case "grant_required":
      return `Eligible with grant (visibility: ${vc})`
  }
}

// ── Utility Filters ──────────────────────────────────────────────────────────

/**
 * Apply all filters defined in the query's filter spec.
 * Returns a new array — does not mutate the input.
 */
export function applyFilters(
  entries: CodexEntry[],
  filters: CodexQuery["filters"],
): CodexEntry[] {
  if (!filters) return [...entries]

  let result = [...entries]

  if (filters.knowledgeClasses && filters.knowledgeClasses.length > 0) {
    const set = new Set(filters.knowledgeClasses)
    result = result.filter((e) => set.has(e.knowledgeClass))
  }

  if (filters.visibilityClasses && filters.visibilityClasses.length > 0) {
    result = filterByVisibility(result, filters.visibilityClasses)
  }

  if (filters.contributorIds && filters.contributorIds.length > 0) {
    result = filterByProvenance(result, filters.contributorIds)
  }

  if (filters.sourceArtifactDigests && filters.sourceArtifactDigests.length > 0) {
    const set = new Set(filters.sourceArtifactDigests)
    result = result.filter((e) =>
      e.sourceArtifactRefs.some((ref) => set.has(ref.artifactDigest)),
    )
  }

  if (filters.hardwareTargets && filters.hardwareTargets.length > 0) {
    const querySet = new Set(filters.hardwareTargets.map((t) => t.toLowerCase()))
    result = result.filter((e) => {
      const entryTargets = new Set(
        e.claims.flatMap((c) => c.scope.hardwareTargets.map((t) => t.toLowerCase())),
      )
      return Array.from(querySet).some((qt) =>
        Array.from(entryTargets).some(
          (et) => et === qt || et.startsWith(qt) || qt.startsWith(et),
        ),
      )
    })
  }

  if (filters.softwareVersions && filters.softwareVersions.length > 0) {
    const queryVersions = filters.softwareVersions
    result = result.filter((e) => {
      const entryVersions = new Set(
        e.claims.flatMap((c) => c.scope.softwareVersions),
      )
      return Array.from(entryVersions).some((ev) =>
        queryVersions.some((qv) => versionsOverlap(qv, ev)),
      )
    })
  }

  if (filters.evidenceQuality) {
    result = filterByEvidenceQuality(result, filters.evidenceQuality)
  }

  if (filters.reproducibilityStatus) {
    const minR = REPRODUCIBILITY_RANK[filters.reproducibilityStatus] ?? 0
    result = result.filter(
      (e) => (REPRODUCIBILITY_RANK[e.quality.reproducibilityStatus] ?? 0) >= minR,
    )
  }

  if (filters.minConfidence !== undefined) {
    result = result.filter((e) => e.quality.confidence >= (filters.minConfidence ?? 0))
  }

  if (filters.logicalTimeRange) {
    const r = filters.logicalTimeRange
    result = result.filter((e) => matchTimeRange(e, r.from, r.to))
  }

  return result
}

/**
 * Match a query scope descriptor against an entry's claim scopes.
 * Returns true if there is any semantic overlap in hardware targets,
 * software versions, or model families.
 */
export function matchScope(
  queryScope: ScopeDescriptor | undefined,
  entryScope: ScopeDescriptor,
): boolean {
  if (!queryScope) return true

  // Hardware targets: exact or prefix-based match (e.g. "m1" matches "m1-pro")
  if (
    queryScope.hardwareTargets.length > 0 &&
    !queryScope.hardwareTargets.some((q) =>
      entryScope.hardwareTargets.some(
        (e) => e.startsWith(q) || q.startsWith(e),
      ),
    )
  ) {
    return false
  }

  // Software versions: semantic version prefix matching
  if (
    queryScope.softwareVersions.length > 0 &&
    !queryScope.softwareVersions.some((q) =>
      entryScope.softwareVersions.some((e) => versionsOverlap(q, e)),
    )
  ) {
    return false
  }

  // Model families: case-insensitive substring
  if (queryScope.modelFamilies.length > 0) {
    const ql = queryScope.modelFamilies.map((m) => m.toLowerCase())
    const el = entryScope.modelFamilies.map((m) => m.toLowerCase())
    const hasOverlap = ql.some((q) =>
      el.some((e) => e.includes(q) || q.includes(e)),
    )
    if (!hasOverlap) return false
  }

  return true
}

/**
 * Check whether an entry's creation time falls within a range.
 */
export function matchTimeRange(
  entry: CodexEntry,
  from?: string,
  to?: string,
): boolean {
  const t = entry.provenance.createdAtLogicalTime
  if (!t) return !from && !to

  if (from && t < from) return false
  if (to && t > to) return false
  return true
}

/**
 * Check if two version strings semantically overlap.
 * Handles: exact, wildcard ("3.x", "3.*", "x"), range prefix (">=2"),
 * and caret/tilde ("^2", "~2").
 */
function versionsOverlap(a: string, b: string): boolean {
  const stripVersion = (v: string) => v.replace(/^[~^>=<]+\s*/, "").replace(/[.x*]$/, "").trim()
  const normalizedA = stripVersion(a)
  const normalizedB = stripVersion(b)
  if (normalizedA === normalizedB) return true

  // Wildcard check: "3.x" matches "3.0.1", "2.*" matches "2.5.0"
  const wildcardMatch = (pattern: string, target: string): boolean => {
    const p = pattern.replace(/[.*x]/g, "").trim().toLowerCase()
    const t = target.toLowerCase()
    return t.startsWith(p) && p.length > 0
  }
  if (wildcardMatch(a, b) || wildcardMatch(b, a)) return true

  // Range prefix check: ">=2" matches "2.5.0"
  const rangeMatch = (range: string, target: string): boolean => {
    const m = range.match(/^>=?\s*([\d.]+)/)
    if (!m) return false
    const prefix = m[1]
    const t = target.replace(/^[~^>=<]+\s*/, "").trim()
    return t.startsWith(prefix) && prefix.length > 0 && t.length > prefix.length
  }
  if (rangeMatch(a, b) || rangeMatch(b, a)) return true

  return false
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/**
 * Sort query items by relevance score descending, then by confidence descending.
 */
export function sortByRelevance(items: CodexQueryItem[]): CodexQueryItem[] {
  return [...items].sort((a, b) => {
    const scoreDiff = b.relevanceScore - a.relevanceScore
    if (scoreDiff !== 0) return scoreDiff
    return b.qualitySummary.confidence - a.qualitySummary.confidence
  })
}

/**
 * Sort query items by evidence quality rank descending (high -> medium -> low),
 * then by corroboration count descending, then by confidence descending.
 */
export function sortByEvidenceQuality(items: CodexQueryItem[]): CodexQueryItem[] {
  return [...items].sort((a, b) => {
    const qDiff =
      (QUALITY_RANK[b.qualitySummary.evidenceQuality] ?? 0) -
      (QUALITY_RANK[a.qualitySummary.evidenceQuality] ?? 0)
    if (qDiff !== 0) return qDiff

    const corrDiff = b.qualitySummary.corroborationCount - a.qualitySummary.corroborationCount
    if (corrDiff !== 0) return corrDiff

    return b.qualitySummary.confidence - a.qualitySummary.confidence
  })
}

// ── Pagination ───────────────────────────────────────────────────────────────

function paginateResult(
  mode: RetrievalMode,
  items: CodexQueryItem[],
  limit?: number,
  offset?: number,
): CodexQueryResult {
  const totalCount = items.length
  const start = offset ?? 0
  const pageLimit = limit ?? totalCount
  const paged = items.slice(start, start + pageLimit)

  return {
    mode,
    items: paged,
    totalCount,
    hasMore: start + pageLimit < totalCount,
  }
}
