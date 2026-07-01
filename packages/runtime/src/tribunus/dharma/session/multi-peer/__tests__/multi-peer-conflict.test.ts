/**
 * Dharma Multi-Peer — Conflict Detection & Resolution Tests
 */

import { describe, test, expect } from "bun:test";
import type {
  SessionResultBundle,
  CanonicalSessionOutcome,
  DharmaTaskContract,
  ClaimStatus,
} from "../multi-peer-types";
import {
  detectConflict,
  checkStaleBasis,
  checkPathOverlap,
  checkClaimViolation,
  createConflictRecord,
  resolveConflict,
} from "../multi-peer-conflict";
import { createFirstOutcome, createNextOutcome } from "../multi-peer-outcome";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeResultBundle(overrides: Partial<SessionResultBundle> = {}): SessionResultBundle {
  return {
    resultId: "result-1",
    sessionId: "session-1",
    taskId: "task-1",
    actorIdentityPublicKey: "actor-1",
    actorMembershipId: "member-1",
    claimId: "claim-1",
    sourceBasisDigest: "canonical-digest-latest",
    sourceDisclosurePackageId: "pkg-1",
    environmentDigest: "env-1",
    containmentProfileDigest: "prof-1",
    localSandboxAttestation: "attest-1",
    patchDigest: null,
    changedPathDigests: ["/path/a", "/path/b"],
    artifactDigests: [],
    testReceiptDigests: [],
    benchmarkReceiptDigests: [],
    verificationSummary: "verified",
    finalLocalWorkspaceDigest: "ws-1",
    disclosureClass: "full_snapshot",
    createdAt: new Date().toISOString(),
    signature: "",
    ...overrides,
  };
}

function makeTask(overrides: Partial<DharmaTaskContract> = {}): DharmaTaskContract {
  return {
    taskId: "task-1",
    sessionId: "session-1",
    createdByIdentityPublicKey: "creator-1",
    title: "Test task",
    summary: "A task for testing",
    taskKind: "feature_implementation",
    parallelism: "exclusive",
    sourceBasisDigest: "source-digest-1",
    sourceDisclosurePackageId: "pkg-1",
    allowedPathScopes: ["/"],
    deniedPathScopes: [],
    expectedArtifactClasses: [],
    verificationContract: "{}",
    acceptancePolicy: "attested",
    requiredCapabilities: [],
    assignedMembershipIds: ["member-1"],
    maxContributors: 1,
    maxResultBundles: 1,
    claimDeadline: null,
    completionDeadline: null,
    status: "available",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    signature: "",
    ...overrides,
  };
}

// ── checkPathOverlap ────────────────────────────────────────────────────────

describe("checkPathOverlap", () => {
  test("detects overlap", () => {
    const result = checkPathOverlap(
      ["/path/a", "/path/b", "/path/c"],
      ["/path/b", "/path/d"],
    );
    expect(result.overlaps).toBe(true);
    expect(result.overlapping).toEqual(["/path/b"]);
  });

  test("returns no overlap when paths are disjoint", () => {
    const result = checkPathOverlap(["/path/a", "/path/b"], ["/path/c", "/path/d"]);
    expect(result.overlaps).toBe(false);
    expect(result.overlapping).toEqual([]);
  });

  test("returns no overlap when proposed paths is empty", () => {
    const result = checkPathOverlap([], ["/path/a"]);
    expect(result.overlaps).toBe(false);
    expect(result.overlapping).toEqual([]);
  });
});

// ── checkStaleBasis ─────────────────────────────────────────────────────────

describe("checkStaleBasis", () => {
  test("returns true when basis differs from current canonical digest", () => {
    const proposal = makeResultBundle({ sourceBasisDigest: "old-digest" });
    expect(checkStaleBasis(proposal, "new-canonical-digest")).toBe(true);
  });

  test("returns false when basis matches current canonical digest", () => {
    const proposal = makeResultBundle({ sourceBasisDigest: "current-digest" });
    expect(checkStaleBasis(proposal, "current-digest")).toBe(false);
  });
});

// ── checkClaimViolation ─────────────────────────────────────────────────────

describe("checkClaimViolation", () => {
  test("returns true when conflicted claim exists", () => {
    const proposal = makeResultBundle();
    expect(checkClaimViolation(proposal, ["conflicted"])).toBe(true);
  });

  test("returns true when superseded claim exists", () => {
    const proposal = makeResultBundle();
    expect(checkClaimViolation(proposal, ["superseded"])).toBe(true);
  });

  test("returns false when no conflict or superseded claims", () => {
    const proposal = makeResultBundle();
    expect(checkClaimViolation(proposal, ["claimed", "in_progress"])).toBe(false);
  });
});

// ── detectConflict ──────────────────────────────────────────────────────────

describe("detectConflict", () => {
  test("returns stale_source_basis when basis is stale", () => {
    const first = createFirstOutcome({
      sessionId: "session-1",
      acceptedResultId: "r1",
      acceptedBy: "a1",
      sourceBasisDigest: "source-1",
      canonicalOutcomeDigest: "canonical-1",
      changedPathDigests: ["/path/a"],
    });

    const proposal = makeResultBundle({ sourceBasisDigest: "old-basis" });
    const task = makeTask();

    const result = detectConflict(proposal, [first], task);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictKind).toBe("stale_source_basis");
  });

  test("returns path_overlap when paths collide with accepted outcomes", () => {
    const first = createFirstOutcome({
      sessionId: "session-1",
      acceptedResultId: "r1",
      acceptedBy: "a1",
      sourceBasisDigest: "source-1",
      canonicalOutcomeDigest: "canonical-1",
      changedPathDigests: ["/path/a", "/shared-path"],
    });

    const proposal = makeResultBundle({
      sourceBasisDigest: "canonical-1", // not stale
      changedPathDigests: ["/path/a", "/path/b"],
    });
    const task = makeTask();

    const result = detectConflict(proposal, [first], task);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictKind).toBe("path_overlap");
    expect(result.overlappingPaths).toContain("/path/a");
  });

  test("returns no conflict when no issues detected", () => {
    const first = createFirstOutcome({
      sessionId: "session-1",
      acceptedResultId: "r1",
      acceptedBy: "a1",
      sourceBasisDigest: "source-1",
      canonicalOutcomeDigest: "canonical-1",
      changedPathDigests: ["/path/a"],
    });

    const proposal = makeResultBundle({
      sourceBasisDigest: "canonical-1",
      changedPathDigests: ["/path/c", "/path/d"],
    });
    const task = makeTask();

    const result = detectConflict(proposal, [first], task);
    expect(result.hasConflict).toBe(false);
    expect(result.conflictKind).toBeNull();
    expect(result.overlappingPaths).toEqual([]);
  });

  test("returns no conflict when there are no accepted outcomes yet", () => {
    const proposal = makeResultBundle();
    const task = makeTask();

    const result = detectConflict(proposal, [], task);
    expect(result.hasConflict).toBe(false);
    expect(result.conflictKind).toBeNull();
  });
});

// ── createConflictRecord ────────────────────────────────────────────────────

describe("createConflictRecord", () => {
  test("creates a conflict record with open state", () => {
    const conflict = createConflictRecord({
      sessionId: "session-1",
      taskId: "task-1",
      proposedResultId: "result-1",
      conflictingResultId: "result-0",
      conflictKind: "path_overlap",
      baseDigest: "old-digest",
      currentCanonicalDigest: "canonical-1",
      overlappingPaths: ["/path/a"],
    });

    expect(conflict.conflictId).toBeTruthy();
    expect(typeof conflict.conflictId).toBe("string");
    expect(conflict.sessionId).toBe("session-1");
    expect(conflict.taskId).toBe("task-1");
    expect(conflict.proposedResultId).toBe("result-1");
    expect(conflict.conflictingResultId).toBe("result-0");
    expect(conflict.conflictKind).toBe("path_overlap");
    expect(conflict.baseDigest).toBe("old-digest");
    expect(conflict.currentCanonicalDigest).toBe("canonical-1");
    expect(conflict.overlappingPaths).toEqual(["/path/a"]);
    expect(conflict.resolutionState).toBe("open");
    expect(conflict.resolutionResultId).toBeNull();
    expect(conflict.resolvedByIdentityPublicKey).toBeNull();
    expect(conflict.resolvedAt).toBeNull();
  });

  test("sets conflictingResultId to null when not provided", () => {
    const conflict = createConflictRecord({
      sessionId: "session-1",
      taskId: "task-1",
      proposedResultId: "result-1",
      conflictKind: "stale_source_basis",
      baseDigest: "old",
      currentCanonicalDigest: "new",
    });
    expect(conflict.conflictingResultId).toBeNull();
  });
});

// ── resolveConflict ─────────────────────────────────────────────────────────

describe("resolveConflict", () => {
  const baseConflict = createConflictRecord({
    sessionId: "s1",
    taskId: "t1",
    proposedResultId: "r1",
    conflictKind: "path_overlap",
    baseDigest: "old",
    currentCanonicalDigest: "new",
  });

  test("rejects an open conflict → rejected", () => {
    const resolved = resolveConflict(baseConflict, "reject");
    expect(resolved.resolutionState).toBe("rejected");
  });

  test("rebases an open conflict → rebase_requested", () => {
    const resolved = resolveConflict(baseConflict, "rebase");
    expect(resolved.resolutionState).toBe("rebase_requested");
  });

  test("resolves an open conflict → resolved", () => {
    const resolved = resolveConflict(baseConflict, "resolve");
    expect(resolved.resolutionState).toBe("resolved");
  });

  test("resolved conflict sets resolvedAt", () => {
    const resolved = resolveConflict(baseConflict, "resolve");
    expect(resolved.resolvedAt).not.toBeNull();
  });

  test("rejected conflict does not set resolvedAt", () => {
    const resolved = resolveConflict(baseConflict, "reject");
    expect(resolved.resolvedAt).toBeNull();
  });

  test("throws on invalid transition from resolved state", () => {
    const resolved = resolveConflict(baseConflict, "resolve");
    expect(() => resolveConflict(resolved, "reject")).toThrow(/Cannot transition/);
  });

  test("throws on invalid transition from rejected state", () => {
    const rejected = resolveConflict(baseConflict, "reject");
    expect(() => resolveConflict(rejected, "resolve")).toThrow(/Cannot transition/);
  });

  test("allows rebase → resolve", () => {
    const rebased = resolveConflict(baseConflict, "rebase");
    const resolved = resolveConflict(rebased, "resolve");
    expect(resolved.resolutionState).toBe("resolved");
  });

  test("allows rebase → reject", () => {
    const rebased = resolveConflict(baseConflict, "rebase");
    const rejected = resolveConflict(rebased, "reject");
    expect(rejected.resolutionState).toBe("rejected");
  });

  test("does not mutate original conflict (immutability)", () => {
    const original = { ...baseConflict };
    resolveConflict(baseConflict, "resolve");
    expect(baseConflict.resolutionState).toBe(original.resolutionState);
  });
});
