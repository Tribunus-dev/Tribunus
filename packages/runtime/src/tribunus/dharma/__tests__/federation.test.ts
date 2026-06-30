/**
 * Dharma Federation Runtime — Federation State Machine Tests
 */

import { describe, test, expect } from "bun:test";
import {
  isValidTransition,
  getNextStatus,
  createFederationConfig,
  isValidRole,
  getInitialMembershipStatus,
  createMembership,
  getNextMembershipStatus,
} from "../federation";
import type { FederationStatus, FederationVisibility } from "../types";

// ── Federation Status Transitions ───────────────────────────────────────────

describe("Federation status transitions", () => {
  test("valid forward transition: unaware → discovered → invited → joining → active", () => {
    const path: FederationStatus[] = ["unaware", "discovered", "invited", "joining", "active"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  test("invalid transition: unaware → active (skips steps)", () => {
    expect(isValidTransition("unaware", "active")).toBe(false);
  });

  test("invalid transition: active → joining (backwards)", () => {
    expect(isValidTransition("active", "joining")).toBe(false);
  });

  test("getNextStatus maps actions correctly", () => {
    expect(getNextStatus("unaware", "discover")).toBe("discovered");
    expect(getNextStatus("discovered", "invite")).toBe("invited");
    expect(getNextStatus("invited", "join")).toBe("joining");
    expect(getNextStatus("joining", "approve")).toBe("active");
    expect(getNextStatus("active", "suspend")).toBe("suspended");
    expect(getNextStatus("suspended", "lift_suspension")).toBe("active");
    expect(getNextStatus("active", "leave")).toBe("left");
    expect(getNextStatus("active", "revoke")).toBe("revoked");
  });

  test("getNextStatus throws for invalid action from current status", () => {
    expect(() => getNextStatus("unaware", "activate")).toThrow();
    expect(() => getNextStatus("left", "leave")).toThrow();
  });
});

// ── Role Validation ─────────────────────────────────────────────────────────

describe("isValidRole", () => {
  test("returns true for known roles", () => {
    expect(isValidRole("member")).toBe(true);
    expect(isValidRole("contributor")).toBe(true);
    expect(isValidRole("reviewer")).toBe(true);
    expect(isValidRole("moderator")).toBe(true);
    expect(isValidRole("steward")).toBe(true);
    expect(isValidRole("observer")).toBe(true);
  });

  test("returns false for 'admin' string", () => {
    expect(isValidRole("admin")).toBe(false);
  });

  test("returns false for arbitrary string", () => {
    expect(isValidRole("not-a-role")).toBe(false);
  });
});

// ── Federation Config ───────────────────────────────────────────────────────

describe("createFederationConfig", () => {
  test("generates genesis config with default values", () => {
    const fed = createFederationConfig({ name: "Test Federation" });

    expect(fed.name).toBe("Test Federation");
    expect(fed.federationId).toBeTruthy();
    expect(typeof fed.federationId).toBe("string");
    expect(fed.genesisEventHash).toBeTruthy();
    expect(fed.description).toBe("");
    expect(fed.visibility).toBe("discoverable");
    expect(fed.policyVersion).toBe(1);
    expect(fed.status).toBe("unaware");
    expect(fed.createdAt).toBeTruthy();
  });

  test("accepts custom description and visibility", () => {
    const fed = createFederationConfig({
      name: "Private Fed",
      description: "A private test federation",
      visibility: "invite_only",
    });

    expect(fed.name).toBe("Private Fed");
    expect(fed.description).toBe("A private test federation");
    expect(fed.visibility).toBe("invite_only");
  });
});

// ── Membership ──────────────────────────────────────────────────────────────

describe("Membership", () => {
  test("getInitialMembershipStatus returns pending for invite_only", () => {
    expect(getInitialMembershipStatus("invite_only")).toBe("pending");
  });

  test("getInitialMembershipStatus returns active for discoverable", () => {
    expect(getInitialMembershipStatus("discoverable")).toBe("active");
  });

  test("getInitialMembershipStatus returns active for private", () => {
    expect(getInitialMembershipStatus("private")).toBe("active");
  });

  test("createMembership sets default role and pending status", () => {
    const m = createMembership({
      federationId: "fed-1",
      identityId: "identity-1",
    });

    expect(m.federationId).toBe("fed-1");
    expect(m.identityId).toBe("identity-1");
    expect(m.role).toBe("member");
    expect(m.status).toBe("pending");
    expect(m.expiresAt).toBeNull();
    expect(m.joinedAt).toBeTruthy();
  });

  test("createMembership accepts custom role", () => {
    const m = createMembership({
      federationId: "fed-1",
      identityId: "identity-2",
      role: "steward",
    });

    expect(m.role).toBe("steward");
  });

  test("getNextMembershipStatus: pending → active via join", () => {
    expect(getNextMembershipStatus("pending", "join")).toBe("active");
  });

  test("getNextMembershipStatus: active → suspended via suspend", () => {
    expect(getNextMembershipStatus("active", "suspend")).toBe("suspended");
  });

  test("getNextMembershipStatus throws for invalid action", () => {
    expect(() => getNextMembershipStatus("pending", "revoke")).toThrow();
  });
});
