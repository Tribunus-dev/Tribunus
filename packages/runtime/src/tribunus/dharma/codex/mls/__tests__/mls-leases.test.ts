/**
 * MLS Decryption Leases — Tests
 *
 * Verifies lease issuance, verification, expiry, operation consumption,
 * revocation, and canDecryptPacket.
 */

import { describe, test, expect } from "bun:test"
import {
  createLeaseStore,
  issueLease,
  verifyLease,
  consumeLease,
  revokeLease,
  isLeaseExpired,
  canDecryptPacket,
  type DecryptionLease,
  type LeaseStore,
  type LeasePurpose,
} from "../mls-leases"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(): LeaseStore {
  return createLeaseStore()
}

function issueTestLease(
  store: LeaseStore,
  overrides?: { purpose?: LeasePurpose; ttlMs?: number },
): DecryptionLease {
  return issueLease(
    store,
    "packet-001",
    "group-session-001",
    "identity-alice",
    overrides?.purpose ?? "read",
    overrides?.ttlMs ?? 60_000,
  )
}

// ── Tests: createLeaseStore ──────────────────────────────────────────────────

describe("createLeaseStore", () => {
  test("creates empty store", () => {
    const store = createLeaseStore()
    expect(store.activeLeases.size).toBe(0)
    expect(store.revokedLeases.size).toBe(0)
    expect(store.leaseCount).toBe(0)
    expect(store._signingKey).toBeTruthy()
    expect(store._signingKey.length).toBeGreaterThan(0)
  })

  test("each store has unique signing key", () => {
    const store1 = createLeaseStore()
    const store2 = createLeaseStore()
    expect(store1._signingKey).not.toBe(store2._signingKey)
  })
})

// ── Tests: issueLease ────────────────────────────────────────────────────

describe("issueLease", () => {
  test("issues a valid lease", () => {
    const store = makeStore()
    const lease = issueTestLease(store)

    expect(lease.leaseId).toBeTruthy()
    expect(lease.packetId).toBe("packet-001")
    expect(lease.groupId).toBe("group-session-001")
    expect(lease.requestorIdentity).toBe("identity-alice")
    expect(lease.purpose).toBe("read")
    expect(lease.issuedAt).toBeTruthy()
    expect(lease.expiresAt).toBeTruthy()
    expect(lease.maxOperations).toBe(100)
    expect(lease.remainingOperations).toBe(100)
    expect(lease.signature).toBeTruthy()
  })

  test("increments lease count", () => {
    const store = makeStore()
    expect(store.leaseCount).toBe(0)
    issueTestLease(store)
    expect(store.leaseCount).toBe(1)
    issueTestLease(store)
    expect(store.leaseCount).toBe(2)
  })

  test("issues different lease IDs", () => {
    const store = makeStore()
    const lease1 = issueTestLease(store)
    const lease2 = issueTestLease(store)
    expect(lease1.leaseId).not.toBe(lease2.leaseId)
  })

  test("stores lease in activeLeases", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    expect(store.activeLeases.get(lease.leaseId)).toBe(lease)
  })

  test("supports different purposes", () => {
    const store = makeStore()
    const readLease = issueTestLease(store, { purpose: "read" })
    const exportLease = issueTestLease(store, { purpose: "export" })
    const replLease = issueTestLease(store, { purpose: "replication" })

    expect(readLease.purpose).toBe("read")
    expect(exportLease.purpose).toBe("export")
    expect(replLease.purpose).toBe("replication")
  })

  test("respects custom TTL", () => {
    const store = makeStore()
    const lease = issueTestLease(store, { ttlMs: 5000 })
    const issued = new Date(lease.issuedAt).getTime()
    const expires = new Date(lease.expiresAt).getTime()
    expect(expires - issued).toBe(5000)
  })
})

// ── Tests: verifyLease ─────────────────────────────────────────────────

describe("verifyLease", () => {
  test("valid lease passes verification", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const result = verifyLease(store, lease)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("tampered signature fails", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const tampered = { ...lease, signature: "deadbeef" + lease.signature.slice(8) }
    const result = verifyLease(store, tampered)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("Lease signature is invalid")
  })

  test("signature from different store fails", () => {
    const store = makeStore()
    const otherStore = makeStore()
    const lease = issueTestLease(store)
    const result = verifyLease(otherStore, lease)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("Lease signature is invalid")
  })

  test("revoked lease fails", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const revokedStore = revokeLease(store, lease.leaseId)
    const result = verifyLease(revokedStore, lease)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("Lease has been revoked")
  })
})

// ── Tests: consumeLease ────────────────────────────────────────────────

describe("consumeLease", () => {
  test("decrements remaining operations", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const updated = consumeLease(store, lease.leaseId)

    expect(updated.activeLeases.get(lease.leaseId)!.remainingOperations).toBe(99)
    expect(updated.activeLeases.get(lease.leaseId)!.signature).not.toBe(lease.signature)
  })

  test("consumed lease still verifies with updated signature", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const updated = consumeLease(store, lease.leaseId)
    const currentLease = updated.activeLeases.get(lease.leaseId)!
    const result = verifyLease(updated, currentLease)
    expect(result.valid).toBe(true)
  })

  test("throws when consuming exhausted lease", () => {
    const store = makeStore()
    const lease = issueTestLease(store)

    let current = store
    for (let i = 0; i < 100; i++) {
      current = consumeLease(current, lease.leaseId)
    }

    expect(() => consumeLease(current, lease.leaseId)).toThrow(
      /Cannot consume lease/,
    )
  })

  test("throws when consuming revoked lease", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const revoked = revokeLease(store, lease.leaseId)

    expect(() => consumeLease(revoked, lease.leaseId)).toThrow(
      /Lease not found/,
    )
  })

  test("throws for non-existent lease", () => {
    const store = makeStore()
    expect(() => consumeLease(store, "nonexistent")).toThrow(
      /Lease not found/,
    )
  })
})

// ── Tests: revokeLease ─────────────────────────────────────────────────

describe("revokeLease", () => {
  test("removes lease from activeLeases", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    expect(store.activeLeases.has(lease.leaseId)).toBe(true)

    const updated = revokeLease(store, lease.leaseId)
    expect(updated.activeLeases.has(lease.leaseId)).toBe(false)
    expect(updated.revokedLeases.has(lease.leaseId)).toBe(true)
  })

  test("revoked lease is tracked", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const updated = revokeLease(store, lease.leaseId)
    expect(updated.revokedLeases.has(lease.leaseId)).toBe(true)
  })

  test("revoking non-existent lease is safe", () => {
    const store = makeStore()
    const updated = revokeLease(store, "nonexistent")
    expect(updated.revokedLeases.has("nonexistent")).toBe(true)
    expect(updated.activeLeases.size).toBe(0)
  })

  test("prevents further consumption", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const updated = revokeLease(store, lease.leaseId)
    expect(() => consumeLease(updated, lease.leaseId)).toThrow()
  })
})

// ── Tests: isLeaseExpired ───────────────────────────────────────────────

describe("isLeaseExpired", () => {
  test("fresh lease is not expired", () => {
    const store = makeStore()
    const lease = issueTestLease(store, { ttlMs: 60_000 })
    expect(isLeaseExpired(lease)).toBe(false)
  })

  test("lease with past expiry is expired", () => {
    const store = makeStore()
    const lease: DecryptionLease = {
      leaseId: "test",
      packetId: "p1",
      groupId: "g1",
      requestorIdentity: "id1",
      purpose: "read",
      issuedAt: new Date(Date.now() - 10_000).toISOString(),
      expiresAt: new Date(Date.now() - 5_000).toISOString(),
      maxOperations: 100,
      remainingOperations: 100,
      signature: "",
    }
    expect(isLeaseExpired(lease)).toBe(true)
  })
})

// ── Tests: canDecryptPacket ─────────────────────────────────────────────

describe("canDecryptPacket", () => {
  test("returns true for valid lease", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    expect(canDecryptPacket(store, lease)).toBe(true)
  })

  test("returns false for tampered lease", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const tampered = { ...lease, packetId: "different-packet" }
    expect(canDecryptPacket(store, tampered)).toBe(false)
  })

  test("returns false for revoked lease", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    const revokedStore = revokeLease(store, lease.leaseId)
    expect(canDecryptPacket(revokedStore, lease)).toBe(false)
  })
})

// ── Integration ──────────────────────────────────────────────────────────────

describe("lease lifecycle integration", () => {
  test("issue, verify, consume, exhaust, fail", () => {
    const store = makeStore()

    // Issue a lease with very few operations
    const lease = issueLease(store, "packet-001", "group-session-001", "identity-alice", "read", 60_000)
    expect(verifyLease(store, lease).valid).toBe(true)

    // Consume all operations
    let current = store
    for (let i = 0; i < lease.maxOperations - 1; i++) {
      current = consumeLease(current, lease.leaseId)
    }

    // Last operation
    current = consumeLease(current, lease.leaseId)
    expect(current.activeLeases.get(lease.leaseId)!.remainingOperations).toBe(0)

    // Exhausted
    expect(() => consumeLease(current, lease.leaseId)).toThrow()
  })

  test("revoke prevents any use", () => {
    const store = makeStore()
    const lease = issueTestLease(store)
    expect(canDecryptPacket(store, lease)).toBe(true)

    const updated = revokeLease(store, lease.leaseId)
    expect(canDecryptPacket(updated, lease)).toBe(false)
    expect(verifyLease(updated, lease).valid).toBe(false)
    expect(verifyLease(updated, lease).reason).toBe("Lease has been revoked")
  })
})
