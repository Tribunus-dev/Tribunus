/**
 * Dharma Trusted-LAN Pilot — Real-time metrics snapshots
 *
 * Tracks live counters for tasks, compute leases, containment incidents,
 * and recovery events during a pilot session.
 */

// ── Helpers -----------------------------------------------------------------

function nowISO(): string {
  return new Date().toISOString()
}

// ── Metrics Snapshot --------------------------------------------------------

export interface PilotMetricsSnapshot {
  sessionId: string
  startedAt: string
  contributorCount: number
  tasksClaimed: number
  tasksCompleted: number
  tasksAccepted: number
  tasksRejected: number
  computeLeasesStarted: number
  computeLeasesCompleted: number
  containmentIncidents: number
  recoveryEvents: number
  currentDurationMs: number
}

// ── createMetricsSnapshot ---------------------------------------------------

/**
 * Create a fresh metrics snapshot for a pilot session. All counters start
 * at zero; the snapshot records the current wall clock as its start time.
 */
export function createMetricsSnapshot(sessionId: string): PilotMetricsSnapshot {
  const now = nowISO()

  return {
    sessionId,
    startedAt: now,
    contributorCount: 0,
    tasksClaimed: 0,
    tasksCompleted: 0,
    tasksAccepted: 0,
    tasksRejected: 0,
    computeLeasesStarted: 0,
    computeLeasesCompleted: 0,
    containmentIncidents: 0,
    recoveryEvents: 0,
    currentDurationMs: 0,
  }
}

// ── Mutators (immutable) ----------------------------------------------------

/**
 * Return a copy of the snapshot with one more completed task.
 */
export function recordTaskCompleted(snapshot: PilotMetricsSnapshot): PilotMetricsSnapshot {
  return {
    ...snapshot,
    tasksCompleted: snapshot.tasksCompleted + 1,
    currentDurationMs: Date.now() - new Date(snapshot.startedAt).getTime(),
  }
}

/**
 * Return a copy of the snapshot with one more accepted task result.
 */
export function recordTaskAccepted(snapshot: PilotMetricsSnapshot): PilotMetricsSnapshot {
  return {
    ...snapshot,
    tasksAccepted: snapshot.tasksAccepted + 1,
  }
}

/**
 * Return a copy of the snapshot with one more containment incident.
 */
export function recordContainmentIncident(snapshot: PilotMetricsSnapshot): PilotMetricsSnapshot {
  return {
    ...snapshot,
    containmentIncidents: snapshot.containmentIncidents + 1,
  }
}

// ── computeAcceptanceRate ---------------------------------------------------

/**
 * Compute the task acceptance rate. Returns 0 when no tasks have been
 * completed to avoid division by zero.
 */
export function computeAcceptanceRate(snapshot: PilotMetricsSnapshot): number {
  if (snapshot.tasksCompleted === 0) return 0
  return snapshot.tasksAccepted / snapshot.tasksCompleted
}
