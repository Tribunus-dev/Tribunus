/**
 * Tests for Dharma Multi-Peer Result Bundle Validation Pipeline
 */

import { describe, it, expect } from "bun:test"
import type { DharmaTaskContract, SessionResultBundle } from "../multi-peer-types"
import {
  validateResultBundle,
  checkSourceBasis,
  checkPathScope,
  checkContainmentProfile,
  checkVerificationPolicy,
} from "../multi-peer-validation"
import type { AcceptancePolicyLevel } from "../multi-peer-types"

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides?: Partial<DharmaTaskContract>): DharmaTaskContract {
  return {
    taskId: "task-001",
    sessionId: "session-001",
    createdByIdentityPublicKey: "pk-owner",
    title: "Test task",
    summary: "",
    taskKind: "bug_fix",
    parallelism: "exclusive",
    sourceBasisDigest: "abc123def456",
    sourceDisclosurePackageId: null,
    allowedPathScopes: [],
    deniedPathScopes: [],
    expectedArtifactClasses: [],
    verificationContract: "default",
    acceptancePolicy: "attested",
    requiredCapabilities: [],
    assignedMembershipIds: [],
    maxContributors: 1,
    maxResultBundles: 10,
    claimDeadline: null,
    completionDeadline: null,
    status: "available",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    signature: "",
    ...overrides,
  }
}

function makeResult(overrides?: Partial<SessionResultBundle>): SessionResultBundle {
  return {
    resultId: "result-001",
    sessionId: "session-001",
    taskId: "task-001",
    actorIdentityPublicKey: "pk-alice",
    actorMembershipId: "mem-alice",
    claimId: "claim-001",
    sourceBasisDigest: "abc123def456",
    sourceDisclosurePackageId: "pkg-001",
    environmentDigest: "env-digest-1",
    containmentProfileDigest: "profile-digest-1",
    localSandboxAttestation: "attestation-1",
    patchDigest: "patch-digest-1",
    changedPathDigests: ["src/login.ts", "src/auth.ts"],
    artifactDigests: ["artifact-1"],
    testReceiptDigests: ["test-receipt-1"],
    benchmarkReceiptDigests: [],
    verificationSummary: "attested",
    finalLocalWorkspaceDigest: "workspace-digest-1",
    disclosureClass: "patch_context_only",
    createdAt: "2026-06-15T12:00:00Z",
    signature: "sig-001",
    ...overrides,
  }
}

// ── validateResultBundle ───────────────────────────────────────────────────

describe("validateResultBundle", () => {
  it("returns verified for matching result and task", () => {
    const task = makeTask()
    const result = makeResult()
    const outcome = validateResultBundle(result, task)
    expect(outcome.state).toBe("verified")
    expect(outcome.reason).toBeNull()
  })

  it("returns conflicted when source basis mismatches", () => {
    const task = makeTask({ sourceBasisDigest: "required-basis" })
    const result = makeResult({ sourceBasisDigest: "wrong-basis" })
    const outcome = validateResultBundle(result, task)
    expect(outcome.state).toBe("conflicted")
    expect(outcome.reason).toContain("Source basis")
  })

  it("returns rejected when changed paths violate scope", () => {
    const task = makeTask({
      allowedPathScopes: ["src/components/"],
    })
    const result = makeResult({
      changedPathDigests: ["src/lib/util.ts"],
    })
    const outcome = validateResultBundle(result, task)
    expect(outcome.state).toBe("rejected")
    expect(outcome.reason).toContain("path")
  })

  it("returns pending_verification when verification summary is insufficient", () => {
    const task = makeTask({ acceptancePolicy: "reviewed" })
    const result = makeResult({ verificationSummary: "attested" })
    const outcome = validateResultBundle(result, task)
    expect(outcome.state).toBe("pending_verification")
    expect(outcome.reason).toContain("Verification summary")
  })

  it("passes when paths are within allowed scopes", () => {
    const task = makeTask({
      allowedPathScopes: ["src/"],
    })
    const result = makeResult({
      changedPathDigests: ["src/components/Button.tsx", "src/utils/helpers.ts"],
    })
    const outcome = validateResultBundle(result, task)
    expect(outcome.state).toBe("verified")
  })

  it("passes when no scopes are configured", () => {
    const task = makeTask({ allowedPathScopes: [], deniedPathScopes: [] })
    const result = makeResult()
    const outcome = validateResultBundle(result, task)
    expect(outcome.state).toBe("verified")
  })
})

// ── checkSourceBasis ───────────────────────────────────────────────────────

describe("checkSourceBasis", () => {
  it("returns true when digests match", () => {
    const result = makeResult({ sourceBasisDigest: "abc" })
    const task = makeTask({ sourceBasisDigest: "abc" })
    expect(checkSourceBasis(result, task)).toBe(true)
  })

  it("returns false when digests differ", () => {
    const result = makeResult({ sourceBasisDigest: "abc" })
    const task = makeTask({ sourceBasisDigest: "xyz" })
    expect(checkSourceBasis(result, task)).toBe(false)
  })
})

// ── checkPathScope ─────────────────────────────────────────────────────────

describe("checkPathScope", () => {
  it("returns empty when no scopes are defined", () => {
    expect(checkPathScope(["etc/passwd"], [], [])).toEqual([])
  })

  it("allows paths matching an allowed scope", () => {
    const violations = checkPathScope(["src/main.ts", "src/utils/helper.ts"], ["src/"], [])
    expect(violations).toEqual([])
  })

  it("rejects paths outside allowed scopes", () => {
    const violations = checkPathScope(["src/main.ts", "tests/test.ts"], ["src/"], [])
    expect(violations).toEqual(["tests/test.ts"])
  })

  it("rejects paths matching a denied scope", () => {
    const violations = checkPathScope(
      ["src/good.ts", "node_modules/bad.js", "dist/out.js"],
      ["src/"],
      ["node_modules/", "dist/"],
    )
    expect(violations).toEqual(["node_modules/bad.js", "dist/out.js"])
  })

  it("rejects paths that fail both allowed and denied checks", () => {
    const violations = checkPathScope(
      ["node_modules/evil.js"],
      ["src/"],
      ["node_modules/"],
    )
    expect(violations).toEqual(["node_modules/evil.js"])
  })

  it("rejects paths in denied scope even without allowed scope", () => {
    const violations = checkPathScope(["src/main.ts", "node_modules/pkg/index.js"], [], ["node_modules/"])
    expect(violations).toEqual(["node_modules/pkg/index.js"])
  })

  it("rejects each violating path independently", () => {
    const violations = checkPathScope(["src/ok.ts", "bad.ts", "src/also-ok.js"], ["src/"], [])
    expect(violations).toEqual(["bad.ts"])
  })

  it("returns multiple violations", () => {
    const violations = checkPathScope(["bad/a", "worse/b", "src/good.ts"], ["src/"], [])
    expect(violations).toEqual(["bad/a", "worse/b"])
  })
})

// ── checkContainmentProfile ─────────────────────────────────────────────────

describe("checkContainmentProfile", () => {
  it("returns true when no capabilities are required", () => {
    expect(checkContainmentProfile("", [])).toBe(true)
    expect(checkContainmentProfile("profile-digest", [])).toBe(true)
  })

  it("returns false when required capabilities exist but profile is empty", () => {
    expect(checkContainmentProfile("", ["network"])).toBe(false)
  })

  it("returns true when profile digest is provided and capabilities are required", () => {
    expect(checkContainmentProfile("profile-digest", ["network"])).toBe(true)
  })
})

// ── checkVerificationPolicy ────────────────────────────────────────────────

describe("checkVerificationPolicy", () => {
  it("returns true when summary meets required level exactly", () => {
    expect(checkVerificationPolicy("attested", "attested")).toBe(true)
    expect(checkVerificationPolicy("reviewed", "reviewed")).toBe(true)
    expect(checkVerificationPolicy("reproduced", "reproduced")).toBe(true)
    expect(checkVerificationPolicy("corroborated", "corroborated")).toBe(true)
  })

  it("returns true when summary exceeds required level", () => {
    expect(checkVerificationPolicy("corroborated", "attested")).toBe(true)
    expect(checkVerificationPolicy("corroborated", "reviewed")).toBe(true)
    expect(checkVerificationPolicy("reproduced", "attested")).toBe(true)
  })

  it("returns false when summary is below required level", () => {
    expect(checkVerificationPolicy("attested", "reviewed")).toBe(false)
    expect(checkVerificationPolicy("reviewed", "reproduced")).toBe(false)
    expect(checkVerificationPolicy("reproduced", "corroborated")).toBe(false)
  })

  it("returns false for empty summary", () => {
    expect(checkVerificationPolicy("", "attested")).toBe(false)
  })

  it("returns false for unrecognized summary text", () => {
    expect(checkVerificationPolicy("unknown verification result", "attested")).toBe(false)
  })

  it("finds the highest matching level in compound summary text", () => {
    // Summary claims multiple levels; should pick the strongest
    expect(checkVerificationPolicy("attested and reviewed result", "reviewed")).toBe(true)
    expect(checkVerificationPolicy("reviewed and reproduced", "reproduced")).toBe(true)
  })

  it("does not match partial substrings incorrectly", () => {
    // "attr" should NOT match "attested"
    expect(checkVerificationPolicy("attr summary", "attested")).toBe(false)
    // "repro" should NOT match "reproduced"
    expect(checkVerificationPolicy("repro summary", "reproduced")).toBe(false)
  })
})
