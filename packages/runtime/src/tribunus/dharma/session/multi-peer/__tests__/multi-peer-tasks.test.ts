/**
 * Tests for Dharma Multi-Peer Task Lifecycle State Machine
 */

import { describe, it, expect } from "bun:test"
import type { DharmaTaskContract, TaskKind, TaskParallelism } from "../multi-peer-types"
import {
  VALID_TASK_TRANSITIONS,
  applyTaskAction,
  createTask,
  isTaskClaimable,
  isTaskCompleted,
} from "../multi-peer-tasks"
import type { ExtendedTaskStatus, TaskAction, CreateTaskConfig } from "../multi-peer-tasks"

function makeDefaultConfig(overrides?: Partial<CreateTaskConfig>): CreateTaskConfig {
  return {
    sessionId: "session-001",
    createdBy: "pk-alice",
    title: "Fix login bug",
    taskKind: "bug_fix" as TaskKind,
    sourceBasisDigest: "abc123def456",
    ...overrides,
  }
}

// ── VALID_TASK_TRANSITIONS ──────────────────────────────────────────────────

describe("VALID_TASK_TRANSITIONS", () => {
  it("draft transitions to published only", () => {
    expect(VALID_TASK_TRANSITIONS["draft"]).toEqual(["published"])
  })

  it("published transitions to available", () => {
    expect(VALID_TASK_TRANSITIONS["published"]).toEqual(["available"])
  })

  it("available transitions to claimed or cancelled", () => {
    expect(VALID_TASK_TRANSITIONS["available"]).toEqual(["claimed", "cancelled"])
  })

  it("claimed transitions to in_progress, released, or expired", () => {
    expect(VALID_TASK_TRANSITIONS["claimed"]).toEqual(["in_progress", "released", "expired"])
  })

  it("in_progress transitions to result_submitted", () => {
    expect(VALID_TASK_TRANSITIONS["in_progress"]).toEqual(["result_submitted"])
  })

  it("result_submitted transitions to accepted, rejected, or conflicted", () => {
    expect(VALID_TASK_TRANSITIONS["result_submitted"]).toEqual(["accepted", "rejected", "conflicted"])
  })

  it("accepted transitions to completed", () => {
    expect(VALID_TASK_TRANSITIONS["accepted"]).toEqual(["completed"])
  })

  it("completed is terminal", () => {
    expect(VALID_TASK_TRANSITIONS["completed"]).toEqual([])
  })

  it("cancelled is terminal", () => {
    expect(VALID_TASK_TRANSITIONS["cancelled"]).toEqual([])
  })

  it("conflicted transitions to rebase_requested, resolved, rejected, or superseded", () => {
    expect(VALID_TASK_TRANSITIONS["conflicted"]).toEqual([
      "rebase_requested", "resolved", "rejected", "superseded",
    ])
  })

  it("released, expired, resolved, rejected, rebase_requested, superseded are terminal", () => {
    for (const s of ["released", "expired", "resolved", "rejected", "rebase_requested", "superseded"]) {
      expect(VALID_TASK_TRANSITIONS[s]).toEqual([])
    }
  })
})

// ── applyTaskAction ──────────────────────────────────────────────────────────

describe("applyTaskAction", () => {
  it("draft -> publish -> published", () => {
    expect(applyTaskAction("draft", "publish")).toBe("published")
  })

  it("published -> make_available -> available", () => {
    expect(applyTaskAction("published", "make_available")).toBe("available")
  })

  it("available -> claim -> claimed", () => {
    expect(applyTaskAction("available", "claim")).toBe("claimed")
  })

  it("available -> cancel -> cancelled", () => {
    expect(applyTaskAction("available", "cancel")).toBe("cancelled")
  })

  it("claimed -> start -> in_progress", () => {
    expect(applyTaskAction("claimed", "start")).toBe("in_progress")
  })

  it("claimed -> release -> released", () => {
    expect(applyTaskAction("claimed", "release")).toBe("released")
  })

  it("claimed -> expire -> expired", () => {
    expect(applyTaskAction("claimed", "expire")).toBe("expired")
  })

  it("in_progress -> submit_result -> result_submitted", () => {
    expect(applyTaskAction("in_progress", "submit_result")).toBe("result_submitted")
  })

  it("result_submitted -> accept -> accepted", () => {
    expect(applyTaskAction("result_submitted", "accept")).toBe("accepted")
  })

  it("result_submitted -> reject -> rejected", () => {
    expect(applyTaskAction("result_submitted", "reject")).toBe("rejected")
  })

  it("result_submitted -> conflict -> conflicted", () => {
    expect(applyTaskAction("result_submitted", "conflict")).toBe("conflicted")
  })

  it("accepted -> complete -> completed", () => {
    expect(applyTaskAction("accepted", "complete")).toBe("completed")
  })

  it("conflicted -> rebase -> rebase_requested", () => {
    expect(applyTaskAction("conflicted", "rebase")).toBe("rebase_requested")
  })

  it("conflicted -> resolve -> resolved", () => {
    expect(applyTaskAction("conflicted", "resolve")).toBe("resolved")
  })

  it("conflicted -> supersede -> superseded", () => {
    expect(applyTaskAction("conflicted", "supersede")).toBe("superseded")
  })

  it("conflicted -> reject -> rejected", () => {
    expect(applyTaskAction("conflicted", "reject")).toBe("rejected")
  })

  it("throws for invalid transition", () => {
    expect(() => applyTaskAction("draft", "cancel")).toThrow()
    expect(() => applyTaskAction("completed", "publish")).toThrow()
    expect(() => applyTaskAction("cancelled", "claim")).toThrow()
    expect(() => applyTaskAction("published", "claim")).toThrow()
  })

  it("throws for unknown transition target", () => {
    expect(() => applyTaskAction("draft", "complete")).toThrow()
  })

  it("traverses full happy-path lifecycle", () => {
    let state: ExtendedTaskStatus = "draft"
    state = applyTaskAction(state, "publish")
    state = applyTaskAction(state, "make_available")
    state = applyTaskAction(state, "claim")
    state = applyTaskAction(state, "start")
    state = applyTaskAction(state, "submit_result")
    state = applyTaskAction(state, "accept")
    state = applyTaskAction(state, "complete")
    expect(state).toBe("completed")
  })

  it("traverses cancelled path", () => {
    let state: ExtendedTaskStatus = "draft"
    state = applyTaskAction(state, "publish")
    state = applyTaskAction(state, "make_available")
    state = applyTaskAction(state, "cancel")
    expect(state).toBe("cancelled")
  })

  it("traverses rejected path", () => {
    let state: ExtendedTaskStatus = "draft"
    state = applyTaskAction(state, "publish")
    state = applyTaskAction(state, "make_available")
    state = applyTaskAction(state, "claim")
    state = applyTaskAction(state, "start")
    state = applyTaskAction(state, "submit_result")
    state = applyTaskAction(state, "reject")
    expect(state).toBe("rejected")
  })

  it("traverses conflicted -> resolved path", () => {
    let state: ExtendedTaskStatus = "draft"
    state = applyTaskAction(state, "publish")
    state = applyTaskAction(state, "make_available")
    state = applyTaskAction(state, "claim")
    state = applyTaskAction(state, "start")
    state = applyTaskAction(state, "submit_result")
    state = applyTaskAction(state, "conflict")
    expect(state).toBe("conflicted")
    state = applyTaskAction(state, "resolve")
    expect(state).toBe("resolved")
  })

  it("traverses release path", () => {
    let state: ExtendedTaskStatus = "draft"
    state = applyTaskAction(state, "publish")
    state = applyTaskAction(state, "make_available")
    state = applyTaskAction(state, "claim")
    state = applyTaskAction(state, "release")
    expect(state).toBe("released")
  })

  it("traverses release and expire paths", () => {
    let state: ExtendedTaskStatus = "released"
    expect(() => applyTaskAction(state, "publish")).toThrow()
    expect(() => applyTaskAction(state, "expire")).toThrow()
  })

  it("traverses expire path", () => {
    let state: ExtendedTaskStatus = "draft"
    state = applyTaskAction(state, "publish")
    state = applyTaskAction(state, "make_available")
    state = applyTaskAction(state, "claim")
    state = applyTaskAction(state, "expire")
    expect(state).toBe("expired")
  })
})


// ── createTask ─────────────────────────────────────────────────────────────

describe("createTask", () => {
  it("creates a draft task with defaults", () => {
    const task = createTask(makeDefaultConfig())
    expect(task.taskId).toBeDefined()
    expect(task.sessionId).toBe("session-001")
    expect(task.createdByIdentityPublicKey).toBe("pk-alice")
    expect(task.title).toBe("Fix login bug")
    expect(task.taskKind).toBe("bug_fix")
    expect(task.sourceBasisDigest).toBe("abc123def456")
    expect(task.status).toBe("draft")
    expect(task.parallelism).toBe("exclusive")
    expect(task.allowedPathScopes).toEqual([])
    expect(task.deniedPathScopes).toEqual([])
    expect(task.acceptancePolicy).toBe("attested")
    expect(task.maxContributors).toBe(1)
    expect(task.maxResultBundles).toBe(10)
    expect(task.createdAt).toBeDefined()
    expect(task.updatedAt).toBe(task.createdAt)
  })

  it("uses provided parallelism and path scopes", () => {
    const task = createTask(makeDefaultConfig({
      parallelism: "parallel_competing" as TaskParallelism,
      allowedPathScopes: ["src/", "tests/"],
    }))
    expect(task.parallelism).toBe("parallel_competing")
    expect(task.allowedPathScopes).toEqual(["src/", "tests/"])
    expect(task.maxContributors).toBe(3)
  })

  it("generates unique taskIds", () => {
    const a = createTask(makeDefaultConfig())
    const b = createTask(makeDefaultConfig())
    expect(a.taskId).not.toBe(b.taskId)
  })

  it("sets maxContributors=1 for exclusive tasks", () => {
    const task = createTask(makeDefaultConfig({ parallelism: "exclusive" as TaskParallelism }))
    expect(task.maxContributors).toBe(1)
  })

  it("sets maxContributors=3 for parallel tasks", () => {
    const task = createTask(makeDefaultConfig({ parallelism: "parallel_non_overlapping" as TaskParallelism }))
    expect(task.maxContributors).toBe(3)
  })
})

// ── isTaskClaimable ────────────────────────────────────────────────────────

describe("isTaskClaimable", () => {
  it("returns true for available task", () => {
    const task = { ...createTask(makeDefaultConfig()), status: "available" as const }
    expect(isTaskClaimable(task)).toBe(true)
  })

  it("returns false for non-available task", () => {
    const statuses: ExtendedTaskStatus[] = [
      "draft", "published", "claimed", "in_progress", "result_submitted",
      "accepted", "completed", "cancelled", "conflicted",
    ]
    for (const status of statuses) {
      const task = { ...createTask(makeDefaultConfig()), status } as DharmaTaskContract
      expect(isTaskClaimable(task)).toBe(false)
    }
  })

  it("returns false for available task with maxContributors=0", () => {
    const task: DharmaTaskContract = {
      ...createTask(makeDefaultConfig()),
      status: "available",
      maxContributors: 0,
    }
    expect(isTaskClaimable(task)).toBe(false)
  })
})

// ── isTaskCompleted ────────────────────────────────────────────────────────

describe("isTaskCompleted", () => {
  it("returns true for completed", () => {
    const task = { ...createTask(makeDefaultConfig()), status: "completed" as const }
    expect(isTaskCompleted(task)).toBe(true)
  })

  it("returns true for cancelled", () => {
    const task = { ...createTask(makeDefaultConfig()), status: "cancelled" as const }
    expect(isTaskCompleted(task)).toBe(true)
  })

  it("returns false for non-terminal states", () => {
    for (const status of ["draft", "published", "available", "claimed", "in_progress", "result_submitted", "accepted"] as const) {
      const task = { ...createTask(makeDefaultConfig()), status }
      expect(isTaskCompleted(task)).toBe(false)
    }
  })
})
