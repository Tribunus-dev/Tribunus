/**
 * Prism KV Handoff Protocol Simulation — State Machine & Module Tests
 */

import { describe, it, expect } from "bun:test"
import {
  VALID_HANDOFF_TRANSITIONS,
  applyHandoffAction,
  isTerminalHandoffState,
  isFailedState,
  canCancel,
} from "../handoff-state-machine"
import {
  createHandoffRequest,
  isRequestExpired,
  getDeadline,
} from "../handoff-request"
import {
  authorizeHandoff,
  validateHandoffMode,
  checkLeaseAllowsHandoff,
} from "../handoff-authorization"
import {
  canCancelRequest,
  getCancellationEffect,
  classifyCancellation,
} from "../handoff-cancellation"
import type { HandoffState, HandoffAction } from "../handoff-types"

// ── State Machine ───────────────────────────────────────────────────────────

const NON_TERMINAL_STATES: HandoffState[] = [
  "draft",
  "requested",
  "source_validating",
  "destination_validating",
  "export_preparing",
  "exported",
  "transferring",
  "importing",
  "destination_validated",
  "committed",
  "source_disposition_pending",
  "rollback_required",
]

const TERMINAL_STATES: HandoffState[] = [
  "completed",
  "degraded_completed",
  "rejected",
  "cancelled",
  "timeout",
  "expired",
  "failed",
  "rolled_back",
]

const ALL_STATES: HandoffState[] = [...NON_TERMINAL_STATES, ...TERMINAL_STATES]

const CANCELLABLE_STATES: HandoffState[] = [
  "export_preparing",
  "exported",
  "transferring",
  "importing",
  "rollback_required",
]

describe("VALID_HANDOFF_TRANSITIONS", () => {
  // ── Active transitions ──────────────────────────────────────────────────

  it("draft → requested", () => {
    expect(VALID_HANDOFF_TRANSITIONS.draft).toEqual(["requested"])
  })

  it("requested → source_validating | rejected | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.requested).toContain("source_validating")
    expect(VALID_HANDOFF_TRANSITIONS.requested).toContain("rejected")
    expect(VALID_HANDOFF_TRANSITIONS.requested).toContain("failed")
  })

  it("source_validating → destination_validating | rejected | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.source_validating).toContain(
      "destination_validating",
    )
    expect(VALID_HANDOFF_TRANSITIONS.source_validating).toContain("rejected")
    expect(VALID_HANDOFF_TRANSITIONS.source_validating).toContain("failed")
  })

  it("destination_validating → export_preparing | rejected | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.destination_validating).toContain(
      "export_preparing",
    )
    expect(VALID_HANDOFF_TRANSITIONS.destination_validating).toContain(
      "rejected",
    )
    expect(VALID_HANDOFF_TRANSITIONS.destination_validating).toContain("failed")
  })

  it("export_preparing → exported | cancelled | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.export_preparing).toContain("exported")
    expect(VALID_HANDOFF_TRANSITIONS.export_preparing).toContain("cancelled")
    expect(VALID_HANDOFF_TRANSITIONS.export_preparing).toContain("failed")
  })

  it("exported → transferring | cancelled | expired | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.exported).toContain("transferring")
    expect(VALID_HANDOFF_TRANSITIONS.exported).toContain("cancelled")
    expect(VALID_HANDOFF_TRANSITIONS.exported).toContain("expired")
    expect(VALID_HANDOFF_TRANSITIONS.exported).toContain("failed")
  })

  it("transferring → importing | cancelled | timeout | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.transferring).toContain("importing")
    expect(VALID_HANDOFF_TRANSITIONS.transferring).toContain("cancelled")
    expect(VALID_HANDOFF_TRANSITIONS.transferring).toContain("timeout")
    expect(VALID_HANDOFF_TRANSITIONS.transferring).toContain("failed")
  })

  it("importing → destination_validated | cancelled | timeout | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.importing).toContain(
      "destination_validated",
    )
    expect(VALID_HANDOFF_TRANSITIONS.importing).toContain("cancelled")
    expect(VALID_HANDOFF_TRANSITIONS.importing).toContain("timeout")
    expect(VALID_HANDOFF_TRANSITIONS.importing).toContain("failed")
  })

  it("destination_validated → committed | rollback_required", () => {
    expect(VALID_HANDOFF_TRANSITIONS.destination_validated).toContain(
      "committed",
    )
    expect(VALID_HANDOFF_TRANSITIONS.destination_validated).toContain(
      "rollback_required",
    )
  })

  it("committed → source_disposition_pending | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.committed).toContain(
      "source_disposition_pending",
    )
    expect(VALID_HANDOFF_TRANSITIONS.committed).toContain("failed")
  })

  it("source_disposition_pending → completed | degraded_completed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.source_disposition_pending).toContain(
      "completed",
    )
    expect(
      VALID_HANDOFF_TRANSITIONS.source_disposition_pending,
    ).toContain("degraded_completed")
  })

  it("rollback_required → rolled_back | cancelled | failed", () => {
    expect(VALID_HANDOFF_TRANSITIONS.rollback_required).toContain("rolled_back")
    expect(VALID_HANDOFF_TRANSITIONS.rollback_required).toContain("cancelled")
    expect(VALID_HANDOFF_TRANSITIONS.rollback_required).toContain("failed")
  })

  // ── Terminal state immutability ─────────────────────────────────────────

  it.each(TERMINAL_STATES)("terminal state %s has no outgoing transitions", (s) => {
    expect(VALID_HANDOFF_TRANSITIONS[s]).toEqual([])
  })

  // ── Structural invariants ───────────────────────────────────────────────

  it("every state in the union has a transition entry", () => {
    for (const s of ALL_STATES) {
      expect(VALID_HANDOFF_TRANSITIONS).toHaveProperty(s)
    }
  })

  it("every referenced target is a valid HandoffState", () => {
    const stateSet = new Set(ALL_STATES)
    for (const [, targets] of Object.entries(VALID_HANDOFF_TRANSITIONS)) {
      for (const t of targets as HandoffState[]) {
        expect(stateSet.has(t)).toBe(true)
      }
    }
  })
})

describe("applyHandoffAction", () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  it("draft + request → requested", () => {
    expect(applyHandoffAction("draft", "request")).toBe("requested")
  })

  it("requested + validate_source → source_validating", () => {
    expect(
      applyHandoffAction("requested", "validate_source"),
    ).toBe("source_validating")
  })

  it("source_validating + validate_destination → destination_validating", () => {
    expect(
      applyHandoffAction("source_validating", "validate_destination"),
    ).toBe("destination_validating")
  })

  it("destination_validating + prepare_export → export_preparing", () => {
    expect(
      applyHandoffAction("destination_validating", "prepare_export"),
    ).toBe("export_preparing")
  })

  it("export_preparing + export → exported", () => {
    expect(applyHandoffAction("export_preparing", "export")).toBe("exported")
  })

  it("exported + transfer → transferring", () => {
    expect(applyHandoffAction("exported", "transfer")).toBe("transferring")
  })

  it("transferring + import → importing", () => {
    expect(applyHandoffAction("transferring", "import")).toBe("importing")
  })

  it("importing + validate_destination_import → destination_validated", () => {
    expect(
      applyHandoffAction("importing", "validate_destination_import"),
    ).toBe("destination_validated")
  })

  it("destination_validated + commit → committed", () => {
    expect(
      applyHandoffAction("destination_validated", "commit"),
    ).toBe("committed")
  })

  it("committed + dispose_source → source_disposition_pending", () => {
    expect(
      applyHandoffAction("committed", "dispose_source"),
    ).toBe("source_disposition_pending")
  })

  it("source_disposition_pending + complete → completed", () => {
    expect(
      applyHandoffAction("source_disposition_pending", "complete"),
    ).toBe("completed")
  })

  // ── Branching: reject ───────────────────────────────────────────────────

  it.each(["requested", "source_validating", "destination_validating"] as HandoffState[])(
    "%s + reject → rejected",
    (s) => {
      expect(applyHandoffAction(s, "reject")).toBe("rejected")
    },
  )

  // ── Branching: cancel ──────────────────────────────────────────────────

  it.each(CANCELLABLE_STATES)("%s + cancel → cancelled", (s) => {
    expect(applyHandoffAction(s, "cancel")).toBe("cancelled")
  })

  // ── Branching: expire ───────────────────────────────────────────────────

  it("exported + expire → expired", () => {
    expect(applyHandoffAction("exported", "expire")).toBe("expired")
  })

  // ── Branching: timeout ──────────────────────────────────────────────────

  it.each(["transferring", "importing"] as HandoffState[])(
    "%s + timeout → timeout",
    (s) => {
      expect(applyHandoffAction(s, "timeout")).toBe("timeout")
    },
  )

  // ── Branching: fail ─────────────────────────────────────────────────────

  it("requested + fail → failed", () => {
    expect(applyHandoffAction("requested", "fail")).toBe("failed")
  })

  it("source_validating + fail → failed", () => {
    expect(applyHandoffAction("source_validating", "fail")).toBe("failed")
  })

  it("destination_validating + fail → failed", () => {
    expect(applyHandoffAction("destination_validating", "fail")).toBe("failed")
  })

  it("export_preparing + fail → failed", () => {
    expect(applyHandoffAction("export_preparing", "fail")).toBe("failed")
  })

  // ── Branching: rollback ─────────────────────────────────────────────────

  it("destination_validated + rollback → rollback_required", () => {
    expect(
      applyHandoffAction("destination_validated", "rollback"),
    ).toBe("rollback_required")
  })

  it("rollback_required + rollback → rolled_back", () => {
    expect(
      applyHandoffAction("rollback_required", "rollback"),
    ).toBe("rolled_back")
  })

  // ── Invalid transitions ─────────────────────────────────────────────────

  const INVALID_PAIRS: [HandoffState, HandoffAction][] = [
    ["draft", "transfer"],
    ["draft", "cancel"],
    ["requested", "commit"],
    ["source_validating", "request"],
    ["destination_validating", "export"],
    ["export_preparing", "validate_source"],
    ["exported", "prepare_export"],
    ["transferring", "complete"],
    ["importing", "export"],
    ["destination_validated", "validate_source"],
    ["committed", "rollback"],
    ["source_disposition_pending", "commit"],
    ["completed", "request"],
    ["rejected", "request"],
    ["cancelled", "request"],
    ["timeout", "request"],
    ["expired", "request"],
    ["failed", "request"],
    ["rolled_back", "request"],
    ["degraded_completed", "request"],
    ["draft", "reject"],
    ["draft", "fail"],
    ["completed", "cancel"],
    ["rejected", "cancel"],
  ]

  it.each(INVALID_PAIRS)(
    "throws for invalid (%s, %s)",
    (state, action) => {
      expect(() => applyHandoffAction(state, action)).toThrow("Invalid transition")
    },
  )
})

describe("isTerminalHandoffState", () => {
  it.each(TERMINAL_STATES)("returns true for %s", (s) => {
    expect(isTerminalHandoffState(s)).toBe(true)
  })

  it.each(NON_TERMINAL_STATES)("returns false for %s", (s) => {
    expect(isTerminalHandoffState(s)).toBe(false)
  })
})

describe("isFailedState", () => {
  const FAILED_TERMINAL: HandoffState[] = [
    "rejected",
    "cancelled",
    "timeout",
    "expired",
    "failed",
    "rolled_back",
  ]
  const SUCCESS_TERMINAL: HandoffState[] = ["completed", "degraded_completed"]

  it.each(FAILED_TERMINAL)("returns true for %s", (s) => {
    expect(isFailedState(s)).toBe(true)
  })

  it.each(SUCCESS_TERMINAL)("returns false for %s", (s) => {
    expect(isFailedState(s)).toBe(false)
  })

  it.each(NON_TERMINAL_STATES)("returns false for non-terminal %s", (s) => {
    expect(isFailedState(s)).toBe(false)
  })
})

describe("canCancel / canCancelRequest", () => {
  it.each(CANCELLABLE_STATES)("returns true for %s", (s) => {
    expect(canCancel(s)).toBe(true)
    expect(canCancelRequest(s)).toBe(true)
  })

  it.each(
    ALL_STATES.filter((s) => !CANCELLABLE_STATES.includes(s)),
  )("returns false for %s", (s) => {
    expect(canCancel(s)).toBe(false)
    expect(canCancelRequest(s)).toBe(false)
  })
})

// ── handoff-request ─────────────────────────────────────────────────────────

describe("createHandoffRequest", () => {
  it("fills all fields with sensible defaults", () => {
    const req = createHandoffRequest({
      routeId: "route-1",
      requestId: "req-1",
      executionId: "exec-1",
      sourceWorkerId: "src-wkr-1",
      sourceInstanceId: "src-inst-1",
      destWorkerId: "dst-wkr-1",
      destInstanceId: "dst-inst-1",
      sourceNsId: "ns-1",
      modelDigest: "md5-a",
      tokenizerDigest: "tok-b",
    })

    expect(req.routeId).toBe("route-1")
    expect(req.requestId).toBe("req-1")
    expect(req.executionId).toBe("exec-1")
    expect(req.sourceWorkerId).toBe("src-wkr-1")
    expect(req.sourceWorkerInstanceId).toBe("src-inst-1")
    expect(req.destinationWorkerId).toBe("dst-wkr-1")
    expect(req.destinationWorkerInstanceId).toBe("dst-inst-1")
    expect(req.sourceKvNamespaceId).toBe("ns-1")
    expect(req.modelArtifactDigest).toBe("md5-a")
    expect(req.tokenizerDigest).toBe("tok-b")
    expect(req.requestedBy).toBe("src-wkr-1")
    expect(req.handoffMode).toBe("simulation_only")
    expect(req.sourceRetentionPolicy).toBe("retain_until_destination_commit")
    expect(req.handoffId).toBeTruthy()
    expect(req.createdAt).toBeTruthy()
    expect(req.requestedDeadlineAt).toBeTruthy()
    expect(req.signature).toBeNull()
    expect(req.sessionId).toBeNull()
    expect(req.dharmaLeaseId).toBeNull()

    // handoffId must be a UUID
    expect(req.handoffId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it("requestedBy defaults to sourceWorkerId", () => {
    const req = createHandoffRequest({
      routeId: "r",
      requestId: "q",
      executionId: "e",
      sourceWorkerId: "src-wkr",
      sourceInstanceId: "si",
      destWorkerId: "dst-wkr",
      destInstanceId: "di",
      sourceNsId: "ns",
      modelDigest: "md",
      tokenizerDigest: "tk",
    })
    expect(req.requestedBy).toBe("src-wkr")
  })
})

describe("isRequestExpired", () => {
  it("returns false for a freshly-created request", () => {
    const req = createHandoffRequest({
      routeId: "r",
      requestId: "q",
      executionId: "e",
      sourceWorkerId: "src-wkr",
      sourceInstanceId: "si",
      destWorkerId: "dst-wkr",
      destInstanceId: "di",
      sourceNsId: "ns",
      modelDigest: "md",
      tokenizerDigest: "tk",
    })
    expect(isRequestExpired(req)).toBe(false)
  })

  it("returns true for a request with a past deadline", () => {
    const req = createHandoffRequest({
      routeId: "r",
      requestId: "q",
      executionId: "e",
      sourceWorkerId: "src-wkr",
      sourceInstanceId: "si",
      destWorkerId: "dst-wkr",
      destInstanceId: "di",
      sourceNsId: "ns",
      modelDigest: "md",
      tokenizerDigest: "tk",
    })
    // Manually set deadline in the past
    const past = new Date(Date.now() - 60_000).toISOString()
    ;(req as unknown as Record<string, string | number | boolean | null>).requestedDeadlineAt = past
    expect(isRequestExpired(req)).toBe(true)
  })
})

describe("getDeadline", () => {
  it("returns the requestedDeadlineAt value", () => {
    const req = createHandoffRequest({
      routeId: "r",
      requestId: "q",
      executionId: "e",
      sourceWorkerId: "src-wkr",
      sourceInstanceId: "si",
      destWorkerId: "dst-wkr",
      destInstanceId: "di",
      sourceNsId: "ns",
      modelDigest: "md",
      tokenizerDigest: "tk",
    })
    expect(getDeadline(req)).toBe(req.requestedDeadlineAt)
  })
})

// ── handoff-authorization ───────────────────────────────────────────────────

describe("authorizeHandoff", () => {
  const req = createHandoffRequest({
    routeId: "r",
    requestId: "q",
    executionId: "e",
    sourceWorkerId: "wkr-1",
    sourceInstanceId: "si",
    destWorkerId: "wkr-2",
    destInstanceId: "di",
    sourceNsId: "ns",
    modelDigest: "md",
    tokenizerDigest: "tk",
  })

  it("allows when requester is in the allowed list", () => {
    const result = authorizeHandoff(req, ["wkr-1", "wkr-3"])
    expect(result.authorized).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("denies when requester is not in the allowed list", () => {
    const result = authorizeHandoff(req, ["wkr-2", "wkr-3"])
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain("wkr-1")
    expect(result.reason).toContain("allowed")
  })

  it("denies on empty allowed list", () => {
    const result = authorizeHandoff(req, [])
    expect(result.authorized).toBe(false)
    expect(result.reason).toBeTruthy()
  })
})

describe("validateHandoffMode", () => {
  it("accepts simulation_only when simulation is enabled", () => {
    const result = validateHandoffMode("simulation_only", true)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("rejects simulation_only when simulation is disabled", () => {
    const result = validateHandoffMode("simulation_only", false)
    expect(result.valid).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it("rejects future_transport_required always", () => {
    const result = validateHandoffMode("future_transport_required", true)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("future_transport_required")
  })
})

describe("checkLeaseAllowsHandoff", () => {
  it("returns true when lease allows regardless of mode", () => {
    expect(checkLeaseAllowsHandoff(true, "simulation_only")).toBe(true)
    expect(checkLeaseAllowsHandoff(true, "future_transport_required")).toBe(true)
  })

  it("returns true for simulation_only even when lease does not allow", () => {
    expect(checkLeaseAllowsHandoff(false, "simulation_only")).toBe(true)
  })

  it("returns false when lease does not allow and mode is future_transport_required", () => {
    expect(checkLeaseAllowsHandoff(false, "future_transport_required")).toBe(
      false,
    )
  })
})

// ── handoff-cancellation ────────────────────────────────────────────────────

describe("getCancellationEffect", () => {
  it("export_preparing: retain source, noop on destination", () => {
    const effect = getCancellationEffect("export_preparing")
    expect(effect.sourceNamespaceAction).toBe("retain")
    expect(effect.destinationAction).toBe("noop")
    expect(effect.abortTransfer).toBe(false)
  })

  it("exported: retain source, discard manifest, no abort", () => {
    const effect = getCancellationEffect("exported")
    expect(effect.sourceNamespaceAction).toBe("retain")
    expect(effect.destinationAction).toBe("discard_manifest")
    expect(effect.abortTransfer).toBe(false)
  })

  it("transferring: retain source, discard manifest, abort in-flight transfer", () => {
    const effect = getCancellationEffect("transferring")
    expect(effect.sourceNamespaceAction).toBe("retain")
    expect(effect.destinationAction).toBe("discard_manifest")
    expect(effect.abortTransfer).toBe(true)
  })

  it("importing: retain source, discard import, no abort", () => {
    const effect = getCancellationEffect("importing")
    expect(effect.sourceNamespaceAction).toBe("retain")
    expect(effect.destinationAction).toBe("discard_import")
    expect(effect.abortTransfer).toBe(false)
  })

  it("rollback_required: release source, rollback destination", () => {
    const effect = getCancellationEffect("rollback_required")
    expect(effect.sourceNamespaceAction).toBe("release")
    expect(effect.destinationAction).toBe("rollback_destination")
    expect(effect.abortTransfer).toBe(false)
  })

  it("unknown state defaults to retain/noop", () => {
    const effect = getCancellationEffect("draft" as HandoffState)
    expect(effect.sourceNamespaceAction).toBe("retain")
    expect(effect.destinationAction).toBe("noop")
    expect(effect.abortTransfer).toBe(false)
  })
})

describe("classifyCancellation", () => {
  it("export_preparing → source_export_failed", () => {
    expect(classifyCancellation("export_preparing")).toBe(
      "source_export_failed",
    )
  })

  it.each(["exported", "transferring", "importing"] as HandoffState[])(
    "%s → transfer_cancelled",
    (s) => {
      expect(classifyCancellation(s)).toBe("transfer_cancelled")
    },
  )

  it.each([
    "destination_validated",
    "committed",
  ] as HandoffState[])("%s → destination_import_failed", (s) => {
    expect(classifyCancellation(s)).toBe("destination_import_failed")
  })

  it("rollback_required → destination_activation_failed", () => {
    expect(classifyCancellation("rollback_required")).toBe(
      "destination_activation_failed",
    )
  })

  it("default → request_cancelled", () => {
    expect(classifyCancellation("draft" as HandoffState)).toBe(
      "request_cancelled",
    )
  })
})
