/**
 * External Lease Authority — Tests
 *
 * Covers:
 *   - createLeaseAuthority produces unique keys
 *   - createLeaseRequest with signature
 *   - verifyLeaseRequest validates
 *   - signLease produces valid lease
 *   - verifyLeaseSignature checks authority key
 *   - checkLeaseRequestPolicy enforces limits
 *   - issueLease through store with policy enforcement
 *   - revokeLease blocks verification
 */

import { describe, test, expect } from "bun:test"
import { generateKeyPair, sign, verify } from "../../../crypto"
import type { DecryptionLease, LeasePurpose } from "../mls-types"
import {
  createLeaseAuthority,
  getLeaseAuthorityPublicKey,
  createLeaseRequest,
  verifyLeaseRequest,
  createDefaultLeasePolicy,
  checkLeaseRequestPolicy,
  signLease,
  verifyLeaseSignature,
  createLeaseAuthorityStore,
  issueLease,
  revokeLease,
  isLeaseRevoked,
  getLeaseCount,
  type LeaseAuthority,
  type LeaseRequest,
  type LeasePolicy,
  type LeaseAuthorityStore,
} from "../lease-authority"

// ── Helpers ──────────────────────────────────────────────────────────────────

function createIdentityKeypair(): { publicKey: Buffer; privateKey: Buffer } {
  const kp = generateKeyPair()
  return {
    publicKey: Buffer.from(kp.publicKey),
    privateKey: Buffer.from(kp.privateKey),
  }
}

function makeSignedRequest(
  overrides?: Partial<LeaseRequest> & { signingKey?: Uint8Array },
): LeaseRequest {
  const identity = createIdentityKeypair()
  return createLeaseRequest(
    overrides?.packetId ?? "packet-001",
    overrides?.groupId ?? "group-mls-1",
    overrides?.requestorIdentity ?? "alice@example.com",
    (overrides?.purpose ?? "read") as LeasePurpose,
    overrides?.ttlMs ?? 60_000,
    overrides?.signingKey ?? identity.privateKey,
    overrides?.maxOperations,
  )
}

// ── Tests: createLeaseAuthority ──────────────────────────────────────────────

describe("createLeaseAuthority", () => {
  test("creates a fresh authority with a keypair", () => {
    const auth = createLeaseAuthority()
    expect(auth.publicKey).toBeInstanceOf(Buffer)
    expect(auth.publicKey.length).toBeGreaterThan(0)
    expect(auth.privateKey).toBeInstanceOf(Buffer)
    expect(auth.privateKey.length).toBeGreaterThan(0)
    expect(auth.serial).toBe(0)
  })

  test("produces unique keys across calls", () => {
    const a = createLeaseAuthority()
    const b = createLeaseAuthority()
    expect(a.publicKey.toString("hex")).not.toBe(b.publicKey.toString("hex"))
    expect(a.privateKey.toString("hex")).not.toBe(b.privateKey.toString("hex"))
  })

  test("getLeaseAuthorityPublicKey returns base64-encoded public key", () => {
    const auth = createLeaseAuthority()
    const b64 = getLeaseAuthorityPublicKey(auth)
    expect(typeof b64).toBe("string")
    expect(b64.length).toBeGreaterThan(0)
    expect(() => Buffer.from(b64, "base64")).not.toThrow()
    const decoded = Buffer.from(b64, "base64")
    expect(decoded.equals(auth.publicKey)).toBe(true)
  })
})

// ── Tests: createLeaseRequest / verifyLeaseRequest ───────────────────────────

describe("createLeaseRequest / verifyLeaseRequest", () => {
  test("creates a signed lease request", () => {
    const identity = createIdentityKeypair()
    const request = createLeaseRequest(
      "packet-001",
      "group-mls-1",
      "alice@example.com",
      "read" as LeasePurpose,
      60_000,
      identity.privateKey,
    )

    expect(request.packetId).toBe("packet-001")
    expect(request.groupId).toBe("group-mls-1")
    expect(request.requestorIdentity).toBe("alice@example.com")
    expect(request.purpose).toBe("read")
    expect(request.ttlMs).toBe(60_000)
    expect(request.maxOperations).toBe(100)
    expect(typeof request.requestorSignature).toBe("string")
    expect(request.requestorSignature.length).toBeGreaterThan(0)
  })

  test("verifyLeaseRequest succeeds with valid signature", () => {
    const identity = createIdentityKeypair()
    const request = createLeaseRequest(
      "packet-001",
      "group-mls-1",
      "alice@example.com",
      "read" as LeasePurpose,
      60_000,
      identity.privateKey,
    )

    const result = verifyLeaseRequest(request, identity.publicKey)
    expect(result).toBe(true)
  })

  test("verifyLeaseRequest fails with wrong public key", () => {
    const identity = createIdentityKeypair()
    const wrongIdentity = createIdentityKeypair()
    const request = createLeaseRequest(
      "packet-001",
      "group-mls-1",
      "alice@example.com",
      "read" as LeasePurpose,
      60_000,
      identity.privateKey,
    )

    const result = verifyLeaseRequest(request, wrongIdentity.publicKey)
    expect(result).toBe(false)
  })

  test("verifyLeaseRequest fails when request is tampered with", () => {
    const identity = createIdentityKeypair()
    const request = createLeaseRequest(
      "packet-001",
      "group-mls-1",
      "alice@example.com",
      "read" as LeasePurpose,
      60_000,
      identity.privateKey,
    )

    // Tamper with the TTL — the signature should no longer match
    const tampered: LeaseRequest = { ...request, ttlMs: 999_999 }
    const result = verifyLeaseRequest(tampered, identity.publicKey)
    expect(result).toBe(false)
  })

  test("verifyLeaseRequest fails with empty signature", () => {
    const identity = createIdentityKeypair()
    const badRequest: LeaseRequest = {
      packetId: "packet-001",
      groupId: "group-mls-1",
      requestorIdentity: "alice@example.com",
      purpose: "read" as LeasePurpose,
      ttlMs: 60_000,
      maxOperations: 100,
      requestorSignature: "",
    }
    const result = verifyLeaseRequest(badRequest, identity.publicKey)
    expect(result).toBe(false)
  })
})

// ── Tests: checkLeaseRequestPolicy ───────────────────────────────────────────

describe("checkLeaseRequestPolicy", () => {
  const policy = createDefaultLeasePolicy()

  test("allows valid request within limits", () => {
    const request = makeSignedRequest({ ttlMs: 60_000, maxOperations: 50 })
    const result = checkLeaseRequestPolicy(request, policy, 0)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("rejects TTL exceeding policy maximum", () => {
    const request = makeSignedRequest({ ttlMs: policy.maxTtlMs + 1 })
    const result = checkLeaseRequestPolicy(request, policy, 0)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("TTL")
  })

  test("rejects maxOperations exceeding policy maximum", () => {
    const request = makeSignedRequest({ maxOperations: policy.maxOperations + 1 })
    const result = checkLeaseRequestPolicy(request, policy, 0)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("operations")
  })

  test("rejects disallowed purpose", () => {
    const request = makeSignedRequest({ purpose: "replication" as LeasePurpose })
    const restrictivePolicy: LeasePolicy = {
      ...policy,
      allowedPurposes: ["read"],
    }
    const result = checkLeaseRequestPolicy(request, restrictivePolicy, 0)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Purpose")
  })

  test("rejects request when rate limit exceeded", () => {
    const request = makeSignedRequest()
    const result = checkLeaseRequestPolicy(request, policy, policy.rateLimitPerMinute)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Rate limit")
  })

  test("allows request at the boundary of rate limit", () => {
    const request = makeSignedRequest()
    const result = checkLeaseRequestPolicy(request, policy, policy.rateLimitPerMinute - 1)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })
})

// ── Tests: signLease / verifyLeaseSignature ──────────────────────────────────

describe("signLease / verifyLeaseSignature", () => {
  test("signLease produces a valid lease with signature", () => {
    const authority = createLeaseAuthority()
    const request = makeSignedRequest()

    const lease = signLease(authority, request)

    expect(lease.leaseId).toBeTruthy()
    expect(lease.packetId).toBe(request.packetId)
    expect(lease.groupId).toBe(request.groupId)
    expect(lease.requestorIdentity).toBe(request.requestorIdentity)
    expect(lease.purpose).toBe(request.purpose)
    expect(lease.maxOperations).toBe(request.maxOperations)
    expect(lease.remainingOperations).toBe(request.maxOperations)
    expect(lease.issuedAt).toBeTruthy()
    expect(lease.expiresAt).toBeTruthy()
    expect(typeof lease.signature).toBe("string")
    expect(lease.signature.length).toBeGreaterThan(0)
  })

  test("signLease increments authority serial", () => {
    const authority = createLeaseAuthority()
    expect(authority.serial).toBe(0)

    signLease(authority, makeSignedRequest())
    expect(authority.serial).toBe(1)

    signLease(authority, makeSignedRequest())
    expect(authority.serial).toBe(2)
  })

  test("verifyLeaseSignature succeeds with correct authority key", () => {
    const authority = createLeaseAuthority()
    const lease = signLease(authority, makeSignedRequest())

    const result = verifyLeaseSignature(lease, authority.publicKey)
    expect(result).toBe(true)
  })

  test("verifyLeaseSignature fails with wrong authority key", () => {
    const authority = createLeaseAuthority()
    const otherAuthority = createLeaseAuthority()
    const lease = signLease(authority, makeSignedRequest())

    const result = verifyLeaseSignature(lease, otherAuthority.publicKey)
    expect(result).toBe(false)
  })

  test("verifyLeaseSignature fails when lease is tampered with", () => {
    const authority = createLeaseAuthority()
    const lease = signLease(authority, makeSignedRequest())

    // Tamper with the lease
    const tampered: DecryptionLease = { ...lease, maxOperations: 999 }
    const result = verifyLeaseSignature(tampered, authority.publicKey)
    expect(result).toBe(false)
  })

  test("verifyLeaseSignature fails on empty signature", () => {
    const authority = createLeaseAuthority()
    const lease = signLease(authority, makeSignedRequest())
    const badSignature: DecryptionLease = { ...lease, signature: "" }

    const result = verifyLeaseSignature(badSignature, authority.publicKey)
    expect(result).toBe(false)
  })
})

// ── Tests: LeaseAuthorityStore ───────────────────────────────────────────────

describe("LeaseAuthorityStore", () => {
  test("createLeaseAuthorityStore creates store with fresh authority", () => {
    const store = createLeaseAuthorityStore()
    expect(store.authority).toBeDefined()
    expect(store.authority.publicKey.length).toBeGreaterThan(0)
    expect(store.policy).toBeDefined()
    expect(store.issuedLeases.size).toBe(0)
    expect(store.revokedLeases.size).toBe(0)
    expect(store.requestLog.length).toBe(0)
  })

  test("createLeaseAuthorityStore accepts custom policy", () => {
    const customPolicy: LeasePolicy = {
      maxTtlMs: 10_000,
      maxOperations: 5,
      rateLimitPerMinute: 10,
      allowedPurposes: ["read"],
      requireRequestorSignature: false,
      revocationEnabled: false,
    }
    const store = createLeaseAuthorityStore(customPolicy)
    expect(store.policy.maxTtlMs).toBe(10_000)
    expect(store.policy.maxOperations).toBe(5)
    expect(store.policy.allowedPurposes).toEqual(["read"])
  })
})

// ── Tests: issueLease ────────────────────────────────────────────────────────

describe("issueLease", () => {
  test("issues a valid lease when policy allows", () => {
    const store = createLeaseAuthorityStore()
    const request = makeSignedRequest({ ttlMs: 60_000 })

    const result = issueLease(store, request)

    expect(result.lease).not.toBeNull()
    expect(result.rejection).toBeNull()
    expect(result.lease!.packetId).toBe(request.packetId)
    expect(result.lease!.groupId).toBe(request.groupId)
    expect(result.lease!.signature.length).toBeGreaterThan(0)
  })

  test("rejects lease when TTL exceeds policy", () => {
    const store = createLeaseAuthorityStore()
    const request = makeSignedRequest({ ttlMs: store.policy.maxTtlMs + 100_000 })

    const result = issueLease(store, request)

    expect(result.lease).toBeNull()
    expect(result.rejection).toContain("TTL")
  })

  test("rejects lease when purpose not allowed", () => {
    const store = createLeaseAuthorityStore()
    store.policy.allowedPurposes = ["read"]
    const request = makeSignedRequest({ purpose: "export" as LeasePurpose })

    const result = issueLease(store, request)

    expect(result.lease).toBeNull()
    expect(result.rejection).toContain("Purpose")
  })

  test("rejects lease when rate limit exceeded", () => {
    const store = createLeaseAuthorityStore()
    store.policy.rateLimitPerMinute = 2

    // First two should succeed
    const r1 = issueLease(store, makeSignedRequest({ requestorIdentity: "bob@test.com" }))
    expect(r1.lease).not.toBeNull()

    const r2 = issueLease(store, makeSignedRequest({ requestorIdentity: "bob@test.com" }))
    expect(r2.lease).not.toBeNull()

    // Third should be rate-limited
    const r3 = issueLease(store, makeSignedRequest({ requestorIdentity: "bob@test.com" }))
    expect(r3.lease).toBeNull()
    expect(r3.rejection).toContain("Rate limit")
  })

  test("rejects lease with non-base64 signature when requireRequestorSignature is true", () => {
    const store = createLeaseAuthorityStore()
    store.policy.requireRequestorSignature = true
    const badRequest: LeaseRequest = {
      packetId: "packet-001",
      groupId: "group-mls-1",
      requestorIdentity: "mallory@evil.com",
      purpose: "read" as LeasePurpose,
      ttlMs: 60_000,
      maxOperations: 100,
      requestorSignature: "\x00\xff\xfe\xfd", // invalid base64
    }

    const result = issueLease(store, badRequest)

    expect(result.lease).toBeNull()
    expect(result.rejection).toContain("not valid")
  })

  test("records request in log for rate limiting", () => {
    const store = createLeaseAuthorityStore()
    issueLease(store, makeSignedRequest({ requestorIdentity: "charlie@test.com" }))

    expect(store.requestLog.length).toBe(1)
    expect(store.requestLog[0].requestorIdentity).toBe("charlie@test.com")
    expect(typeof store.requestLog[0].timestamp).toBe("number")
  })

  test("increments lease count in store", () => {
    const store = createLeaseAuthorityStore()
    expect(getLeaseCount(store)).toBe(0)

    issueLease(store, makeSignedRequest())
    expect(getLeaseCount(store)).toBe(1)

    issueLease(store, makeSignedRequest())
    expect(getLeaseCount(store)).toBe(2)
  })

  test("issued lease is verifiable with authority's public key", () => {
    const store = createLeaseAuthorityStore()
    const result = issueLease(store, makeSignedRequest())

    const verified = verifyLeaseSignature(result.lease!, store.authority.publicKey)
    expect(verified).toBe(true)
  })
})

// ── Tests: revokeLease / isLeaseRevoked ──────────────────────────────────────

describe("revokeLease / isLeaseRevoked", () => {
  test("revokeLease marks a lease as revoked", () => {
    const store = createLeaseAuthorityStore()
    const result = issueLease(store, makeSignedRequest())

    expect(isLeaseRevoked(store, result.lease!.leaseId)).toBe(false)

    const revoked = revokeLease(store, result.lease!.leaseId)
    expect(revoked).toBe(true)
    expect(isLeaseRevoked(store, result.lease!.leaseId)).toBe(true)
  })

  test("revokeLease returns false for unknown lease", () => {
    const store = createLeaseAuthorityStore()
    const revoked = revokeLease(store, "nonexistent-lease-id")
    expect(revoked).toBe(false)
  })

  test("revokeLease returns false for already revoked lease", () => {
    const store = createLeaseAuthorityStore()
    const result = issueLease(store, makeSignedRequest())

    revokeLease(store, result.lease!.leaseId)
    const secondRevoke = revokeLease(store, result.lease!.leaseId)
    expect(secondRevoke).toBe(false)
  })

  test("revoked lease is still counted in issuedLeases", () => {
    const store = createLeaseAuthorityStore()
    const result = issueLease(store, makeSignedRequest())

    revokeLease(store, result.lease!.leaseId)
    expect(getLeaseCount(store)).toBe(1)
    expect(store.issuedLeases.has(result.lease!.leaseId)).toBe(true)
    expect(store.revokedLeases.has(result.lease!.leaseId)).toBe(true)
  })
})

// ── Tests: createDefaultLeasePolicy ──────────────────────────────────────────

describe("createDefaultLeasePolicy", () => {
  test("returns a policy with reasonable defaults", () => {
    const policy = createDefaultLeasePolicy()
    expect(policy.maxTtlMs).toBe(300_000) // 5 minutes
    expect(policy.maxOperations).toBe(100)
    expect(policy.rateLimitPerMinute).toBe(60)
    expect(policy.allowedPurposes).toEqual(["read", "export", "replication"])
    expect(policy.requireRequestorSignature).toBe(true)
    expect(policy.revocationEnabled).toBe(true)
  })
})
