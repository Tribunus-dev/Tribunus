/**
 * Tests for pilot-registry.ts — In-memory pilot registry
 */

import { describe, it, expect } from "bun:test"
import {
  createPilotRegistry,
  registerSession,
  getActiveSessions,
  getSessionEvidence,
  recordPilotMetric,
} from "../pilot-registry"
import { createPilotSession, createEvidenceBundle } from "../pilot-types"
import { createMetricsSnapshot } from "../pilot-metrics"
import type { PilotRegistry } from "../pilot-registry"

// ── createPilotRegistry -----------------------------------------------------

describe("createPilotRegistry", () => {
  it("creates an empty registry", () => {
    const r = createPilotRegistry()

    expect(r.sessions.size).toBe(0)
    expect(r.constraints.size).toBe(0)
    expect(r.evidence.size).toBe(0)
    expect(r.metrics.size).toBe(0)
  })
})

// ── registerSession ---------------------------------------------------------

describe("registerSession", () => {
  it("adds a session to the registry", () => {
    const r = createPilotRegistry()
    const session = createPilotSession("pilot-001", "benchmark", "TPM benchmark")
    const r1 = registerSession(r, session)

    expect(r1.sessions.size).toBe(1)
    expect(r1.sessions.get("pilot-001")).toBe(session)
  })

  it("does not mutate the original registry", () => {
    const r = createPilotRegistry()
    const session = createPilotSession("pilot-001", "bug_reproduction", "")
    registerSession(r, session)

    expect(r.sessions.size).toBe(0)
  })

  it("supports multiple sessions", () => {
    const r = createPilotRegistry()
    const s1 = createPilotSession("pilot-001", "benchmark", "")
    const s2 = createPilotSession("pilot-002", "bug_reproduction", "")
    const r1 = registerSession(r, s1)
    const r2 = registerSession(r1, s2)

    expect(r2.sessions.size).toBe(2)
  })
})

// ── getActiveSessions -------------------------------------------------------

describe("getActiveSessions", () => {
  it("returns sessions that have not exceeded their maxDurationMs", () => {
    const r = createPilotRegistry()
    const session = createPilotSession("pilot-001", "bug_reproduction", "")
    const r1 = registerSession(r, session)

    const active = getActiveSessions(r1)
    expect(active.length).toBe(1)
    expect(active[0].sessionId).toBe("pilot-001")
  })

  it("excludes sessions whose duration has elapsed", () => {
    const r = createPilotRegistry()
    // Past timestamp so duration has already elapsed
    const session = createPilotSession("pilot-expired", "benchmark", "")
    const expired: typeof session = {
      ...session,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
      maxDurationMs: 10_000, // 10 seconds — long expired
    }
    const r1 = registerSession(r, expired)

    const active = getActiveSessions(r1)
    expect(active.length).toBe(0)
  })

  it("returns only active sessions when mixed with expired", () => {
    const r = createPilotRegistry()
    const fresh = createPilotSession("fresh", "bug_reproduction", "")
    const expired = {
      ...createPilotSession("expired", "benchmark", ""),
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      maxDurationMs: 10_000,
    }
    const r1 = registerSession(r, fresh)
    const r2 = registerSession(r1, expired)

    const active = getActiveSessions(r2)
    expect(active.length).toBe(1)
    expect(active[0].sessionId).toBe("fresh")
  })
})

// ── getSessionEvidence ------------------------------------------------------

describe("getSessionEvidence", () => {
  it("returns undefined when no evidence exists", () => {
    const r = createPilotRegistry()
    expect(getSessionEvidence(r, "pilot-001")).toBeUndefined()
  })

  it("returns the evidence bundle when present", () => {
    const r: PilotRegistry = createPilotRegistry()
    const evidence = createEvidenceBundle("pilot-001", "bug_reproduction")

    // Manually add evidence to the registry for testing
    const r1: PilotRegistry = {
      ...r,
      evidence: new Map(r.evidence).set("pilot-001", evidence),
    }

    const result = getSessionEvidence(r1, "pilot-001")
    expect(result).toBe(evidence)
  })
})

// ── recordPilotMetric -------------------------------------------------------

describe("recordPilotMetric", () => {
  it("creates a new metrics entry when none exists", () => {
    const r = createPilotRegistry()
    const r1 = recordPilotMetric(r, "pilot-001", {
      tasksCompleted: 3,
      tasksAccepted: 2,
    })

    const m = r1.metrics.get("pilot-001")
    expect(m).toBeDefined()
    expect(m!.sessionId).toBe("pilot-001")
    expect(m!.tasksCompleted).toBe(3)
    expect(m!.tasksAccepted).toBe(2)
    expect(m!.tasksClaimed).toBe(0) // default
  })

  it("merges with existing metrics", () => {
    const r = createPilotRegistry()
    const r1 = recordPilotMetric(r, "pilot-001", { tasksCompleted: 3 })
    const r2 = recordPilotMetric(r1, "pilot-001", { tasksAccepted: 2 })

    const m = r2.metrics.get("pilot-001")
    expect(m!.tasksCompleted).toBe(3) // preserved
    expect(m!.tasksAccepted).toBe(2) // added
  })

  it("does not mutate the original registry", () => {
    const r = createPilotRegistry()
    recordPilotMetric(r, "pilot-001", { tasksCompleted: 1 })

    expect(r.metrics.size).toBe(0)
  })

  it("allows updating contributorCount", () => {
    const r = createPilotRegistry()
    const r1 = recordPilotMetric(r, "pilot-001", { contributorCount: 5 })

    expect(r1.metrics.get("pilot-001")!.contributorCount).toBe(5)
  })

  it("allows updating containmentIncidents", () => {
    const r = createPilotRegistry()
    const r1 = recordPilotMetric(r, "pilot-001", { containmentIncidents: 2 })

    expect(r1.metrics.get("pilot-001")!.containmentIncidents).toBe(2)
  })
})
