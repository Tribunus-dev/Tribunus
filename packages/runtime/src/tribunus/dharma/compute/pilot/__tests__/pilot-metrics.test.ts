/**
 * Tests for pilot-metrics.ts — Metrics snapshots and tracking
 */

import { describe, it, expect } from "bun:test"
import {
  createMetricsSnapshot,
  recordTaskCompleted,
  recordTaskAccepted,
  recordContainmentIncident,
  computeAcceptanceRate,
} from "../pilot-metrics"
import type { PilotMetricsSnapshot } from "../pilot-metrics"

// ── createMetricsSnapshot ---------------------------------------------------

describe("createMetricsSnapshot", () => {
  it("creates a snapshot with the given session id", () => {
    const s = createMetricsSnapshot("pilot-001")
    expect(s.sessionId).toBe("pilot-001")
  })

  it("sets a valid startedAt timestamp", () => {
    const s = createMetricsSnapshot("pilot-002")
    expect(s.startedAt).toBeTruthy()
    expect(new Date(s.startedAt).getTime()).toBeGreaterThan(0)
  })

  it("initialises all counters to zero", () => {
    const s = createMetricsSnapshot("pilot-003")

    expect(s.contributorCount).toBe(0)
    expect(s.tasksClaimed).toBe(0)
    expect(s.tasksCompleted).toBe(0)
    expect(s.tasksAccepted).toBe(0)
    expect(s.tasksRejected).toBe(0)
    expect(s.computeLeasesStarted).toBe(0)
    expect(s.computeLeasesCompleted).toBe(0)
    expect(s.containmentIncidents).toBe(0)
    expect(s.recoveryEvents).toBe(0)
    expect(s.currentDurationMs).toBe(0)
  })
})

// ── recordTaskCompleted -----------------------------------------------------

describe("recordTaskCompleted", () => {
  it("increments tasksCompleted by 1", () => {
    const s = createMetricsSnapshot("pilot-001")
    const s1 = recordTaskCompleted(s)

    expect(s1.tasksCompleted).toBe(1)
    expect(s1.tasksClaimed).toBe(0) // other fields unchanged
    expect(s.tasksCompleted).toBe(0) // original unmutated
  })

  it("updates currentDurationMs based on wall clock", () => {
    const s = createMetricsSnapshot("pilot-002")
    const s1 = recordTaskCompleted(s)

    expect(s1.currentDurationMs).toBeGreaterThanOrEqual(0)
  })

  it("returns a new object without mutating the original", () => {
    const s = createMetricsSnapshot("pilot-003")
    const s1 = recordTaskCompleted(s)

    expect(s1).not.toBe(s)
    expect(s.tasksCompleted).toBe(0)
    expect(s.currentDurationMs).toBe(0)
  })
})

// ── recordTaskAccepted ------------------------------------------------------

describe("recordTaskAccepted", () => {
  it("increments tasksAccepted by 1", () => {
    const s = createMetricsSnapshot("pilot-001")
    const s1 = recordTaskAccepted(s)

    expect(s1.tasksAccepted).toBe(1)
    expect(s.tasksAccepted).toBe(0)
  })

  it("leaves other fields unchanged", () => {
    const s = createMetricsSnapshot("pilot-002")
    const s1 = recordTaskAccepted(s)

    expect(s1.tasksCompleted).toBe(0)
    expect(s1.tasksClaimed).toBe(0)
    expect(s1.sessionId).toBe("pilot-002")
  })
})

// ── recordContainmentIncident -----------------------------------------------

describe("recordContainmentIncident", () => {
  it("increments containmentIncidents by 1", () => {
    const s = createMetricsSnapshot("pilot-001")
    const s1 = recordContainmentIncident(s)

    expect(s1.containmentIncidents).toBe(1)
    expect(s.containmentIncidents).toBe(0)
  })

  it("leaves other counters unchanged", () => {
    const s = createMetricsSnapshot("pilot-002")
    const s1 = recordContainmentIncident(s)

    expect(s1.tasksCompleted).toBe(0)
    expect(s1.recoveryEvents).toBe(0)
    expect(s1.computeLeasesStarted).toBe(0)
  })
})

// ── computeAcceptanceRate ---------------------------------------------------

describe("computeAcceptanceRate", () => {
  it("returns 0 when no tasks have been completed", () => {
    const s = createMetricsSnapshot("pilot-001")
    expect(computeAcceptanceRate(s)).toBe(0)
  })

  it("returns 1 when all completed tasks are accepted", () => {
    const s = createMetricsSnapshot("pilot-002")
    const s1: PilotMetricsSnapshot = { ...s, tasksCompleted: 5, tasksAccepted: 5 }
    expect(computeAcceptanceRate(s1)).toBe(1)
  })

  it("returns the correct ratio when only some are accepted", () => {
    const s = createMetricsSnapshot("pilot-003")
    const s1: PilotMetricsSnapshot = { ...s, tasksCompleted: 10, tasksAccepted: 3 }
    expect(computeAcceptanceRate(s1)).toBe(0.3)
  })

  it("returns 0 when tasksCompleted is 0 even if tasksAccepted is non-zero", () => {
    const s = createMetricsSnapshot("pilot-004")
    const s1: PilotMetricsSnapshot = { ...s, tasksCompleted: 0, tasksAccepted: 5 }
    expect(computeAcceptanceRate(s1)).toBe(0)
  })
})
