/**
 * ReviewSurface — review and accept/reject result bundles.
 *
 * Pure data types and state machine — no UI rendering. Provides the logic
 * layer for reviewing submitted task results.
 */

/* ── Types ──────────────────────────────────────────────── */

export type ReviewDecision =
  | "pending"
  | "approved"
  | "rejected"
  | "needs_revision"

export interface ReviewItem {
  reviewId: string
  sessionId: string
  taskId: string
  contributorId: string
  resultBundleDigest: string
  receivedAt: string
  decision: ReviewDecision
  decidedBy: string | null
  decidedAt: string | null
  decisionReason: string | null
}

/* ── Transition helpers ─────────────────────────────────── */

const VALID_DECISIONS: Record<ReviewDecision, ReviewDecision[]> = {
  pending:        ["approved", "rejected", "needs_revision"],
  approved:       [],
  rejected:       [],
  needs_revision: ["pending"],
}

function assertTransition(from: ReviewDecision, to: ReviewDecision): void {
  const allowed = VALID_DECISIONS[from]
  if (!allowed?.includes(to)) {
    throw new Error(`Invalid review transition: ${from} → ${to}`)
  }
}

function copy<T extends ReviewItem>(item: T): T {
  return { ...item }
}

/* ── Factory ────────────────────────────────────────────── */

export function createReviewItem(
  taskId: string,
  contributorId: string,
  resultDigest: string,
): ReviewItem {
  return {
    reviewId: crypto.randomUUID(),
    sessionId: "",
    taskId,
    contributorId,
    resultBundleDigest: resultDigest,
    receivedAt: new Date().toISOString(),
    decision: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
  }
}

/* ── Transitions ────────────────────────────────────────── */

export function approveReview(
  item: ReviewItem,
  reviewerId: string,
): ReviewItem {
  assertTransition(item.decision, "approved")
  return {
    ...copy(item),
    decision: "approved",
    decidedBy: reviewerId,
    decidedAt: new Date().toISOString(),
    decisionReason: null,
  }
}

export function rejectReview(
  item: ReviewItem,
  reviewerId: string,
  reason: string,
): ReviewItem {
  assertTransition(item.decision, "rejected")
  return {
    ...copy(item),
    decision: "rejected",
    decidedBy: reviewerId,
    decidedAt: new Date().toISOString(),
    decisionReason: reason,
  }
}

export function requestRevision(
  item: ReviewItem,
  reviewerId: string,
  reason: string,
): ReviewItem {
  assertTransition(item.decision, "needs_revision")
  return {
    ...copy(item),
    decision: "needs_revision",
    decidedBy: reviewerId,
    decidedAt: new Date().toISOString(),
    decisionReason: reason,
  }
}

/* ── Queries ────────────────────────────────────────────── */

export function getPendingReviews(items: ReviewItem[]): ReviewItem[] {
  return items.filter((r) => r.decision === "pending")
}

export function getReviewsByReviewer(
  items: ReviewItem[],
  reviewerId: string,
): ReviewItem[] {
  return items.filter((r) => r.decidedBy === reviewerId)
}
