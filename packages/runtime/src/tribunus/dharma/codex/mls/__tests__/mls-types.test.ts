/**
 * Tests for MLS types, epoch key derivation, and packet key wrapping.
 */

import { describe, it, expect } from "bun:test"
import {
  CODEC_MLS_PROTOCOL_VERSION,
  MlsDomainKind,
  createDefaultMlsPolicy,
  canAddMember,
  canRemoveMember,
  createMlsCredential,
  verifyMlsCredential,
  createMlsCommitReceipt,
  signMlsCommitReceipt,
  derivePacketWrappingKey,
  wrapDekWithEpochKey,
  unwrapDekWithEpochKey,
} from "../mls-types"
import { generateKeyPair, sign } from "../../../crypto"

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_DOMAIN_KINDS: MlsDomainKind[] = [
  "public",
  "contributor",
  "project",
  "session",
  "export_recovery",
]

// ── createDefaultMlsPolicy ───────────────────────────────────────────────────

describe("createDefaultMlsPolicy", () => {
  for (const kind of ALL_DOMAIN_KINDS) {
    it(`returns a valid policy for "${kind}"`, () => {
      const policy = createDefaultMlsPolicy(kind)
      expect(policy.policyId).toBe(`${CODEC_MLS_PROTOCOL_VERSION}-${kind}-default`)
      expect(policy.domainKind).toBe(kind)
      expect(policy.maxEpochAgeMs).toBeGreaterThan(0)
      expect(policy.maxPacketsPerEpoch).toBeGreaterThan(0)
      expect(policy.requiredCredentialPolicyDigest).toBeTruthy()
    })
  }

  it("assigns strictest permissions to session domain", () => {
    const policy = createDefaultMlsPolicy("session")
    expect(policy.addAuthority).toBe("owner")
    expect(policy.removeAuthority).toBe("owner")
    expect(policy.historyAccess).toBe("none")
    expect(policy.externalCommitPolicy).toBe("disabled")
    expect(policy.externalProposalPolicy).toBe("disabled")
  })

  it("assigns policy_controller authority to export_recovery domain", () => {
    const policy = createDefaultMlsPolicy("export_recovery")
    expect(policy.addAuthority).toBe("policy_controller")
    expect(policy.removeAuthority).toBe("policy_controller")
    expect(policy.updateAuthority).toBe("policy_controller")
    expect(policy.historyAccess).toBe("explicit_backfill_only")
    expect(policy.keyRotationTriggers).toEqual(["member_compromise", "policy_change"])
  })

  it("public domain has maintainer add and permissive history", () => {
    const policy = createDefaultMlsPolicy("public")
    expect(policy.addAuthority).toBe("maintainer")
    expect(policy.historyAccess).toBe("from_join_epoch")
    expect(policy.externalProposalPolicy).toBe("explicitly_authorized")
    expect(policy.maxEpochAgeMs).toBe(86_400_000)
  })

  it("returns distinct policies for different domain kinds", () => {
    const policies = ALL_DOMAIN_KINDS.map(createDefaultMlsPolicy)
    const policyIds = new Set(policies.map((p) => p.policyId))
    expect(policyIds.size).toBe(ALL_DOMAIN_KINDS.length)
  })
})

// ── canAddMember / canRemoveMember ─────────────────────────────────────────

describe("canAddMember", () => {
  const publicPolicy = createDefaultMlsPolicy("public") // addAuthority: maintainer
  const sessionPolicy = createDefaultMlsPolicy("session") // addAuthority: owner

  it("owner can add in any policy", () => {
    expect(canAddMember(publicPolicy, "owner")).toBe(true)
    expect(canAddMember(sessionPolicy, "owner")).toBe(true)
  })

  it("maintainer can add in maintainer-authority policies", () => {
    expect(canAddMember(publicPolicy, "maintainer")).toBe(true)
  })

  it("maintainer cannot add in owner-only policies", () => {
    expect(canAddMember(sessionPolicy, "maintainer")).toBe(false)
  })

  it("contributor cannot add in any policy", () => {
    expect(canAddMember(publicPolicy, "contributor")).toBe(false)
    expect(canAddMember(sessionPolicy, "contributor")).toBe(false)
  })

  it("policy_controller can add in export_recovery", () => {
    const recoveryPolicy = createDefaultMlsPolicy("export_recovery")
    expect(canAddMember(recoveryPolicy, "policy_controller")).toBe(true)
  })
})

describe("canRemoveMember", () => {
  const publicPolicy = createDefaultMlsPolicy("public") // removeAuthority: owner
  const recoveryPolicy = createDefaultMlsPolicy("export_recovery") // removeAuthority: policy_controller

  it("owner can remove in any policy", () => {
    expect(canRemoveMember(publicPolicy, "owner")).toBe(true)
    expect(canRemoveMember(recoveryPolicy, "owner")).toBe(true)
  })

  it("maintainer cannot remove in owner-only policies", () => {
    expect(canRemoveMember(publicPolicy, "maintainer")).toBe(false)
  })

  it("policy_controller can remove in export_recovery", () => {
    expect(canRemoveMember(recoveryPolicy, "policy_controller")).toBe(true)
  })

  it("contributor can never remove", () => {
    expect(canRemoveMember(publicPolicy, "contributor")).toBe(false)
    expect(canRemoveMember(recoveryPolicy, "contributor")).toBe(false)
  })
})

// ── createMlsCredential / verifyMlsCredential ────────────────────────────

describe("createMlsCredential", () => {
  it("creates a well-formed credential with deterministic policy digest", () => {
    const cred = createMlsCredential(
      "did:dharma:alice",
      "abcdef0123456789",
      "deadbeefcafebabe",
      "0123456789abcdef",
    )
    expect(cred.identityId).toBe("did:dharma:alice")
    expect(cred.mlsSigningPublicKey).toBe("abcdef0123456789")
    expect(cred.mlsEncryptionPublicKey).toBe("deadbeefcafebabe")
    expect(cred.dharmaIdentitySignature).toBe("0123456789abcdef")
    expect(cred.credentialPolicyDigest).toBeTruthy()
    expect(cred.credentialPolicyDigest.length).toBe(64) // hex-encoded sha256
  })
})

describe("verifyMlsCredential", () => {
  it("verifies a valid credential signed by the Dharma identity key", () => {
    const identityKeyPair = generateKeyPair()
    const identityPubHex = Buffer.from(identityKeyPair.publicKey).toString("hex")

    const mlsSignKey = "aabbccdd00112233"
    const mlsEncKey = "ffee1234aabb5678"
    const payload = Buffer.from(
      `mls-bind-v1:did:dharma:bob:${mlsSignKey}:${mlsEncKey}`,
      "utf-8",
    )

    // Sign the binding payload with the Dharma identity's private key
    const sigBytes = sign(identityKeyPair.privateKey, payload)
    const realSig = Buffer.from(sigBytes).toString("hex")

    const cred = createMlsCredential("did:dharma:bob", mlsSignKey, mlsEncKey, realSig)

    const result = verifyMlsCredential(cred, identityPubHex)
    expect(result).toBe(true)
  })

  it("rejects a credential with a tampered signature", () => {
    const cred = createMlsCredential(
      "did:dharma:mallory",
      "ff001122334455",
      "aabbccddee0011",
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    )
    // Generate a valid Dharma key pair — bogus signature won't match
    const keyPair = generateKeyPair()
    const pubHex = Buffer.from(keyPair.publicKey).toString("hex")
    const result = verifyMlsCredential(cred, pubHex)
    expect(result).toBe(false)
  })
})

// ── createMlsCommitReceipt / signMlsCommitReceipt ─────────────────────────

describe("createMlsCommitReceipt", () => {
  it("creates a receipt with deterministic ID", () => {
    const r1 = createMlsCommitReceipt("groupA", 0, 1, "create", ["alice"])
    const r2 = createMlsCommitReceipt("groupA", 0, 1, "create", ["alice"])
    expect(r1.receiptId).toBe(r2.receiptId)
    expect(r1.receiptId.length).toBe(16) // hex slice
  })

  it("preserves affected identities and operation", () => {
    const r = createMlsCommitReceipt("groupX", 1, 2, "remove", ["bob", "carol"])
    expect(r.groupId).toBe("groupX")
    expect(r.priorEpoch).toBe(1)
    expect(r.nextEpoch).toBe(2)
    expect(r.operation).toBe("remove")
    expect(r.affectedIdentities).toEqual(["bob", "carol"])
  })
})

describe("signMlsCommitReceipt", () => {
  it("attaches a deterministic signature", () => {
    const kp = generateKeyPair()
    const receipt = createMlsCommitReceipt("g1", 0, 1, "add", ["alice"])
    const signed = signMlsCommitReceipt(receipt, kp.privateKey)
    expect(signed.signature).toBeTruthy()
    expect(signed.signature.length).toBe(128) // 64 bytes hex
    expect(signed.receiptId).toBe(receipt.receiptId)
  })

  it("produces different signatures for different receipts", () => {
    const kp = generateKeyPair()
    const r1 = createMlsCommitReceipt("g1", 0, 1, "add", ["alice"])
    const r2 = createMlsCommitReceipt("g1", 0, 1, "add", ["bob"])
    const s1 = signMlsCommitReceipt(r1, kp.privateKey)
    const s2 = signMlsCommitReceipt(r2, kp.privateKey)
    expect(s1.signature).not.toBe(s2.signature)
  })
})

// ── derivePacketWrappingKey ───────────────────────────────────────────────

describe("derivePacketWrappingKey", () => {
  const SECRET = Buffer.alloc(32, 0xab)
  const GROUP_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
  const EPOCH = 7
  const PACKET_ID = "pkt-0001"
  const DOMAIN_ID = "domain-session"

  it("produces a 32-byte key", () => {
    const key = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, PACKET_ID, DOMAIN_ID, 1)
    expect(key.length).toBe(32)
  })

  it("produces deterministic output for identical inputs", () => {
    const k1 = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, PACKET_ID, DOMAIN_ID, 1)
    const k2 = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, PACKET_ID, DOMAIN_ID, 1)
    expect(k1).toEqual(k2)
  })

  it("produces different keys when groupId changes", () => {
    const k1 = derivePacketWrappingKey(SECRET, "groupA", EPOCH, PACKET_ID, DOMAIN_ID, 1)
    const k2 = derivePacketWrappingKey(SECRET, "groupB", EPOCH, PACKET_ID, DOMAIN_ID, 1)
    expect(k1).not.toEqual(k2)
  })

  it("produces different keys when epoch changes", () => {
    const k1 = derivePacketWrappingKey(SECRET, GROUP_ID, 1, PACKET_ID, DOMAIN_ID, 1)
    const k2 = derivePacketWrappingKey(SECRET, GROUP_ID, 2, PACKET_ID, DOMAIN_ID, 1)
    expect(k1).not.toEqual(k2)
  })

  it("produces different keys when packetId changes", () => {
    const k1 = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, "pkt-a", DOMAIN_ID, 1)
    const k2 = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, "pkt-b", DOMAIN_ID, 1)
    expect(k1).not.toEqual(k2)
  })

  it("produces different keys when domainId changes", () => {
    const k1 = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, PACKET_ID, "domain-public", 1)
    const k2 = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, PACKET_ID, "domain-session", 1)
    expect(k1).not.toEqual(k2)
  })

  it("produces different keys when schemaVersion changes", () => {
    const k1 = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, PACKET_ID, DOMAIN_ID, 1)
    const k2 = derivePacketWrappingKey(SECRET, GROUP_ID, EPOCH, PACKET_ID, DOMAIN_ID, 2)
    expect(k1).not.toEqual(k2)
  })

  it("produces different keys when the exporter secret changes", () => {
    const k1 = derivePacketWrappingKey(Buffer.alloc(32, 0xaa), GROUP_ID, EPOCH, PACKET_ID, DOMAIN_ID, 1)
    const k2 = derivePacketWrappingKey(Buffer.alloc(32, 0xbb), GROUP_ID, EPOCH, PACKET_ID, DOMAIN_ID, 1)
    expect(k1).not.toEqual(k2)
  })
})

// ── wrapDekWithEpochKey / unwrapDekWithEpochKey ──────────────────────────

describe("wrapDekWithEpochKey + unwrapDekWithEpochKey", () => {
  const DEK = Buffer.alloc(32, 0x42)
  const WRAPPING_KEY = Buffer.alloc(32, 0x77)

  it("wraps a DEK into ciphertext + iv + authTag", () => {
    const result = wrapDekWithEpochKey(DEK, WRAPPING_KEY)
    expect(result.wrappedDek.length).toBe(32) // ciphertext same size as plaintext for GCM
    expect(result.iv.length).toBe(12) // 96-bit IV
    expect(result.authTag.length).toBe(16) // 128-bit auth tag
    expect(result.wrappedDek).not.toEqual(DEK) // encryption changes bytes
  })

  it("round-trips successfully", () => {
    const { wrappedDek, iv, authTag } = wrapDekWithEpochKey(DEK, WRAPPING_KEY)
    const unwrapped = unwrapDekWithEpochKey(wrappedDek, WRAPPING_KEY, iv, authTag)
    expect(unwrapped).toEqual(DEK)
  })

  it("produces unique wrapped output on each call (different IV)", () => {
    const r1 = wrapDekWithEpochKey(DEK, WRAPPING_KEY)
    const r2 = wrapDekWithEpochKey(DEK, WRAPPING_KEY)
    expect(r1.wrappedDek).not.toEqual(r2.wrappedDek)
    expect(r1.iv).not.toEqual(r2.iv)
  })

  it("throws on wrong wrapping key", () => {
    const { wrappedDek, iv, authTag } = wrapDekWithEpochKey(DEK, WRAPPING_KEY)
    const wrongKey = Buffer.alloc(32, 0x99)
    expect(() => unwrapDekWithEpochKey(wrappedDek, wrongKey, iv, authTag)).toThrow()
  })

  it("throws on tampered wrappedDek", () => {
    const { wrappedDek, iv, authTag } = wrapDekWithEpochKey(DEK, WRAPPING_KEY)
    const tampered = Buffer.from(wrappedDek)
    tampered[0] ^= 0xff
    expect(() => unwrapDekWithEpochKey(tampered, WRAPPING_KEY, iv, authTag)).toThrow()
  })

  it("throws on wrong IV", () => {
    const { wrappedDek, iv, authTag } = wrapDekWithEpochKey(DEK, WRAPPING_KEY)
    const wrongIv = Buffer.alloc(12, 0x00)
    expect(() => unwrapDekWithEpochKey(wrappedDek, WRAPPING_KEY, wrongIv, authTag)).toThrow()
  })

  it("wraps and unwraps different DEKs", () => {
    const deks = [
      Buffer.alloc(32, 0x00),
      Buffer.alloc(32, 0xff),
      Buffer.from("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20", "hex"),
    ]
    for (const dek of deks) {
      const { wrappedDek, iv, authTag } = wrapDekWithEpochKey(dek, WRAPPING_KEY)
      const unwrapped = unwrapDekWithEpochKey(wrappedDek, WRAPPING_KEY, iv, authTag)
      expect(unwrapped).toEqual(dek)
    }
  })

  it("works end-to-end: derive key, wrap DEK, unwrap DEK", () => {
    const epochExporterSecret = Buffer.alloc(32, 0xab)
    const groupId = "test-group-id"
    const epoch = 3
    const packetId = "pkt-999"
    const domainId = "domain-session"

    // Derive wrapping key from MLS epoch context
    const wrappingKey = derivePacketWrappingKey(
      epochExporterSecret,
      groupId,
      epoch,
      packetId,
      domainId,
      1,
    )

    const dek = Buffer.alloc(32, 0x42)
    const { wrappedDek, iv, authTag } = wrapDekWithEpochKey(dek, wrappingKey)
    const unwrapped = unwrapDekWithEpochKey(wrappedDek, wrappingKey, iv, authTag)

    expect(unwrapped).toEqual(dek)
    expect(wrappedDek).not.toEqual(dek)
  })
})
