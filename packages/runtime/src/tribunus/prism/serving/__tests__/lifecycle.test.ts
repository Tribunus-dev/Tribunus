/**
 * Prism llm-d Worker — Lifecycle State Machine Tests
 *
 * Tests for worker and model lifecycle transitions.
 */

import { expect, test, describe } from "bun:test"
import {
  applyWorkerAction,
  applyModelAction,
  canAcceptRequests,
  VALID_WORKER_TRANSITIONS,
  VALID_MODEL_TRANSITIONS,
  VALID_HEALTH_TRANSITIONS,
} from "../worker-lifecycle"

import type { WorkerLifecycleState, ModelState } from "../worker-types"
import type { WorkerAction, ModelAction } from "../worker-lifecycle"

// ── Worker Lifecycle ──────────────────────────────────────────────────────────

describe("Worker lifecycle transitions", () => {
  test("starting → initializing → loading_model → ready → serving → draining → stopped", () => {
    let state: WorkerLifecycleState = "starting"
    expect(state).toBe("starting")

    state = applyWorkerAction(state, "initialize")
    expect(state).toBe("initializing")

    state = applyWorkerAction(state, "load")
    expect(state).toBe("loading_model")

    state = applyWorkerAction(state, "become_ready")
    expect(state).toBe("ready")

    state = applyWorkerAction(state, "serve")
    expect(state).toBe("serving")

    state = applyWorkerAction(state, "drain")
    expect(state).toBe("draining")

    state = applyWorkerAction(state, "stop")
    expect(state).toBe("stopped")
  })

  test("starting → failed", () => {
    let state: WorkerLifecycleState = "starting"
    state = applyWorkerAction(state, "fail")
    expect(state).toBe("failed")
  })

  test("initializing → failed", () => {
    let state: WorkerLifecycleState = "initializing"
    state = applyWorkerAction(state, "fail")
    expect(state).toBe("failed")
  })

  test("loading_model → failed", () => {
    let state: WorkerLifecycleState = "loading_model"
    state = applyWorkerAction(state, "fail")
    expect(state).toBe("failed")
  })

  test("serving → degraded → serving", () => {
    let state: WorkerLifecycleState = "serving"

    state = applyWorkerAction(state, "degrade")
    expect(state).toBe("degraded")

    state = applyWorkerAction(state, "recover")
    expect(state).toBe("serving")
  })

  test("degraded → draining", () => {
    let state: WorkerLifecycleState = "degraded"
    state = applyWorkerAction(state, "drain")
    expect(state).toBe("draining")
  })

  describe("Invalid transitions throw", () => {
    const invalidCases: Array<{ from: WorkerLifecycleState; action: WorkerAction }> = [
      { from: "starting", action: "serve" },
      { from: "initializing", action: "stop" },
      { from: "loading_model", action: "initialize" },
      { from: "ready", action: "fail" },
      { from: "serving", action: "become_ready" },
      { from: "degraded", action: "load" },
      { from: "draining", action: "serve" },
      { from: "stopped", action: "initialize" },
      { from: "failed", action: "recover" },
      { from: "starting", action: "stop" },
    ]

    for (const { from, action } of invalidCases) {
      test(`throws: ${from} → ${action}`, () => {
        expect(() => applyWorkerAction(from, action)).toThrow(
          `Invalid worker transition: ${from} → ${action}`,
        )
      })
    }
  })

  describe("VALID_WORKER_TRANSITIONS consistency", () => {
    test("entries are subsets of all known states", () => {
      const allStates: readonly WorkerLifecycleState[] = [
        "starting", "initializing", "loading_model", "ready",
        "serving", "degraded", "draining", "stopped", "failed",
      ]

      for (const [_k, allowed] of Object.entries(VALID_WORKER_TRANSITIONS)) {
        for (const next of allowed) {
          expect(allStates).toContain(next)
        }
      }
    })

    test("every allowed transition is reachable via some action in applyWorkerAction", () => {
      // Derived from the applyWorkerAction transition table
      const actionMap: Partial<Record<WorkerAction, Partial<Record<WorkerLifecycleState, WorkerLifecycleState>>>> = {
        initialize: { starting: "initializing" },
        load: { initializing: "loading_model" },
        become_ready: { loading_model: "ready" },
        serve: { ready: "serving" },
        degrade: { serving: "degraded" },
        recover: { degraded: "serving" },
        drain: { ready: "draining", serving: "draining", degraded: "draining" },
        stop: { draining: "stopped" },
        fail: { starting: "failed", initializing: "failed", loading_model: "failed" },
      }

      for (const [state, allowed] of Object.entries(VALID_WORKER_TRANSITIONS) as Array<[WorkerLifecycleState, readonly WorkerLifecycleState[]]>) {
        for (const next of allowed) {
          let found = false
          for (const [_act, map] of Object.entries(actionMap) as Array<[WorkerAction, Partial<Record<WorkerLifecycleState, WorkerLifecycleState>>]>) {
            if (map[state] === next) {
              found = true
              break
            }
          }
          expect(found).toBe(true)
        }
      }
    })
  })
})

// ── Model Lifecycle ───────────────────────────────────────────────────────────

describe("Model lifecycle transitions", () => {
  test("unavailable → admitted → loading → loaded → draining → unloading → unavailable", () => {
    let state: ModelState = "unavailable"
    expect(state).toBe("unavailable")

    state = applyModelAction(state, "admit")
    expect(state).toBe("admitted")

    state = applyModelAction(state, "load")
    expect(state).toBe("loading")

    state = applyModelAction(state, "load_complete")
    expect(state).toBe("loaded")

    state = applyModelAction(state, "drain")
    expect(state).toBe("draining")

    state = applyModelAction(state, "unload")
    expect(state).toBe("unloading")

    state = applyModelAction(state, "unload")
    expect(state).toBe("unavailable")
  })

  test("loaded → failed → admitted (retry)", () => {
    let state: ModelState = "loaded"

    state = applyModelAction(state, "fail")
    expect(state).toBe("failed")

    state = applyModelAction(state, "retry")
    expect(state).toBe("admitted")
  })

  test("admitted → revoked (permanent)", () => {
    const state: ModelState = applyModelAction("admitted", "revoke")
    expect(state).toBe("revoked")
  })

  test("loading → failed → admitted (retry)", () => {
    let state: ModelState = "loading"
    state = applyModelAction(state, "fail")
    expect(state).toBe("failed")

    state = applyModelAction(state, "retry")
    expect(state).toBe("admitted")
  })

  test("draining → failed → admitted (retry)", () => {
    let state: ModelState = "draining"
    state = applyModelAction(state, "fail")
    expect(state).toBe("failed")

    state = applyModelAction(state, "retry")
    expect(state).toBe("admitted")
  })

  describe("Invalid model transitions throw", () => {
    const invalidCases: Array<{ from: ModelState; action: ModelAction }> = [
      { from: "unavailable", action: "load" },
      { from: "admitted", action: "load_complete" },
      { from: "loading", action: "drain" },
      { from: "loaded", action: "retry" },
      { from: "draining", action: "load" },
      { from: "unloading", action: "retry" },
      { from: "failed", action: "admit" },
      { from: "revoked", action: "retry" },
      { from: "revoked", action: "load" },
    ]

    for (const { from, action } of invalidCases) {
      test(`throws: ${from} → ${action}`, () => {
        expect(() => applyModelAction(from, action)).toThrow(
          `Invalid model transition: ${from} → ${action}`,
        )
      })
    }
  })
})

// ── canAcceptRequests ─────────────────────────────────────────────────────────

describe("canAcceptRequests", () => {
  const acceptingStates: WorkerLifecycleState[] = ["ready", "serving", "degraded"]
  const rejectingStates: WorkerLifecycleState[] = [
    "starting",
    "initializing",
    "loading_model",
    "draining",
    "stopped",
    "failed",
  ]

  for (const state of acceptingStates) {
    test(`${state} returns true`, () => {
      expect(canAcceptRequests(state)).toBe(true)
    })
  }

  for (const state of rejectingStates) {
    test(`${state} returns false`, () => {
      expect(canAcceptRequests(state)).toBe(false)
    })
  }
})

// ── Health Transitions ────────────────────────────────────────────────────────

describe("VALID_HEALTH_TRANSITIONS", () => {
  test("healthy → degraded, draining, unhealthy", () => {
    expect(VALID_HEALTH_TRANSITIONS.healthy).toEqual(["degraded", "draining", "unhealthy"])
  })

  test("degraded → healthy, draining, unhealthy", () => {
    expect(VALID_HEALTH_TRANSITIONS.degraded).toEqual(["healthy", "draining", "unhealthy"])
  })

  test("unhealthy → healthy, draining", () => {
    expect(VALID_HEALTH_TRANSITIONS.unhealthy).toEqual(["healthy", "draining"])
  })

  test("draining → unhealthy, healthy", () => {
    expect(VALID_HEALTH_TRANSITIONS.draining).toEqual(["unhealthy", "healthy"])
  })
})
