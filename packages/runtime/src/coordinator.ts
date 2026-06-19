import { Effect, Context, Layer } from "effect"

// ── Configuration ──────────────────────────────────────────────

export interface CoordinatorConfig {
  maxSessions: number
  dispatchTimeoutMs: number
  recoveryDelayMs: number
}

export const defaultConfig: CoordinatorConfig = {
  maxSessions: 100,
  dispatchTimeoutMs: 30000,
  recoveryDelayMs: 5000,
}

// ── Interfaces ─────────────────────────────────────────────────

export interface Session {
  id: string
  status: "initializing" | "running" | "completed" | "failed"
  createdAt: number
}

export interface WorkItem {
  id: string
  sessionId: string
  payload: any
  status: "pending" | "dispatched" | "completed" | "failed" | "timeout"
  dispatchedAt?: number
}

// ── Coordinator Service ────────────────────────────────────────

export interface CoordinatorInterface {
  createSession(id: string): Effect.Effect<Session, Error>
  getSession(id: string): Effect.Effect<Session, Error>
  dispatchWork(workItem: WorkItem): Effect.Effect<WorkItem, Error>
  recoverTimeouts(): Effect.Effect<number>
  shutdown(): Effect.Effect<void>
}

export class Coordinator implements CoordinatorInterface {
  private config: CoordinatorConfig
  private sessions: Map<string, Session> = new Map()
  private workItems: Map<string, WorkItem> = new Map()
  private isShuttingDown: boolean = false

  constructor(config: Partial<CoordinatorConfig> = {}) {
    this.config = { ...defaultConfig, ...config }

    if (this.config.maxSessions <= 0) {
      throw new Error("Invalid configuration: maxSessions must be greater than 0")
    }
  }

  // ── Session Management ───────────────────────────────────────

  createSession(id: string): Effect.Effect<Session, Error> {
    const self = this
    return Effect.gen(function* () {
      if (self.isShuttingDown) {
        return yield* Effect.fail(new Error("Coordinator is shutting down"))
      }

      if (self.sessions.size >= self.config.maxSessions) {
        return yield* Effect.fail(new Error("Max sessions reached"))
      }

      if (self.sessions.has(id)) {
        return yield* Effect.fail(new Error(`Session ${id} already exists`))
      }

      const session: Session = {
        id,
        status: "initializing",
        createdAt: Date.now(),
      }

      self.sessions.set(id, session)

      // Simulate lifecycle transition
      session.status = "running"

      return session
    })
  }

  getSession(id: string): Effect.Effect<Session, Error> {
    const self = this
    return Effect.gen(function* () {
      const session = self.sessions.get(id)
      if (!session) {
        return yield* Effect.fail(new Error(`Session ${id} not found`))
      }
      return session
    })
  }

  // ── Work Dispatch ────────────────────────────────────────────

  dispatchWork(workItem: WorkItem): Effect.Effect<WorkItem, Error> {
    const self = this
    return Effect.gen(function* () {
      if (self.isShuttingDown) {
        return yield* Effect.fail(new Error("Coordinator is shutting down"))
      }

      const session = self.sessions.get(workItem.sessionId)
      if (!session) {
        return yield* Effect.fail(new Error(`Cannot dispatch work: Session ${workItem.sessionId} not found`))
      }

      if (session.status !== "running") {
        return yield* Effect.fail(new Error(`Cannot dispatch work: Session ${workItem.sessionId} is ${session.status}`))
      }

      const item = {
        ...workItem,
        status: "dispatched" as const,
        dispatchedAt: Date.now(),
      }

      self.workItems.set(item.id, item)

      return item
    })
  }

  // ── Error Recovery & Timeout ─────────────────────────────────

  recoverTimeouts(): Effect.Effect<number> {
    const self = this
    return Effect.gen(function* () {
      let recoveredCount = 0
      const now = Date.now()

      for (const [id, item] of self.workItems.entries()) {
        if (item.status === "dispatched" && item.dispatchedAt) {
          if (now - item.dispatchedAt > self.config.dispatchTimeoutMs) {
            item.status = "timeout"
            recoveredCount++
          }
        }
      }

      return recoveredCount
    })
  }

  // ── Lifecycle ────────────────────────────────────────────────

  shutdown(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      self.isShuttingDown = true

      // Transition all running sessions to completed or failed
      for (const session of self.sessions.values()) {
        if (session.status === "running") {
          session.status = "completed"
        }
      }
    })
  }
}

export class CoordinatorService extends Context.Service<CoordinatorService, CoordinatorInterface>()("CoordinatorService") {}

export const createCoordinatorLayer = (config?: Partial<CoordinatorConfig>) =>
  Layer.sync(CoordinatorService, () => {
    try {
      return new Coordinator(config)
    } catch (e) {
      throw e // Let it fail fast on invalid config
    }
  })
