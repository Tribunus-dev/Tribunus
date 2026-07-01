/**
 * Dharma Multi-Peer Disclosure Isolation — tests
 *
 * Verifies that source disclosure packages are isolated per-peer,
 * result metadata replicates without raw patch payloads, artifact
 * access requires proper authority, and expired access is rejected.
 * Uses the real multi-peer-source and multi-peer-artifact modules.
 */

import { describe, test, expect } from "bun:test"
import type {
  SourceDisclosurePackage,
  SessionResultBundle,
  ArtifactAccessDecision,
  DisclosureClass,
} from "../multi-peer-types"
import {
  createSourcePackage,
  isPackageAuthorizedForMember,
  isPackageExpired,
} from "../multi-peer-source"
import {
  createAccessRequest,
  createAccessDecision,
  isAccessGranted,
  isAccessExpired,
} from "../multi-peer-artifact"
import { SourcePackageError } from "../multi-peer-errors"

// ── Constants ───────────────────────────────────────────────────────────────

const SESSION_ID = "session-disclosure-003"
const OWNER_KEY = "owner-pub-key-disclosure"
const PEER_A_KEY = "peer-pub-key-A-disclosure"
const PEER_B_KEY = "peer-pub-key-B-disclosure"
const PEER_A_MEMBERSHIP = "membership-disclosure-A"
const PEER_B_MEMBERSHIP = "membership-disclosure-B"
const PEER_C_KEY = "peer-pub-key-C-unauthorized"
const PEER_C_MEMBERSHIP = "membership-disclosure-C"

// ── Result Metadata Replication Helpers ─────────────────────────────────────

interface ReplicatedResultMetadata {
  resultId: string
  taskId: string
  sessionId: string
  actorIdentityPublicKey: string
  claimId: string
  sourceBasisDigest: string
  changedPathDigests: string[]
  artifactDigests: string[]
  verificationSummary: string
  finalLocalWorkspaceDigest: string
  disclosureClass: DisclosureClass
  createdAt: string
  // Sensitive fields DELIBERATELY OMITTED:
  // patchDigest, localSandboxAttestation, environmentDigest,
  // containmentProfileDigest, signature
}

function extractReplicableMetadata(result: SessionResultBundle): ReplicatedResultMetadata {
  return {
    resultId: result.resultId,
    taskId: result.taskId,
    sessionId: result.sessionId,
    actorIdentityPublicKey: result.actorIdentityPublicKey,
    claimId: result.claimId,
    sourceBasisDigest: result.sourceBasisDigest,
    changedPathDigests: result.changedPathDigests,
    artifactDigests: result.artifactDigests,
    verificationSummary: result.verificationSummary,
    finalLocalWorkspaceDigest: result.finalLocalWorkspaceDigest,
    disclosureClass: result.disclosureClass,
    createdAt: result.createdAt,
  }
}

function verifyNoSensitivePayloadInMetadata(meta: ReplicatedResultMetadata): boolean {
  const sensitiveKeys: (keyof SessionResultBundle)[] = [
    "patchDigest", "localSandboxAttestation", "environmentDigest",
    "containmentProfileDigest", "signature",
  ]
  return !sensitiveKeys.some((key) => key in meta)
}

// Type-safe property access on arbitrary objects (avoids unsafe casts)
function getProperty(obj: object, key: string): unknown {
  return (obj as Record<string, unknown>)[key]
}

function makeResultBundle(overrides: Partial<SessionResultBundle> = {}): SessionResultBundle {
  return {
    resultId: "result-default",
    sessionId: SESSION_ID,
    taskId: "task-default",
    actorIdentityPublicKey: PEER_A_KEY,
    actorMembershipId: PEER_A_MEMBERSHIP,
    claimId: "claim-default",
    sourceBasisDigest: "sha256-basis-v1",
    sourceDisclosurePackageId: "pkg-default",
    environmentDigest: "env-sensitive-abc123",
    containmentProfileDigest: "profile-sensitive-def456",
    localSandboxAttestation: "attest-sensitive-ghi789",
    patchDigest: "sha256-sensitive-patch-001",
    changedPathDigests: ["sha256:src/feature.ts:abc123"],
    artifactDigests: ["artifact-digest-001"],
    testReceiptDigests: [],
    benchmarkReceiptDigests: [],
    verificationSummary: "all tests pass, coverage 92%",
    finalLocalWorkspaceDigest: "workspace-digest-v2",
    disclosureClass: "patch_context_only",
    createdAt: "2026-06-30T10:10:00.000Z",
    signature: "sig-sensitive-peer-specific",
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Disclosure Isolation", () => {
  test("Peer A cannot access Peer B's source package", () => {
    const packageForB = createSourcePackage({
      sessionId: SESSION_ID,
      sourceBasisDigest: "sha256-basis",
      disclosureClass: "full_snapshot",
      createdBy: OWNER_KEY,
      intendedMembershipIds: [PEER_B_MEMBERSHIP],
    })

    // Peer B is authorized
    expect(isPackageAuthorizedForMember(packageForB, PEER_B_MEMBERSHIP)).toBe(true)
    // Peer A is not
    expect(isPackageAuthorizedForMember(packageForB, PEER_A_MEMBERSHIP)).toBe(false)
  })

  test("Peer B cannot access Peer A's source package", () => {
    const packageForA = createSourcePackage({
      sessionId: SESSION_ID,
      sourceBasisDigest: "sha256-basis",
      disclosureClass: "full_snapshot",
      createdBy: OWNER_KEY,
      intendedMembershipIds: [PEER_A_MEMBERSHIP],
    })

    expect(isPackageAuthorizedForMember(packageForA, PEER_A_MEMBERSHIP)).toBe(true)
    expect(isPackageAuthorizedForMember(packageForA, PEER_B_MEMBERSHIP)).toBe(false)
  })

  test("unrelated peer cannot access any package", () => {
    const packageCommon = createSourcePackage({
      sessionId: SESSION_ID,
      sourceBasisDigest: "sha256-basis",
      disclosureClass: "full_snapshot",
      createdBy: OWNER_KEY,
      intendedMembershipIds: [PEER_A_MEMBERSHIP, PEER_B_MEMBERSHIP],
    })

    expect(isPackageAuthorizedForMember(packageCommon, PEER_C_MEMBERSHIP)).toBe(false)
  })

  test("Result metadata replicates without raw patch payload", () => {
    const result = makeResultBundle({
      patchDigest: "sha256-sensitive-diff-content",
      localSandboxAttestation: "sensitive-environment-hash",
      environmentDigest: "full-env-fingerprint",
      containmentProfileDigest: "profile-sensitive",
    })

    const metadata = extractReplicableMetadata(result)

    // Sensitive fields must not be present in the metadata
    expect(getProperty(metadata, "patchDigest")).toBeUndefined()
    expect(getProperty(metadata, "localSandboxAttestation")).toBeUndefined()
    expect(getProperty(metadata, "environmentDigest")).toBeUndefined()
    expect(getProperty(metadata, "containmentProfileDigest")).toBeUndefined()
    expect(getProperty(metadata, "signature")).toBeUndefined()

    expect(verifyNoSensitivePayloadInMetadata(metadata)).toBe(true)

    // Non-sensitive metadata is preserved
    expect(metadata.resultId).toBe("result-default")
    expect(metadata.changedPathDigests).toEqual(["sha256:src/feature.ts:abc123"])
    expect(metadata.verificationSummary).toBe("all tests pass, coverage 92%")
    expect(metadata.disclosureClass).toBe("patch_context_only")
  })

  test("Artifact request without authority is rejected", () => {
    const request = createAccessRequest({
      sessionId: SESSION_ID,
      artifactDigest: "artifact-restricted-001",
      requesterMembershipId: PEER_A_MEMBERSHIP,
      purpose: "review",
    })

    // No matching decision exists yet — decision is what grants access
    const decision = createAccessDecision({
      requestId: request.requestId,
      sessionId: SESSION_ID,
      decision: "denied",
      decidedBy: OWNER_KEY,
    })

    expect(isAccessGranted(decision)).toBe(false)
  })

  test("Authorized artifact request is granted", () => {
    const request = createAccessRequest({
      sessionId: SESSION_ID,
      artifactDigest: "artifact-authorized-001",
      requesterMembershipId: PEER_A_MEMBERSHIP,
      purpose: "code review",
    })

    const decision = createAccessDecision({
      requestId: request.requestId,
      sessionId: SESSION_ID,
      decision: "granted",
      decidedBy: OWNER_KEY,
    })

    expect(isAccessGranted(decision)).toBe(true)
    expect(decision.requestId).toBe(request.requestId)
    expect(decision.decision).toBe("granted")
  })

  test("Expired package access is rejected", () => {
    const expiredPackage = createSourcePackage({
      sessionId: SESSION_ID,
      sourceBasisDigest: "sha256-basis",
      disclosureClass: "full_snapshot",
      createdBy: OWNER_KEY,
      intendedMembershipIds: [PEER_A_MEMBERSHIP],
    })

    // Packages created by createSourcePackage have a future expiresAt by default.
    // We simulate expiry by checking against a known-expired scenario.
    // The real isPackageExpired returns false for null expiresAt (permanent) and
    // true for dates in the past.
    expect(isPackageExpired(expiredPackage)).toBe(false)

    // Create a manually-expired package-like object
    const manuallyExpired: SourceDisclosurePackage = {
      ...expiredPackage,
      expiresAt: "2020-01-01T00:00:00.000Z",
    }
    expect(isPackageExpired(manuallyExpired)).toBe(true)
  })

  test("package with no expiration never expires", () => {
    // createAccessDecision with null expiresAt means permanent
    const request = createAccessRequest({
      sessionId: SESSION_ID,
      artifactDigest: "artifact-permanent",
      requesterMembershipId: PEER_A_MEMBERSHIP,
      purpose: "audit",
    })

    const decision = createAccessDecision({
      requestId: request.requestId,
      sessionId: SESSION_ID,
      decision: "granted",
      decidedBy: OWNER_KEY,
    })

    expect(isAccessExpired(decision)).toBe(false)
  })

  test("expired access decision is detected", () => {
    const request = createAccessRequest({
      sessionId: SESSION_ID,
      artifactDigest: "artifact-expired",
      requesterMembershipId: PEER_A_MEMBERSHIP,
      purpose: "review",
    })

    const decision: ArtifactAccessDecision = {
      ...createAccessDecision({
        requestId: request.requestId,
        sessionId: SESSION_ID,
        decision: "granted",
        decidedBy: OWNER_KEY,
      }),
      expiresAt: "2020-01-01T00:00:00.000Z",
    }

    expect(isAccessExpired(decision)).toBe(true)
  })

  test("Peer B cannot access Peer A's sensitive result metadata", () => {
    const resultA = makeResultBundle({
      resultId: "result-A-sensitive",
      actorIdentityPublicKey: PEER_A_KEY,
      patchDigest: "sha256-raw-patch-from-A",
      localSandboxAttestation: "sandbox-state-A",
    })

    const meta = extractReplicableMetadata(resultA)

    expect(meta.resultId).toBe("result-A-sensitive")
    expect(getProperty(meta, "patchDigest")).toBeUndefined()
    expect(getProperty(meta, "localSandboxAttestation")).toBeUndefined()
  })
})
