/**
 * Tests — Disaggregated route plan creation and predicates
 */

import { describe, it, expect } from "bun:test"
import {
  createSameWorkerRoutePlan,
  createSimulatedHandoffRoutePlan,
  isRoutePlanDisaggregated,
  canRouteToHandoff,
} from "../handoff-router-plan"

describe("createSameWorkerRoutePlan", () => {
  it("creates a plan with identical prefill/decode workers", () => {
    const plan = createSameWorkerRoutePlan("req-001", "worker-1")

    expect(plan.requestId).toBe("req-001")
    expect(plan.prefillWorkerId).toBe("worker-1")
    expect(plan.decodeWorkerId).toBe("worker-1")
    expect(plan.handoffRequired).toBeFalse()
    expect(plan.handoffId).toBeNull()
    expect(plan.executionPinningPolicy).toBe("same_worker_required")
    expect(plan.routeState).toBe("same_worker_pinned")
  })
})

describe("createSimulatedHandoffRoutePlan", () => {
  it("creates a plan with disaggregated workers", () => {
    const plan = createSimulatedHandoffRoutePlan(
      "req-002",
      "worker-prefill",
      "worker-decode",
      "handoff-abc",
    )

    expect(plan.requestId).toBe("req-002")
    expect(plan.prefillWorkerId).toBe("worker-prefill")
    expect(plan.decodeWorkerId).toBe("worker-decode")
    expect(plan.handoffRequired).toBeTrue()
    expect(plan.handoffId).toBe("handoff-abc")
    expect(plan.handoffMode).toBe("simulation_only")
    expect(plan.executionPinningPolicy).toBe("simulated_handoff_required")
    expect(plan.routeState).toBe("handoff_required")
    expect(plan.handoffDeadlineAt).toBeTruthy()
  })
})

describe("isRoutePlanDisaggregated", () => {
  it("returns false for same-worker plan", () => {
    const plan = createSameWorkerRoutePlan("req-001", "worker-1")
    expect(isRoutePlanDisaggregated(plan)).toBeFalse()
  })

  it("returns true for simulated handoff plan", () => {
    const plan = createSimulatedHandoffRoutePlan(
      "req-002",
      "worker-prefill",
      "worker-decode",
      "handoff-abc",
    )
    expect(isRoutePlanDisaggregated(plan)).toBeTrue()
  })
})

describe("canRouteToHandoff", () => {
  it("returns false for same-worker plan", () => {
    const plan = createSameWorkerRoutePlan("req-001", "worker-1")
    expect(canRouteToHandoff(plan)).toBeFalse()
  })

  it("returns true for simulated handoff plan", () => {
    const plan = createSimulatedHandoffRoutePlan(
      "req-002",
      "worker-prefill",
      "worker-decode",
      "handoff-abc",
    )
    expect(canRouteToHandoff(plan)).toBeTrue()
  })

  it("returns false when handoffId is null", () => {
    const plan = createSimulatedHandoffRoutePlan(
      "req-003",
      "worker-prefill",
      "worker-decode",
      "handoff-abc",
    )
    plan.handoffId = null
    expect(canRouteToHandoff(plan)).toBeFalse()
  })
})
