/**
 * Dharma Federation Runtime — Federation State Machines & Registry
 *
 * Pure functions for federation lifecycle, membership transitions,
 * and configuration creation per the Dharma v1 specification.
 */

import type {
  Federation,
  FederationStatus,
  FederationVisibility,
  FederationMembership,
  MembershipStatus,
  FederationRole,
} from "./types";
import { randomUUID } from "node:crypto"
import { FEDERATION_ROLES, sha256Hex } from "./types";

// ── Federation Status Transitions ────────────────────────────────────────────

export type FederationAction =
  | "discover"
  | "invite"
  | "join"
  | "approve"
  | "activate"
  | "suspend"
  | "lift_suspension"
  | "leave"
  | "revoke"
  | "limit";

/**
 * Valid status transitions for a federation.
 * From spec: unaware → discovered → invited → joining → active
 * Also supports: active ↔ limited/suspended and any → left/revoked
 */
export const VALID_FEDERATION_TRANSITIONS: Record<FederationStatus, readonly FederationStatus[]> = {
  unaware: ["discovered"],
  discovered: ["invited"],
  invited: ["joining"],
  joining: ["active"],
  active: ["limited", "suspended", "left", "revoked"],
  limited: ["active", "suspended", "left", "revoked"],
  suspended: ["active", "left", "revoked"],
  left: [],
  revoked: [],
};

/** Check if a federation status transition is valid */
export function isValidTransition(current: FederationStatus, next: FederationStatus): boolean {
  return VALID_FEDERATION_TRANSITIONS[current].includes(next);
}

/**
 * Returns the action name that corresponds to each valid transition.
 * Used by getNextStatus to map action → target status.
 */
const FEDERATION_ACTION_MAP: Record<FederationStatus, Partial<Record<FederationAction, FederationStatus>>> = {
  unaware: { discover: "discovered" },
  discovered: { invite: "invited" },
  invited: { join: "joining" },
  joining: { approve: "active" },
  active: { suspend: "suspended", limit: "limited", leave: "left", revoke: "revoked" },
  limited: { activate: "active", suspend: "suspended", leave: "left", revoke: "revoked" },
  suspended: { lift_suspension: "active", leave: "left", revoke: "revoked" },
  left: {},
  revoked: {},
};

/** Compute the next federation status given the current status and action */
export function getNextStatus(current: FederationStatus, action: FederationAction): FederationStatus {
  const targets = FEDERATION_ACTION_MAP[current];
  if (!targets) {
    throw new Error(`No transitions defined for status "${current}"`);
  }
  const next = targets[action];
  if (!next) {
    throw new Error(
      `Action "${action}" is not allowed from status "${current}"; allowed: ${Object.keys(targets).join(", ") || "none"}`,
    );
  }
  return next;
}

// ── Federation Configuration ────────────────────────────────────────────────

/** Create genesis federation config */
export function createFederationConfig(config: {
  name: string;
  description?: string;
  visibility?: FederationVisibility;
}): Federation {
  const now = new Date().toISOString();
  const federationId = sha256Hex(`federation-genesis:${config.name}:${now}:${randomUUID()}`);
  const genesisEventHash = sha256Hex(`genesis:${federationId}:${now}`);

  return {
    federationId,
    genesisEventHash,
    name: config.name,
    description: config.description ?? "",
    visibility: config.visibility ?? "discoverable",
    createdAt: now,
    policyVersion: 1,
    status: "unaware",
  };
}

// ── Role Validation ─────────────────────────────────────────────────────────

/** Validate that a role is a valid federation role */
export function isValidRole(role: string): role is FederationRole {
  return (FEDERATION_ROLES as readonly string[]).includes(role);
}

// ── Membership ──────────────────────────────────────────────────────────────

export type MembershipAction =
  | "invite"
  | "join"
  | "activate"
  | "suspend"
  | "lift_suspension"
  | "leave"
  | "revoke";

/**
 * Valid membership status transitions.
 * From spec: pending → active → suspended → left/revoked
 */
export const VALID_MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  pending: ["active"],
  active: ["suspended", "left", "revoked"],
  suspended: ["active", "left", "revoked"],
  left: [],
  revoked: [],
};

/** Get the default membership status for a new member based on federation visibility */
export function getInitialMembershipStatus(visibility: FederationVisibility): MembershipStatus {
  // Invite-only federations start members as pending (awaiting approval/activation);
  // discoverable/public ones activate immediately.
  if (visibility === "invite_only") {
    return "pending";
  }
  return "active";
}

/** Create a membership record for joining */
export function createMembership(config: {
  federationId: string;
  identityId: string;
  role?: FederationRole;
}): FederationMembership {
  return {
    federationId: config.federationId,
    identityId: config.identityId,
    role: config.role ?? "member",
    joinedAt: new Date().toISOString(),
    expiresAt: null,
    status: "pending",
  };
}

/** Compute the next membership status */
export function getNextMembershipStatus(current: MembershipStatus, action: MembershipAction): MembershipStatus {
  const MEMBERSHIP_ACTION_TABLE: Record<MembershipStatus, Partial<Record<MembershipAction, MembershipStatus>>> = {
    pending: { invite: "pending" as const, join: "active" as const },
    active: { activate: "active" as const, suspend: "suspended" as const, leave: "left" as const, revoke: "revoked" as const },
    suspended: { lift_suspension: "active" as const, leave: "left" as const, revoke: "revoked" as const },
    left: {},
    revoked: {},
  };

  const targets = MEMBERSHIP_ACTION_TABLE[current];
  const next = targets[action];
  if (!next) {
    const allowed = Object.keys(targets).join(", ") || "none";
    throw new Error(
      `Action "${action}" is not allowed from membership status "${current}"; allowed: ${allowed}`,
    );
  }
  return next;
}
