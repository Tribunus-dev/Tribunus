/**
 * Dharma Live Sandbox — Process Revocation Tests
 *
 * Tests the ExecutionState machine for sandbox process lifecycle,
 * verifying valid and invalid state transitions.
 */

import { describe, it, expect } from "bun:test"

// ── Types (local copy for testing state machine logic) -----------------------

type ExecutionState = "pending" | "running" | "completed" | "failed" | "cancelled" | "terminated"

const VALID_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  pending: ["running", "cancelled", "failed", "terminated"],
  running: ["completed", "failed", "cancelled", "terminated"],
  completed: [],
  failed: ["running"],
  cancelled: [],
  terminated: [],
}

/**
 * Transition an execution state if valid.
 * Throws on invalid transition.
 */
function transitionExecutionState(
  current: ExecutionState,
  next: ExecutionState,
): ExecutionState {
  const allowed = VALID_TRANSITIONS[current]
  if (!allowed.includes(next)) {
    throw new Error(
      `Invalid state transition: ${current} → ${next}`,
    )
  }
  return next
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("transitionExecutionState", () => {
  it("running → completed valid", () => {
    const result = transitionExecutionState("running", "completed")
    expect(result).toBe("completed")
  })

  it("running → terminated valid (emergency)", () => {
    const result = transitionExecutionState("running", "terminated")
    expect(result).toBe("terminated")
  })

  it("completed → running invalid", () => {
    expect(() => transitionExecutionState("completed", "running")).toThrow(
      /Invalid state transition/,
    )
  })

  it("pending → running valid", () => {
    const result = transitionExecutionState("pending", "running")
    expect(result).toBe("running")
  })

  it("pending → cancelled valid", () => {
    const result = transitionExecutionState("pending", "cancelled")
    expect(result).toBe("cancelled")
  })

  it("running → failed valid", () => {
    const result = transitionExecutionState("running", "failed")
    expect(result).toBe("failed")
  })

  it("completed → pending invalid", () => {
    expect(() => transitionExecutionState("completed", "pending")).toThrow(
      /Invalid state transition/,
    )
  })

  it("cancelled → running invalid", () => {
    expect(() => transitionExecutionState("cancelled", "running")).toThrow(
      /Invalid state transition/,
    )
  })

  it("failed → running valid (retry)", () => {
    const result = transitionExecutionState("failed", "running")
    expect(result).toBe("running")
  })
})
