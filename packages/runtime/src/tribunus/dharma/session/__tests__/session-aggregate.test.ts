/**
 * Session Aggregate Tests
 */

import { describe, test, expect } from "bun:test"
import type {
  DharmaSession,
  DharmaSessionAggregate,
  SessionAuthorityGrant,
  SessionCommandReceipt,
  WorkspaceMutation,
  ComputeLease,
  SessionMember,
} from "../types"
import {
  createSessionAggregate,
  computeAuthorityTopologyDigest,
  computeCollaborationTimelineSummary,
  computeParticipantRoleSummary,
  verifyAggregateDisclosure,
  isAggregateReadyForIngestion,
} from "../session-aggregate"

// ── Test Helpers -------------------------------------------------------------

function makeSession(overrides: Partial<DharmaSession> = {}): DharmaSession {
  return {
    sessionId: "session-1",
    federationId: "fed-1",
    ownerIdentityPublicKey: "owner-key-1",
    ownerDeviceId: null,
    projectReference: "proj-1",
    sourceRevision: "abc123def456",
    sourceTreeDigest: "tree-digest-1",
    sourceManifestDigest: null,
    sandboxRuntimeKind: "node",
    sandboxImageDigest: null,
    sandboxPolicyDigest: null,
    collaborationPolicyDigest: null,
    disclosurePolicyDigest: "disclosure-policy-1",
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
    capabilitySet: ["workspace.read", "workspace.write"],
    resourceScope: {
      allowedPaths: [], deniedPaths: [],
      allowedFileExtensions: [], deniedFileExtensions: [],
      allowedCommands: [], deniedCommands: [],
      allowedNetworkDomains: [], deniedNetworkDomains: [],
      allowedEnvironmentVariables: [], deniedEnvironmentVariables: [],
      maximumRuntimeSeconds: 0, maximumCpuSeconds: 0,
      maximumMemoryBytes: 0, maximumDiskWriteBytes: 0,
      maximumProcessCount: 0, maximumOutputBytes: 0,
      maximumComputeTokens: null, maximumComputeCost: null,
    },
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

function makeReceipt(overrides: Partial<SessionCommandReceipt> = {}): SessionCommandReceipt {
  return {
    receiptId: "receipt-1",
    requestId: "req-1",
    sessionId: "session-1",
    actorIdentityPublicKey: "peer-key-1",
    decision: "accepted",
    denialReason: null,
    authorityEvaluationDigest: null,
    executionId: null,
    workspaceBeforeDigest: null,
    workspaceAfterDigest: null,
    outputDigest: null,
    artifactDigest: null,
    computeLeaseId: null,
    createdAt: "2025-01-01T00:01:00Z",
    finalizedAt: null,
    controllerSignature: "",
    ...overrides,
  }
}

function makeMutation(overrides: Partial<WorkspaceMutation> = {}): WorkspaceMutation {
  return {
    mutationId: "mutation-1",
    sessionId: "session-1",
    actorIdentityPublicKey: "peer-key-1",
    overlayId: null,
    grantId: "grant-1",
    baseWorkspaceDigest: "base-digest-1",
    targetWorkspaceDigest: null,
    mutationKind: "file_create",
    pathScope: "/src/main.ts",
    beforeDigest: null,
    afterDigest: null,
    patchDigest: null,
    approvalState: "accepted",
    acceptedBy: "owner-key-1",
    acceptedAt: "2025-01-01T00:02:00Z",
    createdAt: "2025-01-01T00:01:30Z",
    ...overrides,
  }
}

function makeLease(overrides: Partial<ComputeLease> = {}): ComputeLease {
  return {
    leaseId: "lease-1",
    sessionId: "session-1",
    requesterIdentityPublicKey: "peer-key-1",
    requesterMembershipId: "member-1",
    providerIdentityPublicKey: null,
    backendKind: "prism_local",
    trustTier: 1,
    modelArtifactDigest: "model-digest-1",
    workloadClass: "inference",
    inputDisclosureClass: "public",
    inputDigest: "input-digest-1",
    outputDisclosureClass: "public",
    maximumTokens: 4096,
    maximumRuntimeSeconds: 300,
    maximumMemoryBytes: 1073741824,
    maximumCost: null,
    dharmaCreditAmount: null,
    routingPolicy: "local",
    issuedAt: "2025-01-01T00:03:00Z",
    expiresAt: "2025-01-01T01:00:00Z",
    revocationEpoch: 0,
    status: "completed",
    signatureChain: "chain-1",
    ...overrides,
  }
}

// ── Tests --------------------------------------------------------------------

describe("createSessionAggregate", () => {
  test("produces valid aggregate with all fields", () => {
    const aggregate = createSessionAggregate({
      session: makeSession(),
      members: [makeMember()],
      grants: [makeGrant()],
      receipts: [makeReceipt()],
      mutations: [makeMutation()],
      leases: [makeLease()],
      outcomeClassification: "successful_collaboration",
    })

    expect(aggregate.aggregateId).toBeTruthy()
    expect(aggregate.sessionId).toBe("session-1")
    expect(aggregate.federationId).toBe("fed-1")
    expect(aggregate.ownerIdentityPublicKey).toBe("owner-key-1")
    expect(aggregate.sourceRevisionDigest).toBe("abc123def456")
    expect(aggregate.authorityTopologyDigest).toBeTruthy()
    expect(aggregate.participantRoleSummary).toBeTruthy()
    expect(aggregate.collaborationTimelineSummary).toBeTruthy()
    expect(aggregate.approvedActionSummaries).toBeTruthy()
    expect(aggregate.verificationResults).toBeTruthy()
    expect(aggregate.computeUsageSummary).toBeTruthy()
    expect(aggregate.outcomeClassification).toBe("successful_collaboration")
    expect(aggregate.provenanceChainDigest).toBeTruthy()
    expect(aggregate.disclosurePolicy).toBeTruthy()
    expect(aggregate.emittedAt).toBeTruthy()
    expect(Array.isArray(aggregate.acceptedPatchDigests)).toBe(true)
    expect(Array.isArray(aggregate.executionReceiptDigests)).toBe(true)
    expect(Array.isArray(aggregate.contributionReceiptIds)).toBe(true)
    expect(Array.isArray(aggregate.signatureChain)).toBe(true)
  })

  test("includes accepted mutation digests", () => {
    const aggregate = createSessionAggregate({
      session: makeSession(),
      members: [makeMember()],
      grants: [makeGrant()],
      receipts: [makeReceipt()],
      mutations: [
        makeMutation({ approvalState: "accepted", afterDigest: "after-digest-1" }),
        makeMutation({ approvalState: "rejected", mutationId: "mutation-2" }),
      ],
      leases: [],
      outcomeClassification: "partial",
    })

    expect(aggregate.acceptedPatchDigests).toContain("after-digest-1")
    expect(aggregate.acceptedPatchDigests.length).toBe(1)
  })

  test("handles empty members gracefully", () => {
    const aggregate = createSessionAggregate({
      session: makeSession(),
      members: [],
      grants: [],
      receipts: [],
      mutations: [],
      leases: [],
      outcomeClassification: "empty",
    })

    expect(aggregate.participantRoleSummary).toBe("No participants")
    expect(aggregate.collaborationTimelineSummary).toBe("No participants")
    expect(aggregate.computeUsageSummary).toBe("Leases: 0 total, 0 active, 0 completed")
    expect(aggregate.approvedActionSummaries).toBe("Accepted: 0, Rejected: 0, Total: 0")
  })
})

describe("computeAuthorityTopologyDigest", () => {
  test("produces digest", () => {
    const grants = [makeGrant()]
    const digest = computeAuthorityTopologyDigest(grants)

    expect(digest).toBeTruthy()
    expect(typeof digest).toBe("string")
    expect(digest.length).toBeGreaterThan(0)
  })

  test("is deterministic for same grants", () => {
    const grants = [makeGrant({ grantId: "grant-1" }), makeGrant({ grantId: "grant-2" })]
    const digest1 = computeAuthorityTopologyDigest(grants)
    const digest2 = computeAuthorityTopologyDigest(grants)

    expect(digest1).toBe(digest2)
  })

  test("different grants produce different digests", () => {
    const grants1 = [makeGrant({ grantId: "grant-1" })]
    const grants2 = [makeGrant({ grantId: "grant-2" })]

    const digest1 = computeAuthorityTopologyDigest(grants1)
    const digest2 = computeAuthorityTopologyDigest(grants2)

    expect(digest1).not.toBe(digest2)
  })

  test("handles empty grants array", () => {
    const digest = computeAuthorityTopologyDigest([])

    expect(digest).toBeTruthy()
  })
})

describe("computeCollaborationTimelineSummary", () => {
  test("generates summary with active participants", () => {
    const members = [
      makeMember({ membershipId: "m1", status: "active", joinedAt: "2025-01-01T00:00:00Z" }),
      makeMember({ membershipId: "m2", status: "active", joinedAt: "2025-01-02T00:00:00Z" }),
    ]

    const summary = computeCollaborationTimelineSummary(members)

    expect(summary).toContain("2 active")
    expect(summary).toContain("2 total")
    expect(summary).toContain("2025-01-01")
    expect(summary).toContain("2025-01-02")
  })

  test("handles empty members", () => {
    const summary = computeCollaborationTimelineSummary([])

    expect(summary).toBe("No participants")
  })
})

describe("computeParticipantRoleSummary", () => {
  test("generates role summary", () => {
    const members = [
      makeMember({ displayRole: "contributor" }),
      makeMember({ membershipId: "m2", displayRole: "maintainer" }),
      makeMember({ membershipId: "m3", displayRole: "contributor" }),
    ]

    const summary = computeParticipantRoleSummary(members)

    expect(summary).toContain("contributor=2")
    expect(summary).toContain("maintainer=1")
  })

  test("handles empty members", () => {
    const summary = computeParticipantRoleSummary([])

    expect(summary).toBe("No participants")
  })
})

describe("verifyAggregateDisclosure", () => {
  test("empty complete aggregate is compliant", () => {
    const aggregate = createSessionAggregate({
      session: makeSession(),
      members: [],
      grants: [],
      receipts: [],
      mutations: [],
      leases: [],
      outcomeClassification: "test",
    })

    const result = verifyAggregateDisclosure(aggregate)

    expect(result.compliant).toBe(true)
    expect(result.violations).toEqual([])
  })

  test("detects missing disclosure policy", () => {
    const aggregate = createSessionAggregate({
      session: makeSession({ disclosurePolicyDigest: null }),
      members: [],
      grants: [],
      receipts: [],
      mutations: [],
      leases: [],
      outcomeClassification: "test",
    })
    // Override the disclosure policy check
    const modified: DharmaSessionAggregate = { ...aggregate, disclosurePolicy: "" }

    const result = verifyAggregateDisclosure(modified)

    expect(result.compliant).toBe(false)
    expect(result.violations).toContain("Disclosure policy is empty or missing")
  })
})

describe("isAggregateReadyForIngestion", () => {
  test("complete aggregate is ready", () => {
    const aggregate = createSessionAggregate({
      session: makeSession(),
      members: [makeMember()],
      grants: [makeGrant()],
      receipts: [makeReceipt()],
      mutations: [makeMutation()],
      leases: [makeLease()],
      outcomeClassification: "successful_collaboration",
    })

    expect(isAggregateReadyForIngestion(aggregate)).toBe(true)
  })

  test("missing outcome classification is not ready", () => {
    const aggregate = createSessionAggregate({
      session: makeSession(),
      members: [makeMember()],
      grants: [makeGrant()],
      receipts: [makeReceipt()],
      mutations: [makeMutation()],
      leases: [makeLease()],
      outcomeClassification: "",
    })

    expect(isAggregateReadyForIngestion(aggregate)).toBe(false)
  })

  test("aggregate with missing fields is not ready", () => {
    // Build an aggregate with empty fields
    const aggregate: DharmaSessionAggregate = createSessionAggregate({
      session: makeSession(),
      members: [makeMember()],
      grants: [makeGrant()],
      receipts: [makeReceipt()],
      mutations: [makeMutation()],
      leases: [makeLease()],
      outcomeClassification: "test",
    })

    // Override a field to be empty
    const modified: DharmaSessionAggregate = {
      ...aggregate,
      participantRoleSummary: "",
    }

    expect(isAggregateReadyForIngestion(modified)).toBe(false)
  })

  test("aggregate with null fields is not ready", () => {
    const aggregate: DharmaSessionAggregate = createSessionAggregate({
      session: makeSession(),
      members: [makeMember()],
      grants: [makeGrant()],
      receipts: [makeReceipt()],
      mutations: [makeMutation()],
      leases: [makeLease()],
      outcomeClassification: "test",
    })

    // participantRoleSummary cannot be null (it's typed as string), so we use
    // a different approach: empty string
    const modified: DharmaSessionAggregate = {
      ...aggregate,
      participantRoleSummary: "",
    }

    expect(isAggregateReadyForIngestion(modified)).toBe(false)
  })
})
