/**
 * Dharma Trusted-LAN Pilot — Registry
 *
 * In-memory registry that stores pilot session configurations, constraints,
 * evidence bundles, and metrics snapshots. All operations are pure —
 * they return new copies of the registry rather than mutating in place.
 */

import type { PilotSessionConfig } from "./pilot-types"
import type { PilotConstraints } from "./pilot-types"
import type { PilotEvidenceBundle } from "./pilot-types"
import type { PilotMetricsSnapshot } from "./pilot-metrics"

// ── Registry ----------------------------------------------------------------

export interface PilotRegistry {
  sessions: Map<string, PilotSessionConfig>
  constraints: Map<string, PilotConstraints>
  evidence: Map<string, PilotEvidenceBundle>
  metrics: Map<string, PilotMetricsSnapshot>
}

// ── createPilotRegistry -----------------------------------------------------

/**
 * Create an empty pilot registry.
 */
export function createPilotRegistry(): PilotRegistry {
  return {
    sessions: new Map(),
    constraints: new Map(),
    evidence: new Map(),
    metrics: new Map(),
  }
}

// ── registerSession ---------------------------------------------------------

/**
 * Register a pilot session configuration and its default constraints in the
 * registry. Returns a new registry with the session added.
 */
export function registerSession(
  registry: PilotRegistry,
  session: PilotSessionConfig,
): PilotRegistry {
  const sessions = new Map(registry.sessions)
  sessions.set(session.sessionId, session)

  return {
    ...registry,
    sessions,
  }
}

// ── getActiveSessions -------------------------------------------------------

/**
 * Return all registered sessions whose duration has not yet elapsed (based on
 * the wall clock at call time) and which have no evidence bundle indicating
 * they are already completed.
 */
export function getActiveSessions(registry: PilotRegistry): PilotSessionConfig[] {
  const now = Date.now()
  const result: PilotSessionConfig[] = []

  for (const session of registry.sessions.values()) {
    const created = new Date(session.createdAt).getTime()
    const elapsed = now - created

    // A session is active if it hasn't exceeded its max duration
    if (elapsed < session.maxDurationMs) {
      result.push(session)
    }
  }

  return result
}

// ── getSessionEvidence ------------------------------------------------------

/**
 * Look up the evidence bundle for a given session. Returns `undefined` when
 * the session has no recorded evidence.
 */
export function getSessionEvidence(
  registry: PilotRegistry,
  sessionId: string,
): PilotEvidenceBundle | undefined {
  return registry.evidence.get(sessionId)
}

// ── recordPilotMetric -------------------------------------------------------

/**
 * Merge a partial metrics update into the registry for the given session.
 * Returns a new registry with the updated metrics entry. If the session
 * has no existing metrics snapshot a new one is created from the provided
 * update.
 */
export function recordPilotMetric(
  registry: PilotRegistry,
  sessionId: string,
  update: Partial<PilotMetricsSnapshot>,
): PilotRegistry {
  const existing = registry.metrics.get(sessionId)
  const merged: PilotMetricsSnapshot = {
    sessionId,
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    contributorCount: update.contributorCount ?? existing?.contributorCount ?? 0,
    tasksClaimed: update.tasksClaimed ?? existing?.tasksClaimed ?? 0,
    tasksCompleted: update.tasksCompleted ?? existing?.tasksCompleted ?? 0,
    tasksAccepted: update.tasksAccepted ?? existing?.tasksAccepted ?? 0,
    tasksRejected: update.tasksRejected ?? existing?.tasksRejected ?? 0,
    computeLeasesStarted: update.computeLeasesStarted ?? existing?.computeLeasesStarted ?? 0,
    computeLeasesCompleted: update.computeLeasesCompleted ?? existing?.computeLeasesCompleted ?? 0,
    containmentIncidents: update.containmentIncidents ?? existing?.containmentIncidents ?? 0,
    recoveryEvents: update.recoveryEvents ?? existing?.recoveryEvents ?? 0,
    currentDurationMs: update.currentDurationMs ?? existing?.currentDurationMs ?? 0,
  }

  const metrics = new Map(registry.metrics)
  metrics.set(sessionId, merged)

  return { ...registry, metrics }
}
