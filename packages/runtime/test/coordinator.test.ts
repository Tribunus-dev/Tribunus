import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { it } from "./lib/effect"
import { Coordinator, createCoordinatorLayer, CoordinatorService } from "../src/coordinator"

describe("Coordinator", () => {
  // ── Initialization ───────────────────────────────────────────
  
  it.effect("initializes with valid config", () =>
    Effect.gen(function* () {
      const coordinator = new Coordinator({ maxSessions: 5 })
      // Use any internal method to verify it's working
      const session = yield* coordinator.createSession("test-1")
      expect(session.id).toBe("test-1")
    })
  )

  it.effect("fails initialization with invalid config", () =>
    Effect.gen(function* () {
      expect(() => new Coordinator({ maxSessions: 0 })).toThrow("Invalid configuration: maxSessions must be greater than 0")
      expect(() => new Coordinator({ maxSessions: -1 })).toThrow("Invalid configuration")
    })
  )

  // ── Session Lifecycle ────────────────────────────────────────

  it.effect("creates and retrieves a session", () =>
    Effect.gen(function* () {
      const coordinator = new Coordinator()
      
      const created = yield* coordinator.createSession("sess-1")
      expect(created.id).toBe("sess-1")
      expect(created.status).toBe("running")
      
      const retrieved = yield* coordinator.getSession("sess-1")
      expect(retrieved.id).toBe("sess-1")
    })
  )

  it.effect("enforces max sessions limit", () =>
    Effect.gen(function* () {
      const coordinator = new Coordinator({ maxSessions: 2 })
      
      yield* coordinator.createSession("sess-1")
      yield* coordinator.createSession("sess-2")
      
      const result = yield* Effect.flip(coordinator.createSession("sess-3"))
      expect(result.message).toBe("Max sessions reached")
    })
  )

  it.effect("prevents duplicate sessions", () =>
    Effect.gen(function* () {
      const coordinator = new Coordinator()
      
      yield* coordinator.createSession("sess-1")
      
      const result = yield* Effect.flip(coordinator.createSession("sess-1"))
      expect(result.message).toBe("Session sess-1 already exists")
    })
  )

  it.effect("fails to get non-existent session", () =>
    Effect.gen(function* () {
      const coordinator = new Coordinator()
      
      const result = yield* Effect.flip(coordinator.getSession("missing"))
      expect(result instanceof Error).toBe(true)
    })
  )

  // ── Work Dispatch ────────────────────────────────────────────

  it.effect("dispatches work to an active session", () =>
    Effect.gen(function* () {
      const coordinator = new Coordinator()
      yield* coordinator.createSession("sess-1")
      
      const workItem = {
        id: "work-1",
        sessionId: "sess-1",
        payload: { task: "do something" },
        status: "pending" as const
      }
      
      const dispatched = yield* coordinator.dispatchWork(workItem)
      expect(dispatched.status).toBe("dispatched")
      expect(dispatched.dispatchedAt).toBeDefined()
    })
  )

  it.effect("fails to dispatch work to non-existent session", () =>
    Effect.gen(function* () {
      const coordinator = new Coordinator()
      
      const workItem = {
        id: "work-1",
        sessionId: "missing-sess",
        payload: {},
        status: "pending" as const
      }
      
      const result = yield* Effect.flip(coordinator.dispatchWork(workItem))
      expect(result instanceof Error).toBe(true)
    })
  )

  // ── Error Recovery ───────────────────────────────────────────

  it.live("recovers timed out work items", () =>
    Effect.gen(function* () {
      // Set a very short timeout
      const coordinator = new Coordinator({ dispatchTimeoutMs: 100 })
      yield* coordinator.createSession("sess-1")
      
      const workItem = {
        id: "work-1",
        sessionId: "sess-1",
        payload: {},
        status: "pending" as const
      }
      
      yield* coordinator.dispatchWork(workItem)
      
      // Wait for timeout
      yield* Effect.sleep("150 millis")
      
      const recovered = yield* coordinator.recoverTimeouts()
      expect(recovered).toBe(1)
      
      // Run again, should be 0 since it's already timed out
      const recovered2 = yield* coordinator.recoverTimeouts()
      expect(recovered2).toBe(0)
    })
  )

  // ── Graceful Shutdown ────────────────────────────────────────

  it.effect("handles graceful shutdown", () =>
    Effect.gen(function* () {
      const coordinator = new Coordinator()
      yield* coordinator.createSession("sess-1")
      yield* coordinator.createSession("sess-2")
      
      yield* coordinator.shutdown()
      
      const sess1 = yield* coordinator.getSession("sess-1")
      expect(sess1.status).toBe("completed")
      
      // Cannot create new sessions after shutdown
      const result = yield* Effect.flip(coordinator.createSession("sess-3"))
      expect(result.message).toBe("Coordinator is shutting down")
      
      // Cannot dispatch work after shutdown
      const workResult = yield* Effect.flip(coordinator.dispatchWork({
        id: "work-1",
        sessionId: "sess-1",
        payload: {},
        status: "pending" as const
      }))
      expect(workResult instanceof Error).toBe(true)
    })
  )
})
