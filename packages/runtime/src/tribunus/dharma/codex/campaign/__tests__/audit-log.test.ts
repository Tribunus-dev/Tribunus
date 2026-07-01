/**
 * Tests for Codex Phase 5 — Audit Survivability
 *
 * Verifies that snapshot roots are publishable and verifiable without
 * private keys, log integrity is chain-verified, and revocations are
 * committed.
 */

import { describe, it, expect } from "bun:test"
import { generateKeyPairSync, createHash } from "node:crypto"
import {
  createPublishedSnapshot,
  computeSnapshotDigest,
  createTimestampProof,
  verifyTimestampProof,
  createImmutableLog,
  appendToLog,
  verifyLogIntegrity,
  findSnapshotInLog,
  verifySnapshotIntegrity,
  verifyTimestamp,
  verifySnapshotInclusion,
  createRevocationCommitment,
  includeRevocationInSnapshot,
} from "../audit-log"
import type {
  PublishedSnapshot,
  TimestampProof,
  ImmutableLog,
  RevocationCommitment,
} from "../audit-log"
import { sign, verify } from "../../../crypto"

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateEd25519KeyPair(): { publicKey: Buffer; privateKey: Buffer } {
  const kp = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  })
  return { publicKey: Buffer.from(kp.publicKey), privateKey: Buffer.from(kp.privateKey) }
}

// ── Snapshot Publication ──────────────────────────────────────────────────────

describe("createPublishedSnapshot", () => {
  it("creates a snapshot with deterministic snapshotId and receiptDigest", () => {
    const sigs = ["sig1hex", "sig2hex"]
    const snap = createPublishedSnapshot("abc123", 100, 2, sigs)

    expect(snap.merkleRoot).toBe("abc123")
    expect(snap.entryCount).toBe(100)
    expect(snap.excludedCount).toBe(2)
    expect(snap.signatures).toEqual(sigs)
    expect(snap.crossSignature).toBe("")
    expect(snap.snapshotId).toBeTruthy()
    expect(snap.receiptDigest).toBeTruthy()
    expect(snap.publishedAt).toBeTruthy()
    expect(snap.logicalTime).toBe(snap.publishedAt)
  })

  it("produces the same snapshotId for identical inputs", () => {
    const a = createPublishedSnapshot("root1", 50, 0, ["sigA"])
    const b = createPublishedSnapshot("root1", 50, 0, ["sigA"])
    expect(a.snapshotId).toBe(b.snapshotId)
    expect(a.receiptDigest).toBe(b.receiptDigest)
  })

  it("produces different snapshotId for different inputs", () => {
    const a = createPublishedSnapshot("root1", 50, 0, ["sigA"])
    const b = createPublishedSnapshot("root2", 50, 0, ["sigA"])
    expect(a.snapshotId).not.toBe(b.snapshotId)
  })
})

describe("computeSnapshotDigest", () => {
  it("returns a deterministic 64-char hex digest", () => {
    const snap = createPublishedSnapshot("abc", 10, 1, ["s1"])
    const digest = computeSnapshotDigest(snap)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    const digest2 = computeSnapshotDigest(snap)
    expect(digest).toBe(digest2)
  })

  it("changes when snapshot content changes", () => {
    const snap1 = createPublishedSnapshot("abc", 10, 1, ["s1"])
    const snap2 = createPublishedSnapshot("abc", 20, 1, ["s1"])
    expect(computeSnapshotDigest(snap1)).not.toBe(computeSnapshotDigest(snap2))
  })
})

// ── Timestamping ──────────────────────────────────────────────────────────────

describe("createTimestampProof + verifyTimestampProof", () => {
  it("creates and verifies a valid timestamp proof", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair()
    const digest = createHash("sha256").update("test-snapshot").digest("hex")

    const proof = createTimestampProof(digest, privateKey)
    expect(proof.snapshotDigest).toBe(digest)
    expect(proof.timestampServiceId).toBe("codex-timestamp-v1")
    expect(proof.signature).toMatch(/^[0-9a-f]{128}$/)

    const valid = verifyTimestampProof(proof, digest, publicKey)
    expect(valid).toBe(true)
  })

  it("rejects proof with wrong expected digest", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair()
    const digest = createHash("sha256").update("real").digest("hex")
    const wrongDigest = createHash("sha256").update("fake").digest("hex")

    const proof = createTimestampProof(digest, privateKey)
    expect(verifyTimestampProof(proof, wrongDigest, publicKey)).toBe(false)
  })

  it("rejects proof with wrong public key", () => {
    const { privateKey } = generateEd25519KeyPair()
    const wrongKp = generateEd25519KeyPair()
    const digest = createHash("sha256").update("test").digest("hex")

    const proof = createTimestampProof(digest, privateKey)
    expect(verifyTimestampProof(proof, digest, wrongKp.publicKey)).toBe(false)
  })

  it("rejects tampered signature", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair()
    const digest = createHash("sha256").update("test").digest("hex")

    const proof = createTimestampProof(digest, privateKey)
    proof.signature = "00" + proof.signature.slice(2)

    expect(verifyTimestampProof(proof, digest, publicKey)).toBe(false)
  })
})

// ── Verifiable Log ────────────────────────────────────────────────────────────

describe("createImmutableLog", () => {
  it("creates an empty log", () => {
    const log = createImmutableLog()
    expect(log.entries).toEqual([])
    expect(log.previousEntryHash).toBe("")
  })
})

describe("appendToLog + verifyLogIntegrity", () => {
  it("appends entries and verifies chain integrity", () => {
    let log = createImmutableLog()
    expect(verifyLogIntegrity(log)).toBe(true)

    const d1 = createHash("sha256").update("s1").digest("hex")
    log = appendToLog(log, d1)
    expect(log.entries).toHaveLength(1)
    expect(log.previousEntryHash).toBeTruthy()
    expect(verifyLogIntegrity(log)).toBe(true)

    const d2 = createHash("sha256").update("s2").digest("hex")
    log = appendToLog(log, d2)
    expect(log.entries).toHaveLength(2)
    expect(verifyLogIntegrity(log)).toBe(true)
  })

  it("fails integrity check when previousEntryHash is tampered", () => {
    let log = createImmutableLog()
    log = appendToLog(log, createHash("sha256").update("s1").digest("hex"))
    log = appendToLog(log, createHash("sha256").update("s2").digest("hex"))

    // Tamper with the chain hash
    const tampered: ImmutableLog = {
      ...log,
      previousEntryHash: "0000000000000000000000000000000000000000000000000000000000000000",
    }
    expect(verifyLogIntegrity(tampered)).toBe(false)
  })

  it("fails integrity check when an entry is removed", () => {
    let log = createImmutableLog()
    log = appendToLog(log, createHash("sha256").update("s1").digest("hex"))
    log = appendToLog(log, createHash("sha256").update("s2").digest("hex"))

    const truncated: ImmutableLog = {
      entries: [log.entries[0]],
      previousEntryHash: log.previousEntryHash,
    }
    expect(verifyLogIntegrity(truncated)).toBe(false)
  })

  it("fails integrity check when an entry is replaced", () => {
    let log = createImmutableLog()
    log = appendToLog(log, createHash("sha256").update("s1").digest("hex"))

    const fakeDigest = createHash("sha256").update("fake-snapshot").digest("hex")
    const tampered: ImmutableLog = {
      entries: [{ ...log.entries[0], snapshotDigest: fakeDigest }],
      previousEntryHash: log.previousEntryHash,
    }
    expect(verifyLogIntegrity(tampered)).toBe(false)
  })

  it("returns 0-length entries as valid", () => {
    const log = createImmutableLog()
    expect(verifyLogIntegrity(log)).toBe(true)
  })

  it("handles a single entry correctly", () => {
    let log = createImmutableLog()
    const d = createHash("sha256").update("only").digest("hex")
    log = appendToLog(log, d)
    expect(log.entries).toHaveLength(1)
    expect(verifyLogIntegrity(log)).toBe(true)
  })
})

describe("findSnapshotInLog", () => {
  it("finds an existing snapshot", () => {
    let log = createImmutableLog()
    const d1 = createHash("sha256").update("s1").digest("hex")
    const d2 = createHash("sha256").update("s2").digest("hex")
    log = appendToLog(log, d1)
    log = appendToLog(log, d2)

    expect(findSnapshotInLog(log, d1)).toBe(0)
    expect(findSnapshotInLog(log, d2)).toBe(1)
  })

  it("returns null for missing snapshot", () => {
    let log = createImmutableLog()
    log = appendToLog(log, createHash("sha256").update("s1").digest("hex"))
    expect(findSnapshotInLog(log, "nonexistent")).toBe(null)
  })

  it("returns null for empty log", () => {
    const log = createImmutableLog()
    expect(findSnapshotInLog(log, "anything")).toBe(null)
  })
})

// ── Public Verification ───────────────────────────────────────────────────────

describe("verifySnapshotIntegrity", () => {
  it("returns true when merkle root matches", () => {
    const snap = createPublishedSnapshot("root123", 42, 0, [])
    expect(verifySnapshotIntegrity(snap, "root123")).toBe(true)
  })

  it("returns false when merkle root mismatches", () => {
    const snap = createPublishedSnapshot("root123", 42, 0, [])
    expect(verifySnapshotIntegrity(snap, "wrong-root")).toBe(false)
  })
})

describe("verifySnapshotInclusion", () => {
  it("returns true for included snapshot", () => {
    let log = createImmutableLog()
    const snap = createPublishedSnapshot("root", 10, 0, [])
    const digest = computeSnapshotDigest(snap)
    log = appendToLog(log, digest)
    expect(verifySnapshotInclusion(log, digest)).toBe(true)
  })

  it("returns false for missing snapshot", () => {
    const log = createImmutableLog()
    expect(verifySnapshotInclusion(log, "nope")).toBe(false)
  })
})

describe("verifyTimestamp (integration)", () => {
  it("verifies a properly cross-signed snapshot", () => {
    const { publicKey, privateKey } = generateEd25519KeyPair()
    const snap = createPublishedSnapshot("root", 10, 0, ["sig"])
    const digest = computeSnapshotDigest(snap)
    const proof = createTimestampProof(digest, privateKey)

    // Embed the proof as the crossSignature (hex-encoded JSON)
    const snapWithProof: PublishedSnapshot = {
      ...snap,
      crossSignature: Buffer.from(JSON.stringify(proof), "utf-8").toString("hex"),
    }

    expect(verifyTimestamp(snapWithProof, publicKey)).toBe(true)
  })

  it("returns false when crossSignature is empty", () => {
    const { publicKey } = generateEd25519KeyPair()
    const snap = createPublishedSnapshot("root", 10, 0, ["sig"])
    expect(verifyTimestamp(snap, publicKey)).toBe(false)
  })

  it("returns false when signature is invalid", () => {
    const { publicKey } = generateEd25519KeyPair()
    const wrongKp = generateEd25519KeyPair()
    const snap = createPublishedSnapshot("root", 10, 0, ["sig"])
    const digest = computeSnapshotDigest(snap)
    const proof = createTimestampProof(digest, wrongKp.privateKey)

    const snapWithProof: PublishedSnapshot = {
      ...snap,
      crossSignature: Buffer.from(JSON.stringify(proof), "utf-8").toString("hex"),
    }

    expect(verifyTimestamp(snapWithProof, publicKey)).toBe(false)
  })
})

// ── Revocation Commitment ─────────────────────────────────────────────────────

describe("createRevocationCommitment", () => {
  it("creates a standalone revocation", () => {
    const rc = createRevocationCommitment("entry-1", "2026-06-01T00:00:00Z")
    expect(rc.entryId).toBe("entry-1")
    expect(rc.revokedAt).toBe("2026-06-01T00:00:00Z")
    expect(rc.supersededByEntryId).toBe(null)
    expect(rc.logicalTime).toBeTruthy()
    expect(rc.snapshotDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("creates a superseding revocation", () => {
    const rc = createRevocationCommitment("entry-1", "2026-06-02T00:00:00Z", "entry-2")
    expect(rc.supersededByEntryId).toBe("entry-2")
    expect(rc.entryId).toBe("entry-1")
  })

  it("creates deterministic snapshotDigest for same inputs", () => {
    const a = createRevocationCommitment("e1", "2026-06-01T00:00:00Z")
    const b = createRevocationCommitment("e1", "2026-06-01T00:00:00Z")
    expect(a.snapshotDigest).toBe(b.snapshotDigest)
  })

  it("creates different snapshotDigest for superseded vs standalone", () => {
    const standalone = createRevocationCommitment("e1", "2026-06-01T00:00:00Z")
    const superseded = createRevocationCommitment("e1", "2026-06-01T00:00:00Z", "e2")
    expect(standalone.snapshotDigest).not.toBe(superseded.snapshotDigest)
  })
})

describe("includeRevocationInSnapshot", () => {
  it("includes revocations and updates receiptDigest", () => {
    const snap = createPublishedSnapshot("root", 10, 0, [])
    const originalDigest = snap.receiptDigest

    const rc = createRevocationCommitment("e1", "2026-06-01T00:00:00Z")
    const updated = includeRevocationInSnapshot(snap, [rc])

    expect(updated.merkleRoot).toBe(snap.merkleRoot)
    expect(updated.entryCount).toBe(snap.entryCount)
    expect(updated.signatures).toEqual(snap.signatures)
    expect(updated.receiptDigest).not.toBe(originalDigest)
    expect(updated.receiptDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("does not mutate the original snapshot", () => {
    const snap = createPublishedSnapshot("root", 10, 0, [])
    const originalDigest = snap.receiptDigest

    const rc = createRevocationCommitment("e1", "2026-06-01T00:00:00Z")
    includeRevocationInSnapshot(snap, [rc])

    expect(snap.receiptDigest).toBe(originalDigest)
  })

  it("produces different receiptDigest for different revocations", () => {
    const snap = createPublishedSnapshot("root", 10, 0, [])
    const rc1 = createRevocationCommitment("e1", "2026-06-01T00:00:00Z")
    const rc2 = createRevocationCommitment("e2", "2026-06-01T00:00:00Z")

    const updated1 = includeRevocationInSnapshot(snap, [rc1])
    const updated2 = includeRevocationInSnapshot(snap, [rc2])

    expect(updated1.receiptDigest).not.toBe(updated2.receiptDigest)
  })

  it("handles empty revocations (receiptDigest still changes)", () => {
    const snap = createPublishedSnapshot("root", 10, 0, [])
    const originalDigest = snap.receiptDigest
    const updated = includeRevocationInSnapshot(snap, [])
    expect(updated.receiptDigest).not.toBe(originalDigest)
  })
})
