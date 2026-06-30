/**
 * Dharma Session Authority — Session Command Controller
 *
 * Evaluates command authority for the Dharma collaborative engineering fabric.
 * Pure functions for authority evaluation, scope checking, and receipt generation.
 */

import type {
  DharmaSession,
  SessionCommandRequest,
  SessionCommandReceipt,
  CommandDecision,
  SessionAuthorityGrant,
  SessionMember,
  CommandKind,
} from "./types"
import { isGrantValid, hasCapability, isPathAllowed, isCommandAllowed, isNetworkDomainAllowed, isEnvironmentVariableAllowed, isWithinBudget } from "./session-grants"
import { isMemberActive } from "./session-membership"
import { isTerminalState, acceptsCommands } from "./session-lifecycle"
import { createCommandReceipt, COMMAND_TO_REQUIRED_CAPABILITY } from "./session-commands"

// ── Session Context ----------------------------------------------------------

export interface SessionContext {
  session: DharmaSession
  members: SessionMember[]
  grants: SessionAuthorityGrant[]
  currentKeyEpoch: number
}

// ── Scope Kind Routing -------------------------------------------------------

/**
 * Determine the primary scope dimension to check for a given command kind.
 * This is an internal mapping; export it for testability.
 */
export function getScopeKind(commandKind: CommandKind): "path" | "command" | "network" | "env" | "budget" | "none" {
  switch (commandKind) {
    case "inspect_workspace":
    case "read_file":
    case "write_file":
    case "apply_patch":
    case "create_overlay":
    case "merge_overlay":
    case "discard_overlay":
      return "path"

    case "execute_command":
    case "terminate_command":
      return "command"

    case "request_compute_lease":
    case "approve_compute_lease":
    case "cancel_compute_lease":
      return "budget"

    case "invite_participant":
    case "revoke_grant":
    case "seal_session":
    case "export_artifact":
    case "request_escalation":
    case "approve_escalation":
      return "none"

    default:
      return "none"
  }
}

// ── Command Authority Evaluation ---------------------------------------------

/**
 * Full authority evaluation chain for a command request.
 *
 * Runs checks in order and returns the first rejection, or accepts the command.
 */
export function evaluateCommandAuthority(
  context: SessionContext,
  request: SessionCommandRequest,
): { decision: CommandDecision; reason: string | null; evaluationDigest: string } {
  // 1. Session state check
  const stateCheck = checkSessionState(context, request)
  if (!stateCheck.allowed) {
    return {
      decision: "rejected",
      reason: stateCheck.reason,
      evaluationDigest: computeDigest(["state", stateCheck.reason ?? "denied"]),
    }
  }

  // 2. Membership check
  const membershipCheck = checkMembership(context, request)
  if (!membershipCheck.active) {
    return {
      decision: "rejected",
      reason: membershipCheck.reason,
      evaluationDigest: computeDigest(["membership", membershipCheck.reason ?? "denied"]),
    }
  }

  // 3. Key epoch check
  const epochCheck = checkKeyEpoch(context, request)
  if (!epochCheck.matches) {
    return {
      decision: "rejected",
      reason: epochCheck.reason,
      evaluationDigest: computeDigest(["keyEpoch", epochCheck.reason ?? "mismatch"]),
    }
  }

  // 4. Grant validity check
  const grantCheck = checkGrant(context, request)
  if (!grantCheck.grant) {
    return {
      decision: "rejected",
      reason: grantCheck.error,
      evaluationDigest: computeDigest(["grant", grantCheck.error ?? "notFound"]),
    }
  }

  // 5. Capability check
  const requiredCapability = COMMAND_TO_REQUIRED_CAPABILITY[request.commandKind]
  if (!requiredCapability) {
    return {
      decision: "rejected",
      reason: `Unknown command kind: ${request.commandKind}`,
      evaluationDigest: computeDigest(["capability", "unknownCommandKind"]),
    }
  }
  if (!hasCapability(grantCheck.grant, requiredCapability)) {
    return {
      decision: "rejected",
      reason: `Grant lacks required capability: ${requiredCapability}`,
      evaluationDigest: computeDigest(["capability", `missing:${requiredCapability}`]),
    }
  }

  // 6. Scope check
  const scopeCheck = checkScope(grantCheck.grant, request)
  if (!scopeCheck.allowed) {
    return {
      decision: "rejected",
      reason: scopeCheck.reason,
      evaluationDigest: computeDigest(["scope", scopeCheck.reason ?? "denied"]),
    }
  }

  // All checks passed
  const digest = computeDigest(["accepted", request.requestId, request.commandKind])
  return { decision: "accepted", reason: null, evaluationDigest: digest }
}

/**
 * Check whether the session state allows the command.
 * Only "active" accepts commands. "draining" rejects new commands.
 */
export function checkSessionState(
  context: SessionContext,
  _request: SessionCommandRequest,
): { allowed: boolean; reason: string | null } {
  const state = context.session.lifecycleState

  if (isTerminalState(state)) {
    return { allowed: false, reason: `Session is in terminal state: ${state}` }
  }

  if (!acceptsCommands(state)) {
    return { allowed: false, reason: `Session state does not accept commands: ${state}` }
  }

  return { allowed: true, reason: null }
}

/**
 * Find and validate the grant used for this request.
 */
export function checkGrant(
  context: SessionContext,
  request: SessionCommandRequest,
): { grant: SessionAuthorityGrant | null; error: string | null } {
  const grant = context.grants.find((g) => g.grantId === request.grantId)
  if (!grant) {
    return { grant: null, error: `Grant not found: ${request.grantId}` }
  }

  if (!isGrantValid(grant, context.currentKeyEpoch)) {
    return { grant: null, error: "Grant is not valid (expired, revoked, or wrong epoch)" }
  }

  return { grant, error: null }
}

/**
 * Check that the actor is an active member.
 */
export function checkMembership(
  context: SessionContext,
  request: SessionCommandRequest,
): { active: boolean; reason: string | null } {
  const member = context.members.find((m) => m.membershipId === request.actorMembershipId)
  if (!member) {
    return { active: false, reason: `Member not found: ${request.actorMembershipId}` }
  }
  if (!isMemberActive(member)) {
    return { active: false, reason: `Member is not active: ${member.status}` }
  }
  return { active: true, reason: null }
}

/**
 * Check that the key epoch matches.
 */
export function checkKeyEpoch(
  context: SessionContext,
  request: SessionCommandRequest,
): { matches: boolean; reason: string | null } {
  if (request.sessionKeyEpoch !== context.currentKeyEpoch) {
    return {
      matches: false,
      reason: `Key epoch mismatch: request=${request.sessionKeyEpoch}, current=${context.currentKeyEpoch}`,
    }
  }
  return { matches: true, reason: null }
}

/**
 * Check resource scope for a command against a grant's resource scope.
 * Delegates to session-grants functions based on command kind.
 */
export function checkScope(
  grant: SessionAuthorityGrant,
  request: SessionCommandRequest,
): { allowed: boolean; reason: string | null } {
  const scope = grant.resourceScope
  const kind = getScopeKind(request.commandKind)

  switch (kind) {
    case "path":
      if (!isPathAllowed(scope, request.targetScope)) {
        return { allowed: false, reason: `Path not allowed by grant scope: ${request.targetScope}` }
      }
      return { allowed: true, reason: null }

    case "command":
      if (!isCommandAllowed(scope, request.targetScope)) {
        return { allowed: false, reason: `Command not allowed by grant scope: ${request.targetScope}` }
      }
      return { allowed: true, reason: null }

    case "network":
      if (!isNetworkDomainAllowed(scope, request.targetScope)) {
        return { allowed: false, reason: `Network domain not allowed by grant scope: ${request.targetScope}` }
      }
      return { allowed: true, reason: null }

    case "env":
      if (!isEnvironmentVariableAllowed(scope, request.targetScope)) {
        return { allowed: false, reason: `Environment variable not allowed by grant scope: ${request.targetScope}` }
      }
      return { allowed: true, reason: null }

    case "budget":
      if (!isWithinBudget(scope, {})) {
        return { allowed: false, reason: "Request exceeds grant budget constraints" }
      }
      return { allowed: true, reason: null }

    case "none":
      return { allowed: true, reason: null }

    default:
      return { allowed: true, reason: null }
  }
}

// ── Receipt Creation ---------------------------------------------------------

/**
 * Create a rejection receipt for a command request.
 */
export function createRejectionReceipt(
  request: SessionCommandRequest,
  reason: string,
): SessionCommandReceipt {
  return createCommandReceipt(request, "rejected", { denialReason: reason })
}

/**
 * Create an acceptance receipt for a command request.
 */
export function createAcceptanceReceipt(
  request: SessionCommandRequest,
): SessionCommandReceipt {
  return createCommandReceipt(request, "accepted")
}

// ── Authority Digest ---------------------------------------------------------

/**
 * Evaluate a complete session context for authority topology digest.
 */
export function computeAuthorityDigest(context: SessionContext): string {
  const parts: string[] = [
    context.session.sessionId,
    context.session.lifecycleState,
    String(context.currentKeyEpoch),
    ...context.grants.map((g) => `${g.grantId}:${g.sessionKeyEpoch}`).sort(),
    ...context.members
      .filter((m) => m.status === "active")
      .map((m) => m.membershipId)
      .sort(),
  ]
  return computeDigest(parts)
}

// ── Effective Grants ---------------------------------------------------------

/**
 * Get the effective grants for a member (direct grants only).
 *
 * Returns grants where the member is the subject and the grant is still valid.
 */
export function getEffectiveGrantsForMember(
  context: SessionContext,
  memberIdentity: string,
): SessionAuthorityGrant[] {
  return context.grants.filter((g) => {
    if (g.subjectIdentityPublicKey !== memberIdentity) return false
    return isGrantValid(g, context.currentKeyEpoch)
  })
}

// ── Internal Helpers ---------------------------------------------------------

/**
 * Compute a compact authority digest from parts.
 */
function computeDigest(parts: string[]): string {
  const input = parts.join("|")
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i)
    hash = ((hash << 5) - hash + chr) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
