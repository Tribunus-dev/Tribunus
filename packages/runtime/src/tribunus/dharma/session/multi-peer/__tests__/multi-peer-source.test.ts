/**
 * Dharma Multi-Peer — Source Disclosure Package Tests
 */

import { describe, test, expect } from "bun:test";
import type { DisclosureClass } from "../multi-peer-types";
import {
  createSourcePackage,
  isPackageAuthorizedForMember,
  getPackageScope,
  isPackageExpired,
} from "../multi-peer-source";

// ── createSourcePackage ─────────────────────────────────────────────────────

describe("createSourcePackage", () => {
  const baseConfig = {
    sessionId: "session-1",
    sourceBasisDigest: "abc123",
    disclosureClass: "full_snapshot" as DisclosureClass,
    createdBy: "member-key-1",
  };

  test("sets all required fields with defaults", () => {
    const pkg = createSourcePackage(baseConfig);

    expect(pkg.packageId).toBeTruthy();
    expect(typeof pkg.packageId).toBe("string");
    expect(pkg.sessionId).toBe("session-1");
    expect(pkg.sourceBasisDigest).toBe("abc123");
    expect(pkg.disclosureClass).toBe("full_snapshot");
    expect(pkg.createdByIdentityPublicKey).toBe("member-key-1");

    expect(pkg.packageManifestDigest).toBe("");
    expect(pkg.encryptedPayloadReference).toBeNull();
    expect(pkg.artifactReferences).toEqual([]);
    expect(pkg.intendedMembershipIds).toEqual([]);
    expect(pkg.signature).toBe("");
  });

  test("defaults sourceScope based on disclosure class", () => {
    const classScopeMap: [DisclosureClass, string][] = [
      ["full_snapshot", "/"],
      ["subtree_snapshot", "/src"],
      ["task_fixture_bundle", "/test"],
      ["patch_context_only", "/src"],
      ["generated_reproduction_bundle", "/test/reproduction"],
      ["opaque_artifact_reference", ""],
    ];

    for (const [cls, expectedScope] of classScopeMap) {
      const pkg = createSourcePackage({ ...baseConfig, disclosureClass: cls });
      expect(pkg.sourceScope).toBe(expectedScope);
    }
  });

  test("respects explicit sourceScope", () => {
    const pkg = createSourcePackage({
      ...baseConfig,
      sourceScope: "/custom/scope",
    });
    expect(pkg.sourceScope).toBe("/custom/scope");
  });

  test("sets intendedMembershipIds when provided", () => {
    const ids = ["member-1", "member-2"];
    const pkg = createSourcePackage({ ...baseConfig, intendedMembershipIds: ids });
    expect(pkg.intendedMembershipIds).toEqual(ids);
  });

  test("opaque_artifact_reference has null expiresAt", () => {
    const pkg = createSourcePackage({
      ...baseConfig,
      disclosureClass: "opaque_artifact_reference",
    });
    expect(pkg.expiresAt).toBeNull();
  });

  test("non-opaque packages have a future expiresAt", () => {
    const pkg = createSourcePackage(baseConfig);
    expect(pkg.expiresAt).not.toBeNull();
    const expiryTime = new Date(pkg.expiresAt!).getTime();
    expect(expiryTime).toBeGreaterThan(Date.now());
  });
});

// ── isPackageAuthorizedForMember ─────────────────────────────────────────────

describe("isPackageAuthorizedForMember", () => {
  const basePkg = createSourcePackage({
    sessionId: "session-1",
    sourceBasisDigest: "abc",
    disclosureClass: "full_snapshot",
    createdBy: "owner",
  });

  test("authorizes all members when intendedMembershipIds is empty", () => {
    expect(isPackageAuthorizedForMember(basePkg, "anyone")).toBe(true);
  });

  test("authorizes only intended members when list is non-empty", () => {
    const pkg = createSourcePackage({
      sessionId: "session-1",
      sourceBasisDigest: "abc",
      disclosureClass: "full_snapshot",
      createdBy: "owner",
      intendedMembershipIds: ["alice", "bob"],
    });

    expect(isPackageAuthorizedForMember(pkg, "alice")).toBe(true);
    expect(isPackageAuthorizedForMember(pkg, "bob")).toBe(true);
    expect(isPackageAuthorizedForMember(pkg, "charlie")).toBe(false);
  });
});

// ── getPackageScope ──────────────────────────────────────────────────────────

describe("getPackageScope", () => {
  test("returns the sourceScope of the package", () => {
    const pkg = createSourcePackage({
      sessionId: "s1",
      sourceBasisDigest: "abc",
      disclosureClass: "full_snapshot",
      createdBy: "owner",
      sourceScope: "/my/scope",
    });
    expect(getPackageScope(pkg)).toBe("/my/scope");
  });
});

// ── isPackageExpired ─────────────────────────────────────────────────────────

describe("isPackageExpired", () => {
  test("returns false when expiresAt is null", () => {
    const pkg = createSourcePackage({
      sessionId: "s1",
      sourceBasisDigest: "abc",
      disclosureClass: "opaque_artifact_reference",
      createdBy: "owner",
    });
    expect(pkg.expiresAt).toBeNull();
    expect(isPackageExpired(pkg)).toBe(false);
  });

  test("returns false when expiry is in the future", () => {
    const pkg = createSourcePackage({
      sessionId: "s1",
      sourceBasisDigest: "abc",
      disclosureClass: "full_snapshot",
      createdBy: "owner",
    });
    expect(isPackageExpired(pkg)).toBe(false);
  });

  test("returns true when expiry is in the past", () => {
    const pkg = createSourcePackage({
      sessionId: "s1",
      sourceBasisDigest: "abc",
      disclosureClass: "full_snapshot",
      createdBy: "owner",
    });
    // Override expiresAt to the past
    const expiredPkg = { ...pkg, expiresAt: "2020-01-01T00:00:00.000Z" };
    expect(isPackageExpired(expiredPkg)).toBe(true);
  });
});
