/**
 * Track E — Contribution Accounting: Session Hooks
 *
 * Maps session events and command completions to contribution records.
 * These hooks bridge session authority evaluation with the contribution store.
 */

import type { CommandKind, SessionCommandRequest, SessionCommandReceipt } from "./types"
import type { ContributionClass, DharmaContributionRecord } from "../contribution/contribution-types"
import { createContributionStore, addContribution, acceptContribution as storeAcceptContribution, getSessionSummary, type ContributionStore, type ContributionSummary } from "../contribution/contribution-store"

// ── Command Kind → Contribution Class ---------------------------------------

/**
 * Map command kinds to contribution classes.
 */
export function commandKindToContributionClass(kind: CommandKind): ContributionClass {
  switch (kind) {
    case "write_file":
    case "apply_patch":
    case "create_overlay":
    case "merge_overlay":
      return "work_product"
    case "execute_command":
    case "request_compute_lease":
    case "cancel_compute_lease":
      return "compute_lease"
    case "approve_compute_lease":
    case "approve_escalation":
      return "moderation_action"
    case "inspect_workspace":
    case "read_file":
      return "reproduction_evidence"
    case "export_artifact":
      return "artifact_contribution"
    case "invite_participant":
      return "session_stewardship"
    default:
      return "work_product"
  }
}

// ── Contribution Hook Context -----------------------------------------------

export interface ContributionHookContext {
  sessionId: string
  contributorIdentityDigest: string
  store: ContributionStore
}

/**
 * Create a contribution hook context for a session.
 */
export function createContributionHookContext(
  sessionId: string,
  contributorDigest: string,
): ContributionHookContext {
  return { sessionId, contributorIdentityDigest: contributorDigest, store: createContributionStore() }
}

// ── Record Contribution from Command ----------------------------------------

/**
 * Create a contribution record from a completed command.
 *
 * Returns the updated context and the new contribution record.
 */
export function recordContributionFromCommand(
  context: ContributionHookContext,
  request: SessionCommandRequest,
  receipt: SessionCommandReceipt,
): { context: ContributionHookContext; record: DharmaContributionRecord } {
  const cls = commandKindToContributionClass(request.commandKind)
  const record: DharmaContributionRecord = {
    contributionId: `contrib-${request.requestId}`,
    sessionId: context.sessionId,
    contributorIdentityDigest: context.contributorIdentityDigest,
    contributionClass: cls,
    description: `${request.commandKind} command completed`,
    receiptDigests: [receipt.receiptId],
    acceptedBy: null,
    acceptedAt: null,
    evidenceQuality: "medium",
    resourceCostSummary: null,
    outcomeRelation: request.requestId,
    codexEligibility: false,
    visibilityClass: "session",
    createdAt: new Date().toISOString(),
  }
  const newStore = addContribution(context.store, record)
  return { context: { ...context, store: newStore }, record }
}

// ── Accept Contribution -----------------------------------------------------

/**
 * Accept a contribution (called when session owner approves).
 */
export function acceptContributionRecord(
  context: ContributionHookContext,
  contributionId: string,
  acceptedBy: string,
): ContributionHookContext {
  const updated = storeAcceptContribution(context.store, contributionId, acceptedBy)
  if (!updated) return context
  const newStore = addContribution(context.store, updated)
  return { ...context, store: newStore }
}

// ── Re-export store types ---------------------------------------------------

export { getSessionSummary, type ContributionSummary }
export type { DharmaContributionRecord, ContributionClass } from "../contribution/contribution-types"
