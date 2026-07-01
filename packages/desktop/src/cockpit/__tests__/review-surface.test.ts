/**
 * ReviewSurface — Unit Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createReviewItem,
  approveReview,
  rejectReview,
  requestRevision,
  getPendingReviews,
  getReviewsByReviewer,
  type ReviewItem,
} from "../review-surface"

/* ── createReviewItem ───────────────────────────────────── */

describe("createReviewItem", () => {
  test("creates an item with pending decision", () => {
    const item = createReviewItem("t1", "alice", "abc123")
    expect(item.taskId).toBe("t1")
    expect(item.contributorId).toBe("alice")
    expect(item.resultBundleDigest).toBe("abc123")
    expect(item.decision).toBe("pending")
    expect(item.decidedBy).toBeNull()
    expect(item.decidedAt).toBeNull()
    expect(item.decisionReason).toBeNull()
  })
})

/* ── approveReview ──────────────────────────────────────── */

describe("approveReview", () => {
  test("transitions pending → approved", () => {
    const item = createReviewItem("t1", "alice", "abc")
    const approved = approveReview(item, "reviewer1")
    expect(approved.decision).toBe("approved")
    expect(approved.decidedBy).toBe("reviewer1")
    expect(approved.decidedAt).toBeTruthy()
  })

  test("throws from approved", () => {
    const item = createReviewItem("t1", "alice", "abc")
    const approved = approveReview(item, "r1")
    expect(() => approveReview(approved, "r2")).toThrow("Invalid review transition")
  })
})

/* ── rejectReview ───────────────────────────────────────── */

describe("rejectReview", () => {
  test("transitions pending → rejected with reason", () => {
    const item = createReviewItem("t1", "alice", "abc")
    const rejected = rejectReview(item, "reviewer1", "Does not meet criteria")
    expect(rejected.decision).toBe("rejected")
    expect(rejected.decidedBy).toBe("reviewer1")
    expect(rejected.decisionReason).toBe("Does not meet criteria")
  })

  test("throws from rejected", () => {
    const item = createReviewItem("t1", "alice", "abc")
    const rejected = rejectReview(item, "r1", "bad")
    expect(() => rejectReview(rejected, "r2", "also bad")).toThrow("Invalid review transition")
  })
})

/* ── requestRevision ────────────────────────────────────── */

describe("requestRevision", () => {
  test("transitions pending → needs_revision with reason", () => {
    const item = createReviewItem("t1", "alice", "abc")
    const revised = requestRevision(item, "reviewer1", "Please clarify")
    expect(revised.decision).toBe("needs_revision")
    expect(revised.decidedBy).toBe("reviewer1")
    expect(revised.decisionReason).toBe("Please clarify")
  })

  test("throws from needs_revision when going to needs_revision again", () => {
    const item = createReviewItem("t1", "alice", "abc")
    const revised = requestRevision(item, "r1", "fix")
    expect(() => requestRevision(revised, "r2", "fix again")).toThrow("Invalid review transition")
  })
})

/* ── getPendingReviews ──────────────────────────────────── */

describe("getPendingReviews", () => {
  test("returns only pending items", () => {
    const items: ReviewItem[] = [
      { ...createReviewItem("t1", "alice", "a"), decision: "pending" as const },
      { ...createReviewItem("t2", "bob", "b"), decision: "approved" as const, decidedBy: "r1", decidedAt: "x" },
      { ...createReviewItem("t3", "carol", "c"), decision: "pending" as const },
    ]
    const pending = getPendingReviews(items)
    expect(pending).toHaveLength(2)
  })
})

/* ── getReviewsByReviewer ───────────────────────────────── */

describe("getReviewsByReviewer", () => {
  test("filters by reviewer", () => {
    const items: ReviewItem[] = [
      {
        ...createReviewItem("t1", "alice", "a"),
        decision: "approved" as const,
        decidedBy: "reviewer1",
        decidedAt: "x",
      },
      {
        ...createReviewItem("t2", "bob", "b"),
        decision: "rejected" as const,
        decidedBy: "reviewer2",
        decidedAt: "x",
        decisionReason: "nope",
      },
      {
        ...createReviewItem("t3", "carol", "c"),
        decision: "approved" as const,
        decidedBy: "reviewer1",
        decidedAt: "x",
      },
    ]
    const r1Items = getReviewsByReviewer(items, "reviewer1")
    expect(r1Items).toHaveLength(2)
  })

  test("returns empty for reviewer with no reviews", () => {
    const items: ReviewItem[] = [
      {
        ...createReviewItem("t1", "alice", "a"),
        decision: "approved" as const,
        decidedBy: "r1",
        decidedAt: "x",
      },
    ]
    expect(getReviewsByReviewer(items, "nobody")).toHaveLength(0)
  })
})
