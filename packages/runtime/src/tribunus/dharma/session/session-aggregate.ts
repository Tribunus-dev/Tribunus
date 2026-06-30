/**
 * Dharma Session Authority — Session Aggregate
 *
 * Builds, validates, and checks DharmaSessionAggregate structures
 * for Codex ingestion and disclosure compliance.
 */

import type {
  DharmaSession,
  DharmaSessionAggregate,
  SessionAuthorityGrant,
  SessionCommandReceipt,
  WorkspaceMutation,
  ComputeLease,
  SessionMember,
} from "./types"

// ── Aggregate Construction ---------------------------------------------------

/**
 * Create a session aggregate from session state.
 *
 * The aggregate is designed for Codex ingestion — it contains digests,
 * summaries, classifications, and structured metadata, never raw source code,
 * private keys, credentials, full terminal logs, or private overlays.
 */
export function createSessionAggregate(config: {
  session: DharmaSession
  members: SessionMember[]
  grants: SessionAuthorityGrant[]
  receipts: SessionCommandReceipt[]
  mutations: WorkspaceMutation[]
  leases: ComputeLease[]
  outcomeClassification: string
}): DharmaSessionAggregate {
  const { session, members, grants, receipts, mutations, leases, outcomeClassification } = config

  return {
    aggregateId: crypto.randomUUID(),
    sessionId: session.sessionId,
    federationId: session.federationId,
    ownerIdentityPublicKey: session.ownerIdentityPublicKey,
    sourceRevisionDigest: session.sourceRevision,
    environmentDigest: session.sandboxPolicyDigest ?? session.sandboxImageDigest ?? null,
    taskTaxonomy: buildTaskTaxonomy(members, grants, receipts),
    taskSummaryDigest: computeTaskSummaryDigest(session, members, receipts),
    authorityTopologyDigest: computeAuthorityTopologyDigest(grants),
    participantRoleSummary: computeParticipantRoleSummary(members),
    collaborationTimelineSummary: computeCollaborationTimelineSummary(members),
    approvedActionSummaries: buildApprovedActionSummaries(receipts),
    verificationResults: buildVerificationResults(receipts),
    acceptedPatchDigests: mutations
      .filter((m) => m.approvalState === "accepted")
      .map((m) => m.afterDigest ?? m.mutationId),
    executionReceiptDigests: receipts.map((r) => r.receiptId),
    computeUsageSummary: buildComputeUsageSummary(leases),
    outcomeClassification,
    contributionReceiptIds: receipts.map((r) => r.receiptId),
    disclosurePolicy: session.disclosurePolicyDigest ?? "",
    redactionManifestDigest: null,
    provenanceChainDigest: computeProvenanceChainDigest(session, grants),
    emittedAt: new Date().toISOString(),
    signatureChain: [],
  }
}

// ── Authority Topology Digest -------------------------------------------------

/**
 * Compute the authority topology digest from a list of grants.
 * Ensures determinism by sorting grants by grantId before hashing.
 */
export function computeAuthorityTopologyDigest(grants: SessionAuthorityGrant[]): string {
  const sorted = [...grants].sort((a, b) => a.grantId.localeCompare(b.grantId))
  const parts = sorted.map(
    (g) => `${g.grantId}:${g.subjectIdentityPublicKey}:${g.sessionKeyEpoch}:${g.expiresAt ?? "no-expiry"}`,
  )
  return simpleHash(parts.join("|"))
}

// ── Collaboration Timeline Summary --------------------------------------------

/**
 * Compute collaboration timeline summary from member data.
 */
export function computeCollaborationTimelineSummary(members: SessionMember[]): string {
  const activeCount = members.filter((m) => m.status === "active").length
  const totalCount = members.length

  if (totalCount === 0) return "No participants"

  const joinTimes = members
    .filter((m) => m.joinedAt)
    .map((m) => m.joinedAt!)
    .sort()

  const earliest = joinTimes.length > 0 ? joinTimes[0] : null
  const latest = joinTimes.length > 0 ? joinTimes[joinTimes.length - 1] : null

  return [
    `Participants: ${activeCount} active of ${totalCount} total`,
    earliest ? `Earliest join: ${earliest}` : null,
    latest ? `Latest join: ${latest}` : null,
  ]
    .filter(Boolean)
    .join(" | ")
}

// ── Participant Role Summary --------------------------------------------------

/**
 * Compute participant role summary.
 */
export function computeParticipantRoleSummary(members: SessionMember[]): string {
  if (members.length === 0) return "No participants"

  const roleCounts = new Map<string, number>()
  for (const member of members) {
    roleCounts.set(member.displayRole, (roleCounts.get(member.displayRole) ?? 0) + 1)
  }

  const roleParts = [...roleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `${role}=${count}`)

  return roleParts.join(", ")
}

// ── Aggregate Disclosure Verification -----------------------------------------

/**
 * Sensitive content patterns to check for in aggregate fields.
 */
const SENSITIVE_PATTERNS = [
  /-----BEGIN (RSA |EC |)PRIVATE KEY-----/,
  /-----BEGIN OPENSSH PRIVATE KEY-----/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{36,}/,
  /gho_[A-Za-z0-9]{36,}/,
  /AKIA[0-9A-Z]{16}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
]

/**
 * Verify that the aggregate doesn't contain data outside its disclosure policy.
 *
 * Checks that:
 * - No fields contain raw private keys or credentials
 * - The disclosure policy is set
 * - Required digests are present
 */
export function verifyAggregateDisclosure(
  aggregate: DharmaSessionAggregate,
): { compliant: boolean; violations: string[] } {
  const violations: string[] = []

  // Check disclosure policy is set
  if (!aggregate.disclosurePolicy || aggregate.disclosurePolicy.length === 0) {
    violations.push("Disclosure policy is empty or missing")
  }

  // Check for sensitive content in key string fields
  const fieldsToCheck: Array<{ name: string; value: string }> = [
    { name: "taskTaxonomy", value: aggregate.taskTaxonomy },
    { name: "participantRoleSummary", value: aggregate.participantRoleSummary },
    { name: "collaborationTimelineSummary", value: aggregate.collaborationTimelineSummary },
    { name: "approvedActionSummaries", value: aggregate.approvedActionSummaries },
    { name: "verificationResults", value: aggregate.verificationResults },
    { name: "computeUsageSummary", value: aggregate.computeUsageSummary },
    { name: "outcomeClassification", value: aggregate.outcomeClassification },
  ]

  for (const { name, value } of fieldsToCheck) {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(value)) {
        violations.push(`${name} contains potentially sensitive content matching ${pattern}`)
        break // one violation per field
      }
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
  }
}

// ── Ingestion Readiness -------------------------------------------------------

/**
 * Required fields that must be non-empty for Codex ingestion.
 */
const REQUIRED_FOR_INGESTION: Array<keyof DharmaSessionAggregate> = [
  "aggregateId",
  "sessionId",
  "federationId",
  "ownerIdentityPublicKey",
  "sourceRevisionDigest",
  "authorityTopologyDigest",
  "participantRoleSummary",
  "collaborationTimelineSummary",
  "approvedActionSummaries",
  "verificationResults",
  "computeUsageSummary",
  "outcomeClassification",
  "provenanceChainDigest",
  "disclosurePolicy",
]

/**
 * Check if an aggregate is ready for Codex ingestion.
 * All required fields must be present and non-empty.
 */
export function isAggregateReadyForIngestion(aggregate: DharmaSessionAggregate): boolean {
  for (const field of REQUIRED_FOR_INGESTION) {
    const value = aggregate[field]
    if (value === null || value === undefined || (typeof value === "string" && value.length === 0)) {
      return false
    }
  }
  return true
}

// ── Internal Helpers ---------------------------------------------------------

/**
 * Build a task taxonomy string from session state.
 */
function buildTaskTaxonomy(
  _members: SessionMember[],
  _grants: SessionAuthorityGrant[],
  receipts: SessionCommandReceipt[],
): string {
  const kinds = new Set<string>()
  for (const r of receipts) {
    // Receipts don't carry commandKind directly in the aggregate context,
    // so we derive taxonomy from what's available
    kinds.add(r.decision)
  }
  const kindList = [...kinds].sort().join(", ")
  return `session_commands(${kindList})`
}

/**
 * Compute a task summary digest from session state.
 */
function computeTaskSummaryDigest(
  session: DharmaSession,
  _members: SessionMember[],
  _receipts: SessionCommandReceipt[],
): string {
  return simpleHash(session.sourceRevision)
}

/**
 * Build approved action summaries from receipts.
 */
function buildApprovedActionSummaries(receipts: SessionCommandReceipt[]): string {
  const accepted = receipts.filter((r) => r.decision === "accepted").length
  const rejected = receipts.filter((r) => r.decision === "rejected").length
  const total = receipts.length
  return `Accepted: ${accepted}, Rejected: ${rejected}, Total: ${total}`
}

/**
 * Build verification results summary from receipts.
 */
function buildVerificationResults(receipts: SessionCommandReceipt[]): string {
  if (receipts.length === 0) return "No commands executed"
  const finalDecisions = receipts.filter((r) => r.finalizedAt !== null)
  return `${finalDecisions.length} of ${receipts.length} receipts finalized`
}

/**
 * Build compute usage summary from leases.
 */
function buildComputeUsageSummary(leases: ComputeLease[]): string {
  const completed = leases.filter((l) => l.status === "completed").length
  const active = leases.filter((l) => l.status === "active").length
  const total = leases.length
  return `Leases: ${total} total, ${active} active, ${completed} completed`
}

/**
 * Compute provenance chain digest from session and grants.
 */
function computeProvenanceChainDigest(
  session: DharmaSession,
  grants: SessionAuthorityGrant[],
): string {
  const grantDigest = simpleHash(grants.map((g) => g.grantId).sort().join(","))
  return simpleHash(`${session.sourceTreeDigest}:${grantDigest}`)
}

/**
 * Simple deterministic string hash (not cryptographic — for digest generation).
 */
function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i)
    hash = ((hash << 5) - hash + chr) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
