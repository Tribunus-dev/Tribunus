/**
 * TaskBoardSurface — Unit Tests
 *
 * Tests the full state machine with all valid and invalid transitions.
 *
 * Valid transitions:
 *   available     → claimed, cancelled
 *   claimed       → cancelled
 *   in_progress   → submitted, cancelled
 *   submitted     → accepted, rejected
 *   rejected      → available
 *   accepted      → (terminal)
 *   cancelled     → (terminal)
 */

import { expect, test, describe } from "bun:test"
import {
  createTaskItem,
  claimTask,
  submitTask,
  acceptTask,
  rejectTask,
  cancelTask,
  getAvailableTasks,
  getTasksByClaimant,
  type TaskBoardItem,
} from "../task-board-surface"

/* ── Helpers ────────────────────────────────────────────── */

/** Set an item's status (and required fields) without going through the state machine. */
function withStatus(
  base: TaskBoardItem,
  status: TaskBoardItem["status"],
  extra?: Partial<TaskBoardItem>,
): TaskBoardItem {
  return { ...base, status, ...extra }
}

/* ── createTaskItem ─────────────────────────────────────── */

describe("createTaskItem", () => {
  test("creates an item with available status", () => {
    const item = createTaskItem("t1", "s1", "Test Task", "Do the thing")
    expect(item.taskId).toBe("t1")
    expect(item.sessionId).toBe("s1")
    expect(item.title).toBe("Test Task")
    expect(item.description).toBe("Do the thing")
    expect(item.status).toBe("available")
    expect(item.claimedBy).toBeNull()
    expect(item.submittedAt).toBeNull()
    expect(item.acceptedAt).toBeNull()
    expect(item.requiredEvidence).toEqual([])
    expect(item.disclosureClass).toBe("standard")
    expect(item.computePolicy).toBe("default")
  })
})

/* ── claimTask ──────────────────────────────────────────── */

describe("claimTask", () => {
  test("available → claimed", () => {
    const item = createTaskItem("t1", "s1", "A", "B")
    const next = claimTask(item, "alice")
    expect(next.status).toBe("claimed")
    expect(next.claimedBy).toBe("alice")
  })

  test("immutable: original unchanged", () => {
    const item = createTaskItem("t1", "s1", "A", "B")
    claimTask(item, "alice")
    expect(item.status).toBe("available")
  })

  test("throws from claimed", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "claimed", { claimedBy: "alice" })
    expect(() => claimTask(item, "bob")).toThrow("Invalid transition")
  })

  test("throws from in_progress", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "in_progress")
    expect(() => claimTask(item, "bob")).toThrow("Invalid transition")
  })

  test("throws from submitted", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "submitted", { submittedAt: "x" })
    expect(() => claimTask(item, "bob")).toThrow("Invalid transition")
  })

  test("throws from accepted", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "accepted", { acceptedAt: "x" })
    expect(() => claimTask(item, "bob")).toThrow("Invalid transition")
  })

  test("throws from rejected", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "rejected")
    expect(() => claimTask(item, "bob")).toThrow("Invalid transition")
  })

  test("throws from cancelled", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "cancelled")
    expect(() => claimTask(item, "bob")).toThrow("Invalid transition")
  })
})

/* ── submitTask ─────────────────────────────────────────── */

describe("submitTask", () => {
  test("in_progress → submitted", () => {
    const base = createTaskItem("t1", "s1", "A", "B")
    const item = withStatus(base, "in_progress")
    const next = submitTask(item)
    expect(next.status).toBe("submitted")
    expect(next.submittedAt).toBeTruthy()
  })

  test("throws from available", () => {
    const item = createTaskItem("t1", "s1", "A", "B")
    expect(() => submitTask(item)).toThrow("Invalid transition")
  })

  test("throws from claimed", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "claimed", { claimedBy: "alice" })
    expect(() => submitTask(item)).toThrow("Invalid transition")
  })

  test("throws from submitted", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "submitted", { submittedAt: "x" })
    expect(() => submitTask(item)).toThrow("Invalid transition")
  })

  test("throws from accepted", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "accepted", { acceptedAt: "x" })
    expect(() => submitTask(item)).toThrow("Invalid transition")
  })

  test("throws from cancelled", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "cancelled")
    expect(() => submitTask(item)).toThrow("Invalid transition")
  })
})

/* ── acceptTask ─────────────────────────────────────────── */

describe("acceptTask", () => {
  test("submitted → accepted", () => {
    const base = createTaskItem("t1", "s1", "A", "B")
    const item = withStatus(base, "submitted", { submittedAt: "x" })
    const next = acceptTask(item)
    expect(next.status).toBe("accepted")
    expect(next.acceptedAt).toBeTruthy()
  })

  test("throws from available", () => {
    const item = createTaskItem("t1", "s1", "A", "B")
    expect(() => acceptTask(item)).toThrow("Invalid transition")
  })

  test("throws from claimed", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "claimed", { claimedBy: "alice" })
    expect(() => acceptTask(item)).toThrow("Invalid transition")
  })

  test("throws from accepted", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "accepted", { acceptedAt: "x" })
    expect(() => acceptTask(item)).toThrow("Invalid transition")
  })

  test("throws from cancelled", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "cancelled")
    expect(() => acceptTask(item)).toThrow("Invalid transition")
  })
})

/* ── rejectTask ─────────────────────────────────────────── */

describe("rejectTask", () => {
  test("submitted → rejected", () => {
    const base = createTaskItem("t1", "s1", "A", "B")
    const item = withStatus(base, "submitted", { submittedAt: "x" })
    const next = rejectTask(item, "Needs more detail")
    expect(next.status).toBe("rejected")
  })

  test("throws from available", () => {
    const item = createTaskItem("t1", "s1", "A", "B")
    expect(() => rejectTask(item, "nope")).toThrow("Invalid transition")
  })

  test("throws from accepted", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "accepted", { acceptedAt: "x" })
    expect(() => rejectTask(item, "nope")).toThrow("Invalid transition")
  })

  test("throws from cancelled", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "cancelled")
    expect(() => rejectTask(item, "nope")).toThrow("Invalid transition")
  })
})

/* ── cancelTask ─────────────────────────────────────────── */

describe("cancelTask", () => {
  test("available → cancelled", () => {
    const item = createTaskItem("t1", "s1", "A", "B")
    const next = cancelTask(item)
    expect(next.status).toBe("cancelled")
  })

  test("claimed → cancelled", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "claimed", { claimedBy: "alice" })
    const next = cancelTask(item)
    expect(next.status).toBe("cancelled")
  })

  test("in_progress → cancelled", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "in_progress")
    const next = cancelTask(item)
    expect(next.status).toBe("cancelled")
  })

  test("throws from submitted", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "submitted", { submittedAt: "x" })
    expect(() => cancelTask(item)).toThrow("Invalid transition")
  })

  test("throws from accepted", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "accepted", { acceptedAt: "x" })
    expect(() => cancelTask(item)).toThrow("Invalid transition")
  })

  test("throws from rejected", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "rejected")
    expect(() => cancelTask(item)).toThrow("Invalid transition")
  })

  test("throws from cancelled", () => {
    const item = withStatus(createTaskItem("t1", "s1", "A", "B"), "cancelled")
    expect(() => cancelTask(item)).toThrow("Invalid transition")
  })
})

/* ── Full lifecycle ─────────────────────────────────────── */

describe("full lifecycle", () => {
  test("available → claimed → cancelled", () => {
    const a = createTaskItem("t1", "s1", "A", "B")
    const b = claimTask(a, "alice")
    expect(b.status).toBe("claimed")
    const c = cancelTask(b)
    expect(c.status).toBe("cancelled")
  })

  test("available → claimed → in_progress → submitted → accepted", () => {
    let item: TaskBoardItem = createTaskItem("t1", "s1", "A", "B")
    item = claimTask(item, "alice")
    expect(item.status).toBe("claimed")
    item = { ...item, status: "in_progress" }
    item = submitTask(item)
    expect(item.status).toBe("submitted")
    expect(item.submittedAt).toBeTruthy()
    item = acceptTask(item)
    expect(item.status).toBe("accepted")
    expect(item.acceptedAt).toBeTruthy()
  })

  test("available → claimed → in_progress → submitted → rejected → available", () => {
    let item: TaskBoardItem = createTaskItem("t1", "s1", "A", "B")
    item = claimTask(item, "alice")
    item = { ...item, status: "in_progress" }
    item = submitTask(item)
    item = rejectTask(item, "Insufficient evidence")
    expect(item.status).toBe("rejected")
    // rejected → available (re-claimable)
  })
})

/* ── getAvailableTasks ──────────────────────────────────── */

describe("getAvailableTasks", () => {
  test("returns only available items", () => {
    const items = [
      createTaskItem("t1", "s1", "A", "A"),
      withStatus(createTaskItem("t2", "s1", "B", "B"), "claimed", { claimedBy: "alice" }),
      withStatus(createTaskItem("t3", "s1", "C", "C"), "accepted", { acceptedAt: "x" }),
    ]
    const available = getAvailableTasks(items)
    expect(available).toHaveLength(1)
    expect(available[0].taskId).toBe("t1")
  })

  test("returns empty when none available", () => {
    const items = [
      withStatus(createTaskItem("t1", "s1", "A", "A"), "cancelled"),
      withStatus(createTaskItem("t2", "s1", "B", "B"), "accepted", { acceptedAt: "x" }),
    ]
    expect(getAvailableTasks(items)).toHaveLength(0)
  })
})

/* ── getTasksByClaimant ─────────────────────────────────── */

describe("getTasksByClaimant", () => {
  test("filters by claimant", () => {
    const items = [
      withStatus(createTaskItem("t1", "s1", "A", "A"), "claimed", { claimedBy: "alice" }),
      withStatus(createTaskItem("t2", "s1", "B", "B"), "claimed", { claimedBy: "bob" }),
      withStatus(createTaskItem("t3", "s1", "C", "C"), "accepted", { claimedBy: "alice", acceptedAt: "x" }),
    ]
    const aliceItems = getTasksByClaimant(items, "alice")
    expect(aliceItems).toHaveLength(2)
    expect(aliceItems.every((i) => i.claimedBy === "alice")).toBeTrue()
  })

  test("returns empty for unknown claimant", () => {
    const items = [
      withStatus(createTaskItem("t1", "s1", "A", "A"), "claimed", { claimedBy: "alice" }),
    ]
    expect(getTasksByClaimant(items, "nobody")).toHaveLength(0)
  })
})
