/**
 * Tests for Codex Merkle-Committed Dataset Snapshots
 */

import { describe, it, expect } from "bun:test"
import { createHash, generateKeyPairSync } from "node:crypto"
import {
  computeEntryCommitment,
  commitmentDigest,
  buildMerkleTree,
  computeMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  createDatasetSnapshot,
  signSnapshotRoot,
  verifySnapshotSignature,
  createReleaseCommitment,
  verifyReleaseCommitment,
  verifyExportAgainstSnapshot,
  canonicalSortCommitments,
} from "../codex-merkle"
import type { EntryCommitment } from "../codex-merkle"

// ── Helpers ─────────────────────────────────────────────────────────────

function makeCommitment(
  entryId: string,
  ciphertext?: Buffer,
  visibilityClass?: string,
  contentDigest?: string,
  logicalTime?: string,
): EntryCommitment {
  return {
    entryId,
    ciphertextDigest: createHash("sha256")
      .update(ciphertext ?? Buffer.from(entryId))
      .digest("hex"),
    visibilityClass: visibilityClass ?? "public",
    contentDigest: contentDigest ?? createHash("sha256").update(Buffer.from(`plain:${entryId}`)).digest("hex"),
    logicalTime: logicalTime ?? "1000",
  }
}

describe("computeEntryCommitment", () => {
  it("computes ciphertextDigest from the ciphertext buffer", () => {
    const ct = Buffer.from("encrypted-data")
    const comm = computeEntryCommitment("e1", ct, "public", "abc", "1000")

    const expectedDigest = createHash("sha256").update(ct).digest("hex")
    expect(comm.ciphertextDigest).toBe(expectedDigest)
    expect(comm.entryId).toBe("e1")
    expect(comm.visibilityClass).toBe("public")
    expect(comm.contentDigest).toBe("abc")
    expect(comm.logicalTime).toBe("1000")
  })
})

describe("commitmentDigest", () => {
  it("produces a deterministic hex digest", () => {
    const comm = makeCommitment("e1")
    const digest1 = commitmentDigest(comm)
    const digest2 = commitmentDigest(comm)

    expect(digest1).toBe(digest2)
    expect(digest1).toMatch(/^[0-9a-f]{64}$/)
  })

  it("produces different digests for different commitments", () => {
    const a = commitmentDigest(makeCommitment("e1"))
    const b = commitmentDigest(makeCommitment("e2"))
    expect(a).not.toBe(b)
  })
})

// ── Merkle Tree ─────────────────────────────────────────────────────────

describe("buildMerkleTree", () => {
  it("handles a single entry", () => {
    const comm = makeCommitment("e1")
    const tree = buildMerkleTree([comm])

    expect(tree.leafCount).toBe(1)
    expect(tree.leaves).toHaveLength(1)
    expect(tree.layers).toHaveLength(1) // just leaves layer
    expect(tree.root).toBe(tree.leaves[0])
  })

  it("builds correct root for two entries", () => {
    const e1 = makeCommitment("a1")
    const e2 = makeCommitment("b2")
    const tree = buildMerkleTree([e1, e2])

    const d1 = commitmentDigest(e1)
    const d2 = commitmentDigest(e2)
    const expectedRoot = createHash("sha256")
      .update(Buffer.from(d1, "hex"))
      .update(Buffer.from(d2, "hex"))
      .digest("hex")

    expect(tree.root).toBe(expectedRoot)
    expect(tree.layers).toHaveLength(2)
    expect(tree.layers[1]).toHaveLength(1)
  })

  it("produces deterministic root for same input set", () => {
    const commitments = [
      makeCommitment("e3"),
      makeCommitment("e1"),
      makeCommitment("e2"),
    ]

    const tree1 = buildMerkleTree(commitments)
    const tree2 = buildMerkleTree(commitments)

    expect(tree1.root).toBe(tree2.root)
  })

  it("produces same root regardless of input order", () => {
    const a = [makeCommitment("a"), makeCommitment("b"), makeCommitment("c")]
    const b = [makeCommitment("c"), makeCommitment("a"), makeCommitment("b")]

    expect(buildMerkleTree(a).root).toBe(buildMerkleTree(b).root)
  })

  it("promotes odd leaf by pairing with itself", () => {
    const commitments = [
      makeCommitment("x"),
      makeCommitment("y"),
      makeCommitment("z"),
    ]

    const tree = buildMerkleTree(commitments)
    expect(tree.layers).toHaveLength(3) // leaves + 1 internal level + root

    // Layer 1 should have 2 nodes (pair xy, then z paired with itself)
    expect(tree.layers[1]).toHaveLength(2)

    const dx = commitmentDigest(commitments[0])
    const dy = commitmentDigest(commitments[1])
    const dz = commitmentDigest(commitments[2])

    const xyNode = createHash("sha256")
      .update(Buffer.from(dx, "hex"))
      .update(Buffer.from(dy, "hex"))
      .digest("hex")

    // z pairs with itself
    const zzNode = createHash("sha256")
      .update(Buffer.from(dz, "hex"))
      .update(Buffer.from(dz, "hex"))
      .digest("hex")

    const expectedRoot = createHash("sha256")
      .update(Buffer.from(xyNode, "hex"))
      .update(Buffer.from(zzNode, "hex"))
      .digest("hex")

    expect(tree.root).toBe(expectedRoot)
  })

  it("handles four entries correctly", () => {
    const commitments = [
      makeCommitment("a"),
      makeCommitment("b"),
      makeCommitment("c"),
      makeCommitment("d"),
    ]

    const tree = buildMerkleTree(commitments)
    expect(tree.layers).toHaveLength(3) // leaves, 2 internal, root
    expect(tree.layers[1]).toHaveLength(2)
    expect(tree.layers[2]).toHaveLength(1)
    expect(tree.root).toBe(tree.layers[2][0])
  })
})

describe("computeMerkleRoot", () => {
  it("matches buildMerkleTree root", () => {
    const commitments = [
      makeCommitment("x"),
      makeCommitment("y"),
      makeCommitment("z"),
    ]

    const fullTree = buildMerkleTree(commitments)
    const rootOnly = computeMerkleRoot(commitments)

    expect(rootOnly).toBe(fullTree.root)
  })

  it("returns empty string for empty set", () => {
    expect(computeMerkleRoot([])).toBe("")
  })
})

describe("getMerkleProof + verifyMerkleProof", () => {
  it("returns empty proof for a single-leaf tree", () => {
    const tree = buildMerkleTree([makeCommitment("e1")])
    const proof = getMerkleProof(tree, 0)
    expect(proof).toHaveLength(0)
  })

  it("produces a valid proof for each leaf in a multi-entry tree", () => {
    const commitments = [
      makeCommitment("a"),
      makeCommitment("b"),
      makeCommitment("c"),
      makeCommitment("d"),
      makeCommitment("e"),
    ]

    const tree = buildMerkleTree(commitments)

    for (let i = 0; i < tree.leafCount; i++) {
      const proof = getMerkleProof(tree, i)
      const leaf = tree.leaves[i]
      const valid = verifyMerkleProof(tree.root, leaf, proof, i)
      expect(valid).toBe(true)
    }
  })

  it("rejects proof for wrong leaf", () => {
    const commitments = [
      makeCommitment("a"),
      makeCommitment("b"),
      makeCommitment("c"),
    ]

    const tree = buildMerkleTree(commitments)

    const leaf0 = tree.leaves[0]
    const proof0 = getMerkleProof(tree, 0)

    // Verify leaf0's proof against leaf1's hash — should fail
    const valid = verifyMerkleProof(tree.root, tree.leaves[1], proof0, 0)
    expect(valid).toBe(false)
  })

  it("rejects proof with tampered root", () => {
    const commitments = [
      makeCommitment("a"),
      makeCommitment("b"),
    ]

    const tree = buildMerkleTree(commitments)
    const proof = getMerkleProof(tree, 0)
    const leaf = tree.leaves[0]

    const valid = verifyMerkleProof("ff" + tree.root.slice(2), leaf, proof, 0)
    expect(valid).toBe(false)
  })

  it("throws for out-of-range leaf index", () => {
    const tree = buildMerkleTree([makeCommitment("e1")])
    expect(() => getMerkleProof(tree, 1)).toThrow(RangeError)
    expect(() => getMerkleProof(tree, -1)).toThrow(RangeError)
  })
})

// ── Canonical Sort ──────────────────────────────────────────────────────

describe("canonicalSortCommitments", () => {
  it("sorts by entryId (string comparison)", () => {
    const unsorted = [
      makeCommitment("z"),
      makeCommitment("a"),
      makeCommitment("m"),
    ]

    const sorted = canonicalSortCommitments(unsorted)
    expect(sorted[0].entryId).toBe("a")
    expect(sorted[1].entryId).toBe("m")
    expect(sorted[2].entryId).toBe("z")
  })

  it("does not mutate the original array", () => {
    const original = [makeCommitment("b"), makeCommitment("a")]
    const originalOrder = original.map((c) => c.entryId).join(",")
    canonicalSortCommitments(original)
    expect(original.map((c) => c.entryId).join(",")).toBe(originalOrder)
  })

  it("produces consistent Merkle roots via canonical sort", () => {
    const unordered = [
      makeCommitment("c"),
      makeCommitment("a"),
      makeCommitment("b"),
    ]

    // Using buildMerkleTree (which sorts internally) should produce
    // the same root regardless of input order
    const root1 = computeMerkleRoot(unordered)
    const root2 = computeMerkleRoot([...unordered].reverse())
    const root3 = computeMerkleRoot([
      unordered[1],
      unordered[2],
      unordered[0],
    ])

    expect(root1).toBe(root2)
    expect(root2).toBe(root3)
  })
})

// ── Dataset Snapshot ────────────────────────────────────────────────────

describe("createDatasetSnapshot", () => {
  it("produces a snapshot with matching metadata", () => {
    const commitments = [
      makeCommitment("e1"),
      makeCommitment("e2"),
    ]
    const heads = ["head1", "head2"]
    const logicalTime = "2025-01-01T00:00:00Z"

    const snapshot = createDatasetSnapshot(commitments, heads, logicalTime)

    expect(snapshot.entryCount).toBe(2)
    expect(snapshot.claimCount).toBe(2)
    expect(snapshot.logicalTime).toBe(logicalTime)
    expect(snapshot.autobaseHeads).toEqual(heads)
    expect(snapshot.merkleRoot).toBe(computeMerkleRoot(commitments))
    expect(snapshot.merkleTree.leafCount).toBe(2)
    expect(snapshot.snapshotId).toMatch(/^[0-9a-f]{64}$/)
  })

  it("produces deterministic snapshotId for same inputs", () => {
    const commitments = [makeCommitment("e1")]
    const heads = ["h1"]
    const t = "2025-01-01T00:00:00Z"

    const s1 = createDatasetSnapshot(commitments, heads, t)
    const s2 = createDatasetSnapshot(commitments, heads, t)

    expect(s1.snapshotId).toBe(s2.snapshotId)
  })
})

// ── Signature Operations ───────────────────────────────────────────────

describe("signSnapshotRoot + verifySnapshotSignature", () => {
  it("round-trips successfully", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )

    const signature = signSnapshotRoot(snapshot, privateKey)
    expect(signature).toMatch(/^[0-9a-f]{128}$/) // 64 bytes = 128 hex chars

    const valid = verifySnapshotSignature(snapshot, signature, publicKey)
    expect(valid).toBe(true)
  })

  it("rejects signature from wrong key", () => {
    const key1 = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })
    const key2 = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )

    const signature = signSnapshotRoot(snapshot, key1.privateKey)
    const valid = verifySnapshotSignature(snapshot, signature, key2.publicKey)

    expect(valid).toBe(false)
  })

  it("rejects tampered signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )

    const signature = signSnapshotRoot(snapshot, privateKey)
    const valid = verifySnapshotSignature(snapshot, "00" + "00".repeat(63), publicKey)  // all-zeros "signature"

    expect(valid).toBe(false)
  })

  it("rejects signature for a different snapshot root", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot1 = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )
    const snapshot2 = createDatasetSnapshot(
      [makeCommitment("e2")],
      ["head"],
      "1000",
    )

    const signature = signSnapshotRoot(snapshot1, privateKey)
    const valid = verifySnapshotSignature(snapshot2, signature, publicKey)

    expect(valid).toBe(false)
  })
})

// ── Release Commitment ──────────────────────────────────────────────────

describe("createReleaseCommitment + verifyReleaseCommitment", () => {
  it("round-trips successfully", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )

    const commitment = createReleaseCommitment(snapshot, privateKey, publicKey)

    expect(commitment.snapshotId).toBe(snapshot.snapshotId)
    expect(commitment.merkleRoot).toBe(snapshot.merkleRoot)
    expect(commitment.signerPublicKeyHex).toBe(publicKey.toString("hex"))
    expect(commitment.signatureHex).toMatch(/^[0-9a-f]{128}$/)

    const valid = verifyReleaseCommitment(commitment, snapshot.snapshotId)
    expect(valid).toBe(true)
  })

  it("fails verification for wrong snapshot ID", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )
    const commitment = createReleaseCommitment(snapshot, privateKey, publicKey)
    const valid = verifyReleaseCommitment(commitment, "wrong-snapshot-id")

    expect(valid).toBe(false)
  })

  it("fails verification with tampered signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )
    const commitment = createReleaseCommitment(snapshot, privateKey, publicKey)

    const tampered = {
      ...commitment,
      signatureHex: "00" + commitment.signatureHex.slice(2),
    }
    const valid = verifyReleaseCommitment(tampered, snapshot.snapshotId)

    expect(valid).toBe(false)
  })

  it("fails verification with empty merkleRoot", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )
    const commitment = createReleaseCommitment(snapshot, privateKey, publicKey)

    const bad = { ...commitment, merkleRoot: "" }
    const valid = verifyReleaseCommitment(bad, snapshot.snapshotId)

    expect(valid).toBe(false)
  })

  it("fails verification with invalid public key hex", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    })

    const snapshot = createDatasetSnapshot(
      [makeCommitment("e1")],
      ["head"],
      "1000",
    )
    const commitment = createReleaseCommitment(snapshot, privateKey, publicKey)

    const bad = { ...commitment, signerPublicKeyHex: "" }
    const valid = verifyReleaseCommitment(bad, snapshot.snapshotId)

    expect(valid).toBe(false)
  })
})

// ── Export Verification ─────────────────────────────────────────────────

describe("verifyExportAgainstSnapshot", () => {
  it("passes when entries match the expected root", () => {
    const entries = [
      { ciphertext: Buffer.from("data1") },
      { ciphertext: Buffer.from("data2") },
      { ciphertext: Buffer.from("data3") },
    ]

    // Build entries EntryCommitments matching verifyExportAgainstSnapshot logic
    const commitments: EntryCommitment[] = entries.map((e, i) => ({
      entryId: String(i),
      ciphertextDigest: createHash("sha256").update(e.ciphertext).digest("hex"),
      visibilityClass: "",
      contentDigest: "",
      logicalTime: "",
    }))

    const expectedRoot = computeMerkleRoot(commitments)

    const result = verifyExportAgainstSnapshot(entries, expectedRoot)
    expect(result).toBe(true)
  })

  it("fails when entries do not match the expected root", () => {
    const entries = [
      { ciphertext: Buffer.from("data1") },
      { ciphertext: Buffer.from("data2") },
    ]

    const wrongRoot =
      "0000000000000000000000000000000000000000000000000000000000000000"

    const result = verifyExportAgainstSnapshot(entries, wrongRoot)
    expect(result).toBe(false)
  })

  it("fails when entry count differs from expected", () => {
    const entries = [
      { ciphertext: Buffer.from("data1") },
      { ciphertext: Buffer.from("data2") },
    ]

    // Build commitments for three entries but only verify two
    const commitments: EntryCommitment[] = [
      { entryId: "0", ciphertextDigest: createHash("sha256").update(Buffer.from("data1")).digest("hex"), visibilityClass: "", contentDigest: "", logicalTime: "" },
      { entryId: "1", ciphertextDigest: createHash("sha256").update(Buffer.from("data2")).digest("hex"), visibilityClass: "", contentDigest: "", logicalTime: "" },
      { entryId: "2", ciphertextDigest: createHash("sha256").update(Buffer.from("data3")).digest("hex"), visibilityClass: "", contentDigest: "", logicalTime: "" },
    ]

    const rootForThree = computeMerkleRoot(commitments)
    const result = verifyExportAgainstSnapshot(entries, rootForThree)

    expect(result).toBe(false)
  })

  it("handles single-entry export", () => {
    const entries = [{ ciphertext: Buffer.from("single-entry") }]

    const root = verifyExportAgainstSnapshot(entries, "")
    expect(root).toBe(false)

    // Correct root should pass
    const commitment: EntryCommitment = {
      entryId: "0",
      ciphertextDigest: createHash("sha256").update(entries[0].ciphertext).digest("hex"),
      visibilityClass: "",
      contentDigest: "",
      logicalTime: "",
    }
    const correctRoot = computeMerkleRoot([commitment])
    expect(verifyExportAgainstSnapshot(entries, correctRoot)).toBe(true)
  })
})
