/**
 * Prism Phase Roles — Execution Pin Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createExecutionPin,
  applyPinAction,
  isExecutionPinActive,
  canWorkerExecutePin,
  VALID_PIN_TRANSITIONS,
} from "../execution-pin"
import { ExecutionPinError } from "../phase-role-errors"
import type { ExecutionPinState, PrismExecutionPin } from "../phase-role-types"

// ── Fixtures ----------------------------------------------------------------

function makePin(overrides?: Partial<PrismExecutionPin>): PrismExecutionPin {
  const pin = createExecutionPin("exec-001", "route-001", "req-001", "worker-a", "instance-a-1", "mdl-abc", "img-123")
  return overrides ? Object.assign(pin, overrides) : pin
}

// ── VALID_PIN_TRANSITIONS ---------------------------------------------------

describe("VALID_PIN_TRANSITIONS", () => {
  test("reserved can start prefill", () => {
    expect(VALID_PIN_TRANSITIONS.reserved).toContain("prefill_running")
  })

  test("reserved can cancel or fail", () => {
    expect(VALID_PIN_TRANSITIONS.reserved).toContain("cancelled")
    expect(VALID_PIN_TRANSITIONS.reserved).toContain("failed")
  })

  test("prefill_running transitions to prefill_completed", () => {
    expect(VALID_PIN_TRANSITIONS.prefill_running).toContain("prefill_completed")
  })

  test("prefill_completed transitions to decode_running", () => {
    expect(VALID_PIN_TRANSITIONS.prefill_completed).toContain("decode_running")
  })

  test("decode_running transitions to completed", () => {
    expect(VALID_PIN_TRANSITIONS.decode_running).toContain("completed")
  })

  test("terminal states have no outgoing transitions", () => {
    expect(VALID_PIN_TRANSITIONS.completed).toEqual([])
    expect(VALID_PIN_TRANSITIONS.cancelled).toEqual([])
    expect(VALID_PIN_TRANSITIONS.failed).toEqual([])
  })

  test("all non-terminal states can be cancelled or failed", () => {
    const nonTerminal: ExecutionPinState[] = [
      "reserved",
      "prefill_running",
      "prefill_completed",
      "decode_running",
    ]
    for (const s of nonTerminal) {
      expect(VALID_PIN_TRANSITIONS[s]).toContain("cancelled")
      expect(VALID_PIN_TRANSITIONS[s]).toContain("failed")
    }
  })
})

// ── applyPinAction ----------------------------------------------------------

describe("applyPinAction", () => {
  test("reserved → start_prefill → prefill_running", () => {
    expect(applyPinAction("reserved", "start_prefill")).toBe("prefill_running")
  })

  test("prefill_running → complete_prefill → prefill_completed", () => {
    expect(applyPinAction("prefill_running", "complete_prefill")).toBe("prefill_completed")
  })

  test("prefill_completed → start_decode → decode_running", () => {
    expect(applyPinAction("prefill_completed", "start_decode")).toBe("decode_running")
  })

  test("decode_running → complete → completed", () => {
    expect(applyPinAction("decode_running", "complete")).toBe("completed")
  })

  test("cancels from any non-terminal state", () => {
    const states: ExecutionPinState[] = [
      "reserved",
      "prefill_running",
      "prefill_completed",
      "decode_running",
    ]
    for (const s of states) {
      expect(applyPinAction(s, "cancel")).toBe("cancelled")
    }
  })

  test("fails from any non-terminal state", () => {
    const states: ExecutionPinState[] = [
      "reserved",
      "prefill_running",
      "prefill_completed",
      "decode_running",
    ]
    for (const s of states) {
      expect(applyPinAction(s, "fail")).toBe("failed")
    }
  })

  test("throws ExecutionPinError on illegal transition", () => {
    expect(() => applyPinAction("reserved", "complete")).toThrow(ExecutionPinError)
  })

  test("throws ExecutionPinError from terminal states", () => {
    for (const s of ["completed", "cancelled", "failed"] as ExecutionPinState[]) {
      expect(() => applyPinAction(s, "start_prefill")).toThrow(ExecutionPinError)
      expect(() => applyPinAction(s, "cancel")).toThrow(ExecutionPinError)
      expect(() => applyPinAction(s, "fail")).toThrow(ExecutionPinError)
    }
  })

  test("throws ExecutionPinError with descriptive message", () => {
    let threw = false
    try {
      applyPinAction("reserved", "complete")
    } catch (e) {
      threw = true
      expect(e).toBeInstanceOf(ExecutionPinError)
      if (e instanceof ExecutionPinError) {
        expect(e.message).toContain("reserved → completed")
      }
    }
    expect(threw).toBe(true)
  })
})

// ── createExecutionPin -------------------------------------------------------

describe("createExecutionPin", () => {
  test("creates a pin with initial state reserved", () => {
    const pin = createExecutionPin(
      "exec-001",
      "route-001",
      "req-001",
      "worker-a",
      "instance-a-1",
      "mdl-abc",
      "img-123",
    )
    expect(pin.executionId).toBe("exec-001")
    expect(pin.routeId).toBe("route-001")
    expect(pin.requestId).toBe("req-001")
    expect(pin.workerId).toBe("worker-a")
    expect(pin.workerInstanceId).toBe("instance-a-1")
    expect(pin.modelArtifactDigest).toBe("mdl-abc")
    expect(pin.computeImageDigest).toBe("img-123")
    expect(pin.state).toBe("reserved")
    expect(pin.kvNamespaceId).toBeNull()
    expect(pin.expiresAt).toBeNull()
    expect(pin.issuedAt).toBeDefined()
    expect(() => new Date(pin.issuedAt)).not.toThrow()
  })

  test("sets same_worker_required policy", () => {
    const pin = createExecutionPin(
      "exec-002",
      "route-002",
      "req-002",
      "worker-b",
      "instance-b-1",
      "mdl-xyz",
      "img-456",
    )
    expect(pin.phaseCoLocationPolicy).toBe("same_worker_required")
  })
})

// ── isExecutionPinActive ----------------------------------------------------

describe("isExecutionPinActive", () => {
  test("returns true for reserved", () => {
    const pin = makePin()
    pin.state = "reserved"
    expect(isExecutionPinActive(pin)).toBe(true)
  })

  test("returns true for prefill_running", () => {
    const pin = makePin()
    pin.state = "prefill_running"
    expect(isExecutionPinActive(pin)).toBe(true)
  })

  test("returns true for prefill_completed", () => {
    const pin = makePin()
    pin.state = "prefill_completed"
    expect(isExecutionPinActive(pin)).toBe(true)
  })

  test("returns true for decode_running", () => {
    const pin = makePin()
    pin.state = "decode_running"
    expect(isExecutionPinActive(pin)).toBe(true)
  })

  test("returns false for completed", () => {
    const pin = makePin()
    pin.state = "completed"
    expect(isExecutionPinActive(pin)).toBe(false)
  })

  test("returns false for cancelled", () => {
    const pin = makePin()
    pin.state = "cancelled"
    expect(isExecutionPinActive(pin)).toBe(false)
  })

  test("returns false for failed", () => {
    const pin = makePin()
    pin.state = "failed"
    expect(isExecutionPinActive(pin)).toBe(false)
  })
})

// ── canWorkerExecutePin -----------------------------------------------------

describe("canWorkerExecutePin", () => {
  test("returns true when instance matches", () => {
    const pin = createExecutionPin(
      "exec-001",
      "route-001",
      "req-001",
      "worker-a",
      "instance-a-1",
      "mdl-abc",
      "img-123",
    )
    expect(canWorkerExecutePin(pin, "instance-a-1")).toBe(true)
  })

  test("returns false when instance does not match", () => {
    const pin = createExecutionPin(
      "exec-001",
      "route-001",
      "req-001",
      "worker-a",
      "instance-a-1",
      "mdl-abc",
      "img-123",
    )
    expect(canWorkerExecutePin(pin, "instance-b-1")).toBe(false)
  })
})
