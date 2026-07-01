/**
 * Dharma Session Authority — Grant Revocation & Key Epoch — unit tests
 *
 * Tests cover revocation creation, classification (graceful/emergency),
 * key epoch rotation, ownership transfer validation, and drain deadline
 * computation.
 */

import { describe, it, expect } from "bun:test"
import {
  createRevocation,
  isEmergencyRevocation,
  getNextKeyEpoch,
  isGrantSupersededByEpoch,
  createOwnershipTransfer,
  isValidOwnershipTransfer,
  getDrainDeadline,
} from "../session-revocation"
import type { GrantRevocation, SessionAuthorityGrant } from "../types"

// ── Fixtures ───────────────────────────────────────────────

const BASE_REVOCATION_CONFIG = {
  sessionId: "sess_01j3xyz789",
  grantId: "grant_01j3def456",
  subjectIdentityPublicKey: "did:dht:alice",
  revokedByIdentityPublicKey: "did:dht:bob",
  reason: "workflow_complete",
  previousKeyEpoch: 2,
}

const MINIMAL_GRANT: SessionAuthorityGrant = {
  grantId: "grant_01j3def456",
  sessionId: "sess_01j3xyz789",
  subjectIdentityPublicKey: "did:dht:alice",
  subjectMembershipId: "mem_01j3abc123",
  issuedByIdentityPublicKey: "did:dht:bob",
  issuedByGrantId: null,
  capabilitySet: ["workspace.read"],
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
  issuedAt: "2026-06-30T12:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
  revocationReason: null,
  sessionKeyEpoch: 2,
  signature: "sig_abc",
}

// ── Revocation Creation ────────────────────────────────────

describe("createRevocation", () => {
  it("creates a valid revocation with default graceful kind", () => {
    const revocation = createRevocation(BASE_REVOCATION_CONFIG)

    expect(revocation).toBeDefined()
    expect(revocation.revocationId).toBeTruthy()
    expect(revocation.sessionId).toBe("sess_01j3xyz789")
    expect(revocation.grantId).toBe("grant_01j3def456")
    expect(revocation.subjectIdentityPublicKey).toBe("did:dht:alice")
    expect(revocation.revokedByIdentityPublicKey).toBe("did:dht:bob")
    expect(revocation.reason).toBe("workflow_complete")
    expect(revocation.kind).toBe("graceful")
    expect(revocation.effectiveAt).toBeTruthy()
    expect(revocation.previousKeyEpoch).toBe(2)
    expect(revocation.nextKeyEpoch).toBe(3)
    expect(revocation.signature).toBe("")
  })

  it("creates an emergency revocation when kind is specified", () => {
    const revocation = createRevocation({
      ...BASE_REVOCATION_CONFIG,
      kind: "emergency",
    })

    expect(revocation.kind).toBe("emergency")
  })

  it("increments the key epoch correctly", () => {
    const revocation = createRevocation({
      ...BASE_REVOCATION_CONFIG,
      previousKeyEpoch: 5,
    })

    expect(revocation.nextKeyEpoch).toBe(6)
    expect(revocation.previousKeyEpoch).toBe(5)
  })
})

// ── isEmergencyRevocation ──────────────────────────────────

describe("isEmergencyRevocation", () => {
  it("returns true for emergency revocation", () => {
    const revocation = createRevocation({
      ...BASE_REVOCATION_CONFIG,
      kind: "emergency",
    })
    expect(isEmergencyRevocation(revocation)).toBe(true)
  })

  it("returns false for graceful revocation", () => {
    const revocation = createRevocation(BASE_REVOCATION_CONFIG)
    expect(isEmergencyRevocation(revocation)).toBe(false)
  })
})

// ── getNextKeyEpoch ────────────────────────────────────────

describe("getNextKeyEpoch", () => {
  it("increments by 1", () => {
    expect(getNextKeyEpoch(0)).toBe(1)
    expect(getNextKeyEpoch(1)).toBe(2)
    expect(getNextKeyEpoch(100)).toBe(101)
  })
})

// ── isGrantSupersededByEpoch ───────────────────────────────

describe("isGrantSupersededByEpoch", () => {
  it("returns true when grant epoch differs from current", () => {
    const grant = { ...MINIMAL_GRANT, sessionKeyEpoch: 2 }
    expect(isGrantSupersededByEpoch(grant, 5)).toBe(true)
  })

  it("returns false when grant epoch matches current", () => {
    const grant = { ...MINIMAL_GRANT, sessionKeyEpoch: 2 }
    expect(isGrantSupersededByEpoch(grant, 2)).toBe(false)
  })
})

// ── Ownership Transfer ─────────────────────────────────────

describe("createOwnershipTransfer", () => {
  it("creates a valid ownership transfer record", () => {
    const transfer = createOwnershipTransfer({
      sessionId: "sess_01j3xyz789",
      previousOwner: "did:dht:alice",
      newOwner: "did:dht:bob",
      workspaceDigest: "sha256_workspace_001",
      activeGrantSummaryDigest: "sha256_grants_001",
      transferReason: "role_change",
    })

    expect(transfer.transferId).toBeTruthy()
    expect(transfer.sessionId).toBe("sess_01j3xyz789")
    expect(transfer.previousOwnerIdentityPublicKey).toBe("did:dht:alice")
    expect(transfer.newOwnerIdentityPublicKey).toBe("did:dht:bob")
    expect(transfer.workspaceDigest).toBe("sha256_workspace_001")
    expect(transfer.activeGrantSummaryDigest).toBe("sha256_grants_001")
    expect(transfer.transferReason).toBe("role_change")
    expect(transfer.initiatedAt).toBeTruthy()
    expect(transfer.acceptedAt).toBeNull()
    expect(transfer.previousOwnerSignature).toBe("")
    expect(transfer.newOwnerSignature).toBeNull()
  })
})

describe("isValidOwnershipTransfer", () => {
  it("returns false when new owner has not signed", () => {
    const transfer = createOwnershipTransfer({
      sessionId: "sess_01j3xyz789",
      previousOwner: "did:dht:alice",
      newOwner: "did:dht:bob",
      workspaceDigest: "sha256_workspace_001",
      activeGrantSummaryDigest: "sha256_grants_001",
      transferReason: "role_change",
    })
    expect(isValidOwnershipTransfer(transfer)).toBe(false)
  })

  it("returns false when neither owner has signed", () => {
    const transfer = createOwnershipTransfer({
      sessionId: "sess_01j3xyz789",
      previousOwner: "did:dht:alice",
      newOwner: "did:dht:bob",
      workspaceDigest: "sha256_workspace_001",
      activeGrantSummaryDigest: "sha256_grants_001",
      transferReason: "role_change",
    })
    expect(isValidOwnershipTransfer(transfer)).toBe(false)
  })

  it("returns true when both owners have signed", () => {
    const transfer = createOwnershipTransfer({
      sessionId: "sess_01j3xyz789",
      previousOwner: "did:dht:alice",
      newOwner: "did:dht:bob",
      workspaceDigest: "sha256_workspace_001",
      activeGrantSummaryDigest: "sha256_grants_001",
      transferReason: "role_change",
    })

    // Simulate both signatures
    transfer.previousOwnerSignature = "sig_alice_001"
    transfer.newOwnerSignature = "sig_bob_001"

    expect(isValidOwnershipTransfer(transfer)).toBe(true)
  })
})

// ── getDrainDeadline ───────────────────────────────────────

describe("getDrainDeadline", () => {
  it("returns null for emergency revocation", () => {
    const revocation = createRevocation({
      ...BASE_REVOCATION_CONFIG,
      kind: "emergency",
    })
    expect(getDrainDeadline(revocation)).toBeNull()
  })

  it("returns a future timestamp for graceful revocation", () => {
    const revocation = createRevocation(BASE_REVOCATION_CONFIG)
    const before = Date.now() + 250_000 // 250ms into drain window
    const deadline = getDrainDeadline(revocation)

    expect(deadline).not.toBeNull()
    expect(typeof deadline).toBe("string")

    const deadlineMs = new Date(deadline!).getTime()
    expect(deadlineMs).toBeGreaterThan(before)
  })

  it("respects a custom drain window", () => {
    const revocation = createRevocation(BASE_REVOCATION_CONFIG)
    const shortWindow = 1_000 // 1 second
    const deadline = getDrainDeadline(revocation, shortWindow)

    expect(deadline).not.toBeNull()
    const deadlineMs = new Date(deadline!).getTime()
    const now = Date.now()
    // Should be approximately now + 1s
    expect(deadlineMs).toBeGreaterThan(now)
    expect(deadlineMs).toBeLessThan(now + 5_000)
  })
})
