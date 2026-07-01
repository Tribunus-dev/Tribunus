/**
 * Session Controller Tests
 */

import { describe, test, expect } from "bun:test"
import type {
  DharmaSession,
  SessionCommandRequest,
  SessionAuthorityGrant,
  SessionMember,
  ResourceScope,
  SessionCommandReceipt,
} from "../types"
import {
  evaluateCommandAuthority,
  checkScope,
  createRejectionReceipt,
  createAcceptanceReceipt,
  computeAuthorityDigest,
  type SessionContext,
} from "../session-controller"
import { ALL_CAPABILITIES } from "../types"

// ── Test Helpers -------------------------------------------------------------

function makeSession(overrides: Partial<DharmaSession> = {}): DharmaSession {
  return {
    sessionId: "session-1",
    federationId: "fed-1",
    ownerIdentityPublicKey: "owner-key-1",
    ownerDeviceId: null,
    projectReference: "proj-1",
    sourceRevision: "abc123",
    sourceTreeDigest: "tree-digest-1",
    sourceManifestDigest: null,
    sandboxRuntimeKind: "node",
    sandboxImageDigest: null,
    sandboxPolicyDigest: null,
    collaborationPolicyDigest: null,
    disclosurePolicyDigest: null,
    lifecycleState: "active",
    visibility: "private",
    createdAt: "2025-01-01T00:00:00Z",
    activatedAt: null,
    sealedAt: null,
    expiresAt: null,
    sessionKeyEpoch: 1,
    predecessorSessionId: null,
    successorSessionId: null,
    ...overrides,
  }
}

function makeMember(overrides: Partial<SessionMember> = {}): SessionMember {
  return {
    membershipId: "member-1",
    sessionId: "session-1",
    peerIdentityPublicKey: "peer-key-1",
    peerDeviceId: null,
    invitedByIdentityPublicKey: "owner-key-1",
    displayRole: "contributor",
    status: "active",
    joinedAt: "2025-01-01T00:00:00Z",
    suspendedAt: null,
    removedAt: null,
    lastSeenAt: null,
    currentKeyEpoch: 1,
    ...overrides,
  }
}

function makeGrant(overrides: Partial<SessionAuthorityGrant> = {}): SessionAuthorityGrant {
  return {
    grantId: "grant-1",
    sessionId: "session-1",
    subjectIdentityPublicKey: "peer-key-1",
    subjectMembershipId: "member-1",
    issuedByIdentityPublicKey: "owner-key-1",
    issuedByGrantId: null,
    capabilitySet: ["workspace.read", "workspace.write", "session.inspect"],
    resourceScope: makeScope(),
    executionConstraints: null,
    disclosureScope: null,
    approvalPolicy: null,
    delegationPolicy: null,
    issuedAt: "2025-01-01T00:00:00Z",
    expiresAt: null,
    revokedAt: null,
    revocationReason: null,
    sessionKeyEpoch: 1,
    signature: "sig-1",
    ...overrides,
  }
}

function makeScope(overrides: Partial<ResourceScope> = {}): ResourceScope {
  return {
    allowedPaths: ["/**"],
    deniedPaths: [],
    allowedFileExtensions: [],
    deniedFileExtensions: [],
    allowedCommands: [""],
    deniedCommands: [],
    allowedNetworkDomains: [],
    deniedNetworkDomains: [],
    allowedEnvironmentVariables: [],
    deniedEnvironmentVariables: [],
    maximumRuntimeSeconds: 3600,
    maximumCpuSeconds: 3600,
    maximumMemoryBytes: 1073741824,
    maximumDiskWriteBytes: 1073741824,
    maximumProcessCount: 100,
    maximumOutputBytes: 10485760,
    maximumComputeTokens: null,
    maximumComputeCost: null,
    ...overrides,
  }
}

function makeRequest(overrides: Partial<SessionCommandRequest> = {}): SessionCommandRequest {
  return {
    requestId: "req-1",
    sessionId: "session-1",
    actorIdentityPublicKey: "peer-key-1",
    actorMembershipId: "member-1",
    grantId: "grant-1",
    sessionKeyEpoch: 1,
    commandKind: "read_file",
    targetScope: "/src/main.ts",
    payloadDigest: "payload-digest-1",
    payloadReference: null,
    idempotencyKey: "idem-1",
    requestedAt: "2025-01-01T00:01:00Z",
    signature: "req-sig-1",
    ...overrides,
  }
}

function makeContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    session: makeSession(),
    members: [makeMember()],
    grants: [makeGrant()],
    currentKeyEpoch: 1,
    ...overrides,
  }
}

// ── Tests --------------------------------------------------------------------

describe("evaluateCommandAuthority", () => {
  test("valid request is accepted", () => {
    const context = makeContext()
    const request = makeRequest()

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("accepted")
    expect(result.reason).toBeNull()
    expect(result.evaluationDigest).toBeTruthy()
  })

  test("inactive session is rejected", () => {
    const context = makeContext({
      session: makeSession({ lifecycleState: "draft" }),
    })
    const request = makeRequest()

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("draft")
    expect(result.evaluationDigest).toBeTruthy()
  })

  test("draining session rejects new commands", () => {
    const context = makeContext({
      session: makeSession({ lifecycleState: "draining" }),
    })
    const request = makeRequest()

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("draining")
  })

  test("terminal state session rejects commands", () => {
    const context = makeContext({
      session: makeSession({ lifecycleState: "sealed" }),
    })
    const request = makeRequest()

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("terminal")
  })

  test("member not active is rejected", () => {
    const context = makeContext({
      members: [makeMember({ status: "suspended" })],
    })
    const request = makeRequest()

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("not active")
  })

  test("member not found is rejected", () => {
    const context = makeContext()
    const request = makeRequest({ actorMembershipId: "nonexistent" })

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("not found")
  })

  test("wrong key epoch is rejected", () => {
    const context = makeContext({ currentKeyEpoch: 2 })
    const request = makeRequest({ sessionKeyEpoch: 1 })

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("epoch mismatch")
  })

  test("expired grant is rejected", () => {
    const context = makeContext({
      grants: [
        makeGrant({
          expiresAt: "2020-01-01T00:00:00Z",
        }),
      ],
    })
    const request = makeRequest()

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("expired")
  })

  test("revoked grant is rejected", () => {
    const context = makeContext({
      grants: [
        makeGrant({
          revokedAt: "2025-06-01T00:00:00Z",
          revocationReason: "Misuse",
        }),
      ],
    })
    const request = makeRequest()

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("revoked")
  })

  test("grant not found is rejected", () => {
    const context = makeContext()
    const request = makeRequest({ grantId: "nonexistent" })

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("not found")
  })

  test("missing capability is rejected", () => {
    const context = makeContext({
      grants: [
        makeGrant({ capabilitySet: ["session.inspect"] }),
      ],
    })
    // read_file requires workspace.read
    const request = makeRequest({ commandKind: "read_file" })

    const result = evaluateCommandAuthority(context, request)

    expect(result.decision).toBe("rejected")
    expect(result.reason).toContain("workspace.read")
  })
})

describe("checkScope", () => {
  test("valid scope is allowed", () => {
    const grant = makeGrant({
      resourceScope: makeScope({
        allowedPaths: ["/src/**"],
      }),
    })
    const request = makeRequest({ targetScope: "/src/main.ts" })

    const result = checkScope(grant, request)

    expect(result.allowed).toBe(true)
  })

  test("denied path is rejected", () => {
    const grant = makeGrant({
      resourceScope: makeScope({
        allowedPaths: ["/src/**"],
        deniedPaths: ["/src/secret/**"],
      }),
    })
    const request = makeRequest({ targetScope: "/src/secret/keys.ts" })

    const result = checkScope(grant, request)

    expect(result.allowed).toBe(false)
  })

  test("path not in allowed paths is rejected", () => {
    const grant = makeGrant({
      resourceScope: makeScope({
        allowedPaths: ["/public/**"],
      }),
    })
    const request = makeRequest({ targetScope: "/private/data.ts" })

    const result = checkScope(grant, request)

    expect(result.allowed).toBe(false)
  })

  test("command with no scope constraints is allowed", () => {
    const grant = makeGrant()
    const request = makeRequest({ commandKind: "seal_session" })

    const result = checkScope(grant, request)

    expect(result.allowed).toBe(true)
  })
})

describe("createRejectionReceipt", () => {
  test("creates receipt with rejection decision", () => {
    const request = makeRequest()
    const reason = "Capability denied"

    const receipt = createRejectionReceipt(request, reason)

    expect(receipt.receiptId).toBeTruthy()
    expect(receipt.requestId).toBe("req-1")
    expect(receipt.decision).toBe("rejected")
    expect(receipt.denialReason).toBe(reason)
  })
})

describe("createAcceptanceReceipt", () => {
  test("creates receipt with acceptance decision", () => {
    const request = makeRequest()

    const receipt = createAcceptanceReceipt(request)

    expect(receipt.receiptId).toBeTruthy()
    expect(receipt.requestId).toBe("req-1")
    expect(receipt.decision).toBe("accepted")
    expect(receipt.denialReason).toBeNull()
  })
})

describe("computeAuthorityDigest", () => {
  test("produces non-empty string", () => {
    const context = makeContext()

    const digest = computeAuthorityDigest(context)

    expect(digest).toBeTruthy()
    expect(typeof digest).toBe("string")
    expect(digest.length).toBeGreaterThan(0)
  })

  test("different context produces different digest", () => {
    const context1 = makeContext({ currentKeyEpoch: 1 })
    const context2 = makeContext({ currentKeyEpoch: 2 })

    const digest1 = computeAuthorityDigest(context1)
    const digest2 = computeAuthorityDigest(context2)

    expect(digest1).not.toBe(digest2)
  })
})

describe("getEffectiveGrantsForMember", () => {
  test("returns valid grants for the member", () => {
    const { getEffectiveGrantsForMember } = require("../session-controller")
    const context = makeContext()
    const grants = getEffectiveGrantsForMember(context, "peer-key-1")

    expect(grants.length).toBe(1)
    expect(grants[0].grantId).toBe("grant-1")
  })

  test("excludes revoked grants", () => {
    const { getEffectiveGrantsForMember } = require("../session-controller")
    const context = makeContext({
      grants: [
        makeGrant({ revokedAt: "2025-06-01T00:00:00Z" }),
      ],
    })
    const grants = getEffectiveGrantsForMember(context, "peer-key-1")

    expect(grants.length).toBe(0)
  })

  test("excludes expired grants", () => {
    const { getEffectiveGrantsForMember } = require("../session-controller")
    const context = makeContext({
      grants: [
        makeGrant({ expiresAt: "2020-01-01T00:00:00Z" }),
      ],
    })
    const grants = getEffectiveGrantsForMember(context, "peer-key-1")

    expect(grants.length).toBe(0)
  })

  test("returns only grants for the specified member", () => {
    const { getEffectiveGrantsForMember } = require("../session-controller")
    const context = makeContext()
    const grants = getEffectiveGrantsForMember(context, "other-key")

    expect(grants.length).toBe(0)
  })
})
