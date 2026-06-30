/**
 * Dharma Replication — Local Diagnostics
 *
 * Provides a local-only diagnostics model for monitoring replication health.
 * Normal users see only meaningful status levels; detailed diagnostics
 * are available in an advanced "Federation Health" panel.
 */

import type { DharmaReplicationDiagnostics, FederationUserStatus, SwarmLifecycleState } from "./protocol"

// ── Diagnostics Collector ---------------------------------------------------

export interface DiagnosticsSource {
  getLifecycleState(): SwarmLifecycleState | "inactive"
  isSwarmJoined(): boolean
  getActivePeerCount(): number
  getSuccessfulHandshakes(): number
  getFailedHandshakes(): number
  getWriterCount(): number
  getAutobaseLength(): number
  getAutobaseSignedLength(): number
  getImporterProvisionalCursor(): number
  getImporterFinalizedCursor(): number
  getPendingOutboxCount(): number
  getPendingDependencyCount(): number
  getQuarantineCount(): number
  getLastSuccessfulReplicationAt(): string | null
  getLastError(): string | null
}

/**
 * Collect replication diagnostics from multiple sources.
 */
export function collectDiagnostics(
  federationId: string,
  source: DiagnosticsSource,
): DharmaReplicationDiagnostics {
  return {
    federationId,
    lifecycleState: source.getLifecycleState(),
    swarmJoined: source.isSwarmJoined(),
    activePeerCount: source.getActivePeerCount(),
    successfulHandshakes: source.getSuccessfulHandshakes(),
    failedHandshakes: source.getFailedHandshakes(),
    writerCount: source.getWriterCount(),
    autobaseLength: source.getAutobaseLength(),
    autobaseSignedLength: source.getAutobaseSignedLength(),
    importerProvisionalCursor: source.getImporterProvisionalCursor(),
    importerFinalizedCursor: source.getImporterFinalizedCursor(),
    pendingOutboxCount: source.getPendingOutboxCount(),
    pendingDependencyCount: source.getPendingDependencyCount(),
    quarantineCount: source.getQuarantineCount(),
    lastSuccessfulReplicationAt: source.getLastSuccessfulReplicationAt(),
    lastError: source.getLastError(),
  }
}

// ── User-Facing Status Mapping ----------------------------------------------

/**
 * Map raw diagnostics to a user-facing status.
 */
export function deriveUserStatus(diag: DharmaReplicationDiagnostics): FederationUserStatus {
  if (diag.lifecycleState === "paused") return "paused"
  if (diag.lifecycleState === "stopped" || diag.lifecycleState === "inactive") return "offline"
  if (diag.lifecycleState === "starting" || diag.lifecycleState === "joining") return "connecting"
  if (diag.lifecycleState === "connected" && diag.pendingDependencyCount > 0) return "synchronizing"
  if (diag.lifecycleState === "connected" && diag.pendingOutboxCount > 0) return "synchronizing"
  if (diag.lifecycleState === "connected") return "up_to_date"
  if (diag.lifecycleState === "degraded") {
    if (diag.lastError) return "attention_required"
    return "degraded"
  }
  return "offline"
}

/**
 * Determine overall health level from diagnostics.
 */
export type HealthLevel = "healthy" | "degraded" | "unhealthy" | "unknown"

export function assessHealth(diag: DharmaReplicationDiagnostics): HealthLevel {
  if (diag.lifecycleState === "connected" && diag.activePeerCount > 0) {
    return diag.lastError ? "degraded" : "healthy"
  }
  if (diag.lifecycleState === "degraded") return "degraded"
  if (diag.lifecycleState === "paused") return "degraded"
  if (diag.lifecycleState === "stopped" || diag.lifecycleState === "inactive") return "unknown"
  return "unhealthy"
}
