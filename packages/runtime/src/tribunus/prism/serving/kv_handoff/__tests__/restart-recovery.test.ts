/**
 * Tests — Restart recovery: restoring handoff state after simulated restart
 */

import { describe, it, expect } from "bun:test"
import type { HandoffState } from "../handoff-types"

// ── Inline restart-recovery simulation ──────────────────────────────────────

interface HandoffCheckpoint {
  handoffId: string
  state: HandoffState
  routeId: string
  requestId: string
  sourceWorkerId: string
  destinationWorkerId: string
  checkpointedAt: string
}

interface HandoffCheckpointLog {
  entries: HandoffCheckpoint[]
}

function createCheckpoint(state: HandoffState, overrides?: Partial<HandoffCheckpoint>): HandoffCheckpoint {
  return {
    handoffId: "handoff-001",
    state,
    routeId: "route-abc",
    requestId: "req-001",
    sourceWorkerId: "worker-p-1",
    destinationWorkerId: "worker-d-2",
    checkpointedAt: new Date().toISOString(),
    ...overrides,
  }
}

// Non-terminal states can be recovered; terminal states cannot.
const terminalStates: HandoffState[] = [
  "completed", "rejected", "cancelled", "timeout", "failed",
  "rolled_back", "degraded_completed",
]

function canRecoverAfterRestart(checkpoint: HandoffCheckpoint): boolean {
  return !terminalStates.includes(checkpoint.state)
}

function determineRecoveryState(checkpoint: HandoffCheckpoint): HandoffState {
  if (canRecoverAfterRestart(checkpoint)) {
    // Map to a safe re-start state
    const terminalProximityMap: Partial<Record<HandoffState, HandoffState>> = {
      draft: "draft",
      requested: "requested",
      source_validating: "requested",
      destination_validating: "requested",
      export_preparing: "requested",
      exported: "export_preparing",
      transferring: "exported",
      importing: "export_preparing",
      destination_validated: "export_preparing",
      committed: "committed",
      source_disposition_pending: "committed",
    }
    return terminalProximityMap[checkpoint.state] ?? "draft"
  }
  return checkpoint.state
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("canRecoverAfterRestart", () => {
  it("returns true for in-flight states", () => {
    for (const state of ["draft", "requested", "exported", "transferring", "importing"] as HandoffState[]) {
      const cp = createCheckpoint(state)
      expect(canRecoverAfterRestart(cp)).toBeTrue()
    }
  })

  it("returns false for terminal states", () => {
    for (const state of terminalStates) {
      const cp = createCheckpoint(state)
      expect(canRecoverAfterRestart(cp)).toBeFalse()
    }
  })
})

describe("determineRecoveryState", () => {
  it("maps draft to draft", () => {
    expect(determineRecoveryState(createCheckpoint("draft"))).toBe("draft")
  })

  it("maps source_validating to requested", () => {
    expect(determineRecoveryState(createCheckpoint("source_validating"))).toBe("requested")
  })

  it("maps exported to export_preparing", () => {
    expect(determineRecoveryState(createCheckpoint("exported"))).toBe("export_preparing")
  })

  it("maps transferring to exported", () => {
    expect(determineRecoveryState(createCheckpoint("transferring"))).toBe("exported")
  })

  it("maps importing to export_preparing", () => {
    expect(determineRecoveryState(createCheckpoint("importing"))).toBe("export_preparing")
  })

  it("returns terminal state unchanged", () => {
    for (const state of terminalStates) {
      expect(determineRecoveryState(createCheckpoint(state))).toBe(state)
    }
  })
})

describe("checkpoint life-cycle", () => {
  it("produces a meaningful checkpoint", () => {
    const cp = createCheckpoint("exported")
    expect(cp.handoffId).toBe("handoff-001")
    expect(cp.state).toBe("exported")
    expect(cp.checkpointedAt).toBeTruthy()
  })

  it("overrides default fields", () => {
    const cp = createCheckpoint("committed", { handoffId: "handoff-xyz" })
    expect(cp.handoffId).toBe("handoff-xyz")
    expect(cp.state).toBe("committed")
  })
})
