/**
 * Dharma Trusted-LAN — Enrollment and Lease State Machines
 */

import type { EnrollmentState, RemoteLeaseStatus, ProviderHealthState } from "./trusted-lan-types"

// ── Provider Enrollment -----------------------------------------------------

export const VALID_ENROLLMENT_TRANSITIONS: Record<EnrollmentState, readonly EnrollmentState[]> = {
  draft: ["pending_attestation"], pending_attestation: ["enrolled"],
  enrolled: ["active"], active: ["draining", "suspended"],
  draining: ["suspended", "revoked"], suspended: ["active", "revoked"], revoked: [],
}

export type EnrollmentAction = "attest" | "activate" | "drain" | "suspend" | "unsuspend" | "revoke"

export function applyEnrollmentAction(current: EnrollmentState, action: EnrollmentAction): EnrollmentState {
  const map: Record<EnrollmentState, Partial<Record<EnrollmentAction, EnrollmentState>>> = {
    draft: { attest: "pending_attestation" }, pending_attestation: { attest: "enrolled" },
    enrolled: { activate: "active" }, active: { drain: "draining", suspend: "suspended" },
    draining: { suspend: "suspended", revoke: "revoked" }, suspended: { unsuspend: "active", revoke: "revoked" }, revoked: {},
  }
  const next = map[current][action]
  if (!next) throw new Error(`Invalid enrollment transition: ${current} → ${action}`)
  return next
}

export function isProviderActive(state: EnrollmentState): boolean { return state === "active" || state === "draining" }

// ── Remote Lease ------------------------------------------------------------

export const VALID_LAN_LEASE_TRANSITIONS: Record<RemoteLeaseStatus, readonly RemoteLeaseStatus[]> = {
  draft: ["requested"], requested: ["provider_evaluating", "rejected"],
  provider_evaluating: ["approved", "expired"], approved: ["admitted", "expired"],
  admitted: ["transferring_input", "failed"], transferring_input: ["running", "failed"],
  running: ["streaming", "completed", "cancelled", "revoked", "failed"],
  streaming: ["transferring_output", "cancelled", "revoked", "failed", "completed"],
  transferring_output: ["completed", "failed"], completed: [], rejected: [], expired: [],
  failed: [], cancelled: [], revoked: [],
}

export type LanLeaseAction =
  | "request" | "evaluate" | "approve" | "reject" | "admit" | "transfer_input"
  | "start" | "stream" | "transfer_output" | "complete" | "fail" | "cancel" | "expire" | "revoke"

export function applyLanLeaseAction(current: RemoteLeaseStatus, action: LanLeaseAction): RemoteLeaseStatus {
  const map: Record<RemoteLeaseStatus, Partial<Record<LanLeaseAction, RemoteLeaseStatus>>> = {
    draft: { request: "requested" }, requested: { evaluate: "provider_evaluating", reject: "rejected" },
    provider_evaluating: { approve: "approved", expire: "expired" },
    approved: { admit: "admitted", expire: "expired" },
    admitted: { transfer_input: "transferring_input", fail: "failed" },
    transferring_input: { start: "running", fail: "failed" },
    running: { stream: "streaming", complete: "completed", cancel: "cancelled", revoke: "revoked", fail: "failed" },
    streaming: { transfer_output: "transferring_output", cancel: "cancelled", revoke: "revoked", fail: "failed", complete: "completed" },
    transferring_output: { complete: "completed", fail: "failed" },
    completed: {}, rejected: {}, expired: {}, failed: {}, cancelled: {}, revoked: {},
  }
  const next = map[current][action]
  if (!next) throw new Error(`Invalid LAN lease transition: ${current} → ${action}`)
  return next
}

export function isTerminalLanLease(status: RemoteLeaseStatus): boolean {
  return ["completed", "rejected", "expired", "failed", "cancelled", "revoked"].includes(status)
}

// ── Provider Health ---------------------------------------------------------

export const VALID_HEALTH_TRANSITIONS: Record<ProviderHealthState, readonly ProviderHealthState[]> = {
  available: ["busy", "degraded", "draining", "offline"],
  busy: ["available", "degraded", "draining", "offline"],
  degraded: ["available", "busy", "draining", "offline"],
  draining: ["offline"], offline: ["available"],
}
