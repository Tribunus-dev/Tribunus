/**
 * Dharma OS-Enforced Sandbox — Violation and Audit Logging
 *
 * Records containment violations and audit events. Never stores raw
 * process output, full command lines, or secret-bearing material inline.
 */

import { randomUUID } from "node:crypto"
import type { ContainmentViolation, ViolationKind, ViolationSeverity } from "./containment-types"

/** Create a containment violation record. */
export function createViolation(
  executionId: string,
  sessionId: string,
  kind: ViolationKind,
  severity: ViolationSeverity,
  details: string,
): ContainmentViolation {
  return {
    violationId: randomUUID(),
    executionId,
    sessionId,
    timestamp: new Date().toISOString(),
    kind,
    severity,
    details: sanitizeViolationDetail(details),
  }
}

/** Strip potential secrets from violation detail strings. */
function sanitizeViolationDetail(detail: string): string {
  return detail
    .replace(/key=([^\s,]+)/gi, "key=<redacted>")
    .replace(/token=([^\s,]+)/gi, "token=<redacted>")
    .replace(/secret=([^\s,]+)/gi, "secret=<redacted>")
    .replace(/password=([^\s,]+)/gi, "password=<redacted>")
}

/** Classify violation severity from kind. */
export function classifyViolationSeverity(kind: ViolationKind): ViolationSeverity {
  switch (kind) {
    case "filesystem_escape": return "critical"
    case "secret_access": return "critical"
    case "mount_attempt": return "critical"
    case "network_access": return "warning"
    case "process_spawn": return "warning"
    case "syscall_denied": return "warning"
    case "resource_exceeded": return "warning"
    case "ipc_access": return "info"
    case "process_signal": return "info"
  }
}

/** Format violation summary for audit log. */
export function formatViolationSummary(violations: ContainmentViolation[]): string {
  const byKind = new Map<ViolationKind, number>()
  for (const v of violations) {
    byKind.set(v.kind, (byKind.get(v.kind) || 0) + 1)
  }
  return [...byKind.entries()]
    .map(([kind, count]) => `${kind}:${count}`)
    .join(",")
}

/** Check if a violation requires emergency termination. */
export function isEmergencyViolation(violation: ContainmentViolation): boolean {
  return violation.severity === "critical"
}
