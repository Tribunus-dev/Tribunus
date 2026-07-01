/**
 * Codex — Merkle-Committed Dataset Snapshots
 *
 * A Merkle tree over encrypted entry commitments. The root is signed by
 * the offline key and embedded in release manifests. Anyone can verify
 * an export matches the authorized snapshot; nobody can produce a different
 * export under your signature.
 *
 * Merkle leaves are sorted by entryId to ensure a deterministic root.
 * Each internal node is SHA-256(left_child || right_child).
 * Odd-numbered leaves at any layer are promoted (paired with themselves).
 * The root is SHA-256 of the final layer's single element.
 */

import { createHash } from "node:crypto"
import { sign, verify as edVerify } from "../../crypto"

// ── Entry Commitment ────────────────────────────────────────────────────

export interface EntryCommitment {
  entryId: string
  ciphertextDigest: string // SHA-256 of the AEAD ciphertext
  visibilityClass: string
  contentDigest: string // SHA-256 of the plaintext (for dedup)
  logicalTime: string
}

/**
 * Compute an EntryCommitment from its constituent parts.
 *
 * ciphertextDigest is computed automatically from the ciphertext Buffer.
 */
export function computeEntryCommitment(
  entryId: string,
  ciphertext: Buffer,
  visibilityClass: string,
  contentDigest: string,
  logicalTime: string,
): EntryCommitment {
  const ciphertextDigest = createHash("sha256")
    .update(ciphertext)
    .digest("hex")

  return {
    entryId,
    ciphertextDigest,
    visibilityClass,
    contentDigest,
    logicalTime,
  }
}

/**
 * Compute the canonical SHA-256 digest of an EntryCommitment.
 *
 * The commitment is serialized as JSON with keys in field-declaration order;
 * this produces a stable leaf value for the Merkle tree.
 */
export function commitmentDigest(commitment: EntryCommitment): string {
  const canonical = JSON.stringify({
    entryId: commitment.entryId,
    ciphertextDigest: commitment.ciphertextDigest,
    visibilityClass: commitment.visibilityClass,
    contentDigest: commitment.contentDigest,
    logicalTime: commitment.logicalTime,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

// ── Merkle Tree ─────────────────────────────────────────────────────────

export interface MerkleTree {
  leaves: string[] // sorted commitment digests
  layers: string[][] // bottom-up, leaves are layer 0
  root: string // Merkle root hex digest
  leafCount: number
}

/**
 * Build a complete Merkle tree from a set of EntryCommitments.
 *
 * Leaves are sorted by entryId for determinism. The returned tree
 * contains every layer from the leaves up to the root.
 */
export function buildMerkleTree(commitments: EntryCommitment[]): MerkleTree {
  const sorted = canonicalSortCommitments(commitments)
  const leaves = sorted.map(commitmentDigest)

  if (leaves.length === 0) {
    return { leaves: [], layers: [], root: "", leafCount: 0 }
  }

  const layers: string[][] = [leaves]
  let current = leaves

  while (current.length > 1) {
    const next: string[] = []
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]
      const right = i + 1 < current.length ? current[i + 1] : left
      const hash = createHash("sha256")
        .update(Buffer.from(left, "hex"))
        .update(Buffer.from(right, "hex"))
        .digest("hex")
      next.push(hash)
    }
    layers.push(next)
    current = next
  }

  const root = current[0]

  return { leaves, layers, root, leafCount: leaves.length }
}

/**
 * Compute only the Merkle root digest for a set of commitments.
 *
 * More efficient than building the full tree when only the root is needed.
 */
export function computeMerkleRoot(commitments: EntryCommitment[]): string {
  const sorted = canonicalSortCommitments(commitments)
  const leaves = sorted.map(commitmentDigest)

  if (leaves.length === 0) {
    return ""
  }

  let current = leaves
  while (current.length > 1) {
    const next: string[] = []
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]
      const right = i + 1 < current.length ? current[i + 1] : left
      const hash = createHash("sha256")
        .update(Buffer.from(left, "hex"))
        .update(Buffer.from(right, "hex"))
        .digest("hex")
      next.push(hash)
    }
    current = next
  }

  return current[0]
}

/**
 * Get the Merkle proof (sibling hashes) for a leaf at the given index.
 *
 * Returns an array of hex digests ordered from leaf to root. To verify,
 * hash the leaf with each sibling in sequence using the same pairing rule.
 */
export function getMerkleProof(
  tree: MerkleTree,
  leafIndex: number,
): string[] {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new RangeError(
      `leafIndex ${leafIndex} out of range [0, ${tree.leafCount})`,
    )
  }

  const proof: string[] = []
  let idx = leafIndex

  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const currentLayer = tree.layers[layer]
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1

    if (siblingIdx < currentLayer.length) {
      proof.push(currentLayer[siblingIdx])
    } else {
      // Odd count: leaf was promoted (paired with itself), so sibling = itself
      proof.push(currentLayer[idx])
    }

    idx = Math.floor(idx / 2)
  }

  return proof
}

/**
 * Verify a Merkle proof against a claimed root.
 *
 * @param root - Claimed Merkle root hex digest
 * @param leaf - Leaf commitment digest hex
 * @param proof - Sibling hashes from getMerkleProof, ordered leaf→root
 * @param leafIndex - Index of the leaf in the tree, used to determine pairing direction
 * @returns true if the recomputed root matches the claimed root
 */
export function verifyMerkleProof(
  root: string,
  leaf: string,
  proof: string[],
  leafIndex: number,
): boolean {
  let current = leaf
  let idx = leafIndex

  for (const sibling of proof) {
    const left = idx % 2 === 0 ? current : sibling
    const right = idx % 2 === 0 ? sibling : current
    current = createHash("sha256")
      .update(Buffer.from(left, "hex"))
      .update(Buffer.from(right, "hex"))
      .digest("hex")
    idx = Math.floor(idx / 2)
  }

  return current === root
}

// ── Dataset Snapshot ────────────────────────────────────────────────────

export interface DatasetSnapshot {
  snapshotId: string
  merkleRoot: string
  autobaseHeads: string[]
  entryCount: number
  claimCount: number
  logicalTime: string
  merkleTree: MerkleTree
}

/**
 * Create a DatasetSnapshot from entry commitments and metadata.
 *
 * The snapshotId is a SHA-256 digest of canonical commitment data,
 * providing a concise fingerprint.
 */
export function createDatasetSnapshot(
  commitments: EntryCommitment[],
  autobaseHeads: string[],
  logicalTime: string,
): DatasetSnapshot {
  const merkleTree = buildMerkleTree(commitments)
  const claimCount = commitments.length

  // Snapshot id: SHA-256 of merkleRoot + logicalTime + sorted autobaseHeads
  const idInput =
    merkleTree.root +
    logicalTime +
    [...autobaseHeads].sort().join("")
  const snapshotId = createHash("sha256").update(idInput).digest("hex")

  return {
    snapshotId,
    merkleRoot: merkleTree.root,
    autobaseHeads,
    entryCount: claimCount,
    claimCount,
    logicalTime,
    merkleTree,
  }
}

/**
 * Sign the Merkle root of a snapshot with an Ed25519 private key.
 *
 * Returns the signature as a hex string.
 */
export function signSnapshotRoot(
  snapshot: DatasetSnapshot,
  signingKey: Uint8Array,
): string {
  const rootBytes = Buffer.from(snapshot.merkleRoot, "hex")
  const sig = sign(signingKey, rootBytes)
  return Buffer.from(sig).toString("hex")
}

/**
 * Verify an Ed25519 signature over a snapshot's Merkle root.
 *
 * @param snapshot - The snapshot whose root was signed
 * @param signature - Hex-encoded Ed25519 signature
 * @param publicKey - Ed25519 public key buffer
 * @returns true if the signature is valid
 */
export function verifySnapshotSignature(
  snapshot: DatasetSnapshot,
  signature: string,
  publicKey: Buffer,
): boolean {
  const rootBytes = Buffer.from(snapshot.merkleRoot, "hex")
  const sigBuffer = Buffer.from(signature, "hex")
  return edVerify(publicKey, rootBytes, sigBuffer)
}

// ── Release Commitment (stored in FullDatasetExportAuthorization) ───────

export interface ReleaseCommitment {
  snapshotId: string
  merkleRoot: string
  signatureHex: string
  signerPublicKeyHex: string
  signedAt: string
}

/**
 * Create a ReleaseCommitment by signing a DatasetSnapshot's Merkle root.
 *
 * The ReleaseCommitment is stored in the FullDatasetExportAuthorization
 * and provides cryptographic proof that a specific dataset snapshot was
 * authorized by the offline key.
 */
export function createReleaseCommitment(
  snapshot: DatasetSnapshot,
  signingKey: Uint8Array,
  publicKey: Buffer,
): ReleaseCommitment {
  const signatureHex = signSnapshotRoot(snapshot, signingKey)
  const signedAt = new Date().toISOString()

  return {
    snapshotId: snapshot.snapshotId,
    merkleRoot: snapshot.merkleRoot,
    signatureHex,
    signerPublicKeyHex: publicKey.toString("hex"),
    signedAt,
  }
}

/**
 * Verify a ReleaseCommitment against an expected snapshot ID.
 *
 * Checks:
 * 1. The snapshot ID matches
 * 2. The Merkle root is present (non-empty)
 * 3. The signature over the Merkle root is valid for the claimed public key
 * 4. The public key hex is valid
 *
 * @returns true if the release commitment is valid and matches the snapshot
 */
export function verifyReleaseCommitment(
  commitment: ReleaseCommitment,
  expectedSnapshotId: string,
): boolean {
  if (commitment.snapshotId !== expectedSnapshotId) {
    return false
  }

  if (!commitment.merkleRoot || commitment.signatureHex.length === 0) {
    return false
  }

  if (!commitment.signerPublicKeyHex || commitment.signerPublicKeyHex.length === 0) {
    return false
  }

  let publicKey: Buffer
  try {
    publicKey = Buffer.from(commitment.signerPublicKeyHex, "hex")
  } catch {
    return false
  }

  const rootBytes = Buffer.from(commitment.merkleRoot, "hex")
  let sigBuffer: Buffer
  try {
    sigBuffer = Buffer.from(commitment.signatureHex, "hex")
  } catch {
    return false
  }

  return edVerify(publicKey, rootBytes, sigBuffer)
}

// ── Verification ────────────────────────────────────────────────────────

/**
 * Verify that a set of ciphertext entries matches an expected Merkle root.
 *
 * Used during export verification: recomputes the Merkle root from the
 * ciphertexts' digests and checks it against the expected (authorized) root.
 *
 * @param entries - Array of objects containing ciphertext Buffers
 * @param expectedRoot - Expected Merkle root hex digest
 * @returns true if the computed root matches the expected root
 */
export function verifyExportAgainstSnapshot(
  entries: { ciphertext: Buffer }[],
  expectedRoot: string,
): boolean {
  // Build minimal commitments — only needs ciphertext digest for each
  const commitments: EntryCommitment[] = entries.map((entry, i) => ({
    entryId: String(i),
    ciphertextDigest: createHash("sha256")
      .update(entry.ciphertext)
      .digest("hex"),
    visibilityClass: "",
    contentDigest: "",
    logicalTime: "",
  }))

  const computedRoot = computeMerkleRoot(commitments)
  return computedRoot === expectedRoot
}

/**
 * Sort commitments canonically by entryId (string comparison).
 *
 * This ensures deterministic Merkle roots independent of insertion order.
 */
export function canonicalSortCommitments(
  commitments: EntryCommitment[],
): EntryCommitment[] {
  return [...commitments].sort((a, b) => a.entryId.localeCompare(b.entryId))
}
