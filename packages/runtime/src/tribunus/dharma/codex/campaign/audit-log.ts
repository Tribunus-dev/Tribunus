/**
 * Codex — Phase 5: Audit Survivability
 *
 * Publish Merkle roots of each release snapshot to a verifiable, immutable log.
 * Anyone can verify that entries were part of an authorized export without
 * access to any private key.
 *
 * ── Design ─────────────────────────────────────────────────────────────────
 *  1.  A PublishedSnapshot wraps a Merkle root with threshold signatures,
 *      a cross-signature from a timestamping service, and a canonical
 *      receipt digest.
 *  2.  Each snapshot digest is appended to an ImmutableLog whose entries
 *      form a hash chain — every entry carries the SHA-256 of its
 *      predecessor, making tampering detectable.
 *  3.  RevocationCommitment records allow superseded entries to be
 *      committed alongside future snapshots.
 *  4.  All verification functions are public — no private key required.
 */

import { createHash, randomBytes } from "node:crypto"
import { sign, verify } from "../../crypto"

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMESTAMP_SERVICE_ID = "codex-timestamp-v1"
const APPEND_ENTRY_PREFIX = "append:"

// ── Snapshot Publication ──────────────────────────────────────────────────────

export interface PublishedSnapshot {
  snapshotId: string
  merkleRoot: string
  entryCount: number
  excludedCount: number
  logicalTime: string
  /** Threshold signatures from Phase 1 (hex-encoded Ed25519 signatures) */
  signatures: string[]
  /** Timestamp service signature (hex-encoded, simulated) */
  crossSignature: string
  /** Deterministic hash of the snapshot's core identity fields */
  receiptDigest: string
  /** ISO-8601 timestamp of publication */
  publishedAt: string
}

/**
 * Create a PublishedSnapshot from its essential fields.
 *
 * `receiptDigest` and `snapshotId` are computed deterministically from the
 * input data.  `signatures` is the caller-provided array of threshold-signed
 * hex strings (from Phase 1).  `crossSignature` and `publishedAt` are
 * initialised to empty / the current time respectively.
 */
export function createPublishedSnapshot(
  merkleRoot: string,
  entryCount: number,
  excludedCount: number,
  signatures: string[],
): PublishedSnapshot {
  const publishedAt = new Date().toISOString()

  const receiptDigest = createHash("sha256")
    .update(
      JSON.stringify({
        merkleRoot,
        entryCount,
        excludedCount,
        signatures,
      }),
    )
    .digest("hex")

  const snapshotId = createHash("sha256")
    .update(`snapshot:${merkleRoot}:${receiptDigest}`)
    .digest("hex")

  return {
    snapshotId,
    merkleRoot,
    entryCount,
    excludedCount,
    logicalTime: publishedAt,
    signatures,
    crossSignature: "",
    receiptDigest,
    publishedAt,
  }
}

/**
 * Compute a deterministic digest of the snapshot's identity fields.
 *
 * The digest covers everything except `signatures` and `crossSignature`,
 * so that verification of the publication payload is stable regardless
 * of how many parties cosigned.
 */
export function computeSnapshotDigest(snapshot: PublishedSnapshot): string {
  const canonical = [
    snapshot.snapshotId,
    snapshot.merkleRoot,
    String(snapshot.entryCount),
    String(snapshot.excludedCount),
    snapshot.logicalTime,
    snapshot.receiptDigest,
    snapshot.publishedAt,
  ].join("|")

  return createHash("sha256").update(canonical).digest("hex")
}

// ── Timestamping ─────────────────────────────────────────────────────────────

export interface TimestampProof {
  snapshotDigest: string
  timestampServiceId: string
  timestamp: string
  /** Ed25519 signature over `timestampServiceId|snapshotDigest|timestamp` */
  signature: string
}

/**
 * Create a TimestampProof by signing the snapshot digest with the
 * timestamping service's Ed25519 private key.
 *
 * The timestamp is set to the current ISO-8601 time.
 */
export function createTimestampProof(
  snapshotDigest: string,
  timestampingKey: Uint8Array,
): TimestampProof {
  const timestamp = new Date().toISOString()
  const payload = `${TIMESTAMP_SERVICE_ID}|${snapshotDigest}|${timestamp}`
  const sig = sign(timestampingKey, Buffer.from(payload, "utf-8"))
  const signature = Buffer.from(sig).toString("hex")

  return {
    snapshotDigest,
    timestampServiceId: TIMESTAMP_SERVICE_ID,
    timestamp,
    signature,
  }
}

/**
 * Verify a TimestampProof against the expected digest and service public key.
 *
 * Returns `true` if the Ed25519 signature is valid.
 */
export function verifyTimestampProof(
  proof: TimestampProof,
  expectedDigest: string,
  servicePublicKey: Buffer,
): boolean {
  if (proof.snapshotDigest !== expectedDigest) return false
  const payload = `${proof.timestampServiceId}|${proof.snapshotDigest}|${proof.timestamp}`
  const sig = Buffer.from(proof.signature, "hex")
  return verify(servicePublicKey, Buffer.from(payload, "utf-8"), sig)
}

// ── Verifiable Log ───────────────────────────────────────────────────────────

export interface ImmutableLog {
  entries: {
    index: number
    snapshotDigest: string
    publishedAt: string
  }[]
  /** SHA-256 of the previous entry, forming a hash chain.  Empty string
   *  for the initial (empty) log. */
  previousEntryHash: string
}

/**
 * Create an empty ImmutableLog.
 */
export function createImmutableLog(): ImmutableLog {
  return {
    entries: [],
    previousEntryHash: "",
  }
}

/**
 * Append a new snapshot digest to the log, linking it to the previous
 * entry via SHA-256.
 *
 * Returns a **new** ImmutableLog (the original is not mutated).
 */
export function appendToLog(log: ImmutableLog, snapshotDigest: string): ImmutableLog {
  const index = log.entries.length
  const publishedAt = new Date().toISOString()

  const entryPayload = `${APPEND_ENTRY_PREFIX}${index}|${snapshotDigest}|${publishedAt}|${log.previousEntryHash}`
  const entryHash = createHash("sha256").update(entryPayload).digest("hex")

  return {
    entries: [
      ...log.entries,
      { index, snapshotDigest, publishedAt },
    ],
    previousEntryHash: entryHash,
  }
}

/**
 * Verify the integrity of the entire hash chain.
 *
 * Recomputes every entry's hash and checks that each links to the next.
 * Returns `true` if the full chain is valid.
 */
export function verifyLogIntegrity(log: ImmutableLog): boolean {
  let runningHash = ""

  for (let i = 0; i < log.entries.length; i++) {
    const entry = log.entries[i]
    const entryPayload = `${APPEND_ENTRY_PREFIX}${entry.index}|${entry.snapshotDigest}|${entry.publishedAt}|${runningHash}`
    const computedHash = createHash("sha256").update(entryPayload).digest("hex")

    // Verify this entry is the last one
    if (i === log.entries.length - 1) {
      if (computedHash !== log.previousEntryHash) return false
    }

    runningHash = computedHash
  }

  return true
}

/**
 * Find a snapshot digest in the log by linear scan.
 *
 * Returns the index of the first matching entry, or `null` if not found.
 */
export function findSnapshotInLog(log: ImmutableLog, snapshotDigest: string): number | null {
  for (const entry of log.entries) {
    if (entry.snapshotDigest === snapshotDigest) return entry.index
  }
  return null
}

// ── Verification (public) ─────────────────────────────────────────────────────

/**
 * Verify that a PublishedSnapshot's claimed Merkle root matches the
 * expected value.
 *
 * This is a simple equality check — the caller is responsible for
 * computing the Merkle root from the actual data set.
 */
export function verifySnapshotIntegrity(snapshot: PublishedSnapshot, merkleRoot: string): boolean {
  return snapshot.merkleRoot === merkleRoot
}

/**
 * Verify the timestamp cross-signature on a snapshot.
 *
 * Extracts the underlying TimestampProof from the snapshot's
 * crossSignature field and validates it against the expected
 * timestamp service public key.
 *
 * Returns `true` if the proof is valid.
 */
export function verifyTimestamp(
  snapshot: PublishedSnapshot,
  expectedTimestampServiceKey: Buffer,
): boolean {
  if (!snapshot.crossSignature || snapshot.crossSignature.length === 0) return false

  const snapshotDigest = computeSnapshotDigest(snapshot)
  const proof: TimestampProof = JSON.parse(
    Buffer.from(snapshot.crossSignature, "hex").toString("utf-8"),
  )

  return verifyTimestampProof(proof, snapshotDigest, expectedTimestampServiceKey)
}

/**
 * Verify that a snapshot digest is present in the ImmutableLog.
 */
export function verifySnapshotInclusion(log: ImmutableLog, snapshotDigest: string): boolean {
  return findSnapshotInLog(log, snapshotDigest) !== null
}

// ── Revocation Commitment ─────────────────────────────────────────────────────

export interface RevocationCommitment {
  entryId: string
  revokedAt: string
  supersededByEntryId: string | null
  logicalTime: string
  snapshotDigest: string
}

/**
 * Create a RevocationCommitment for a specific entry.
 *
 * When `supersededBy` is provided it records which entry replaces the
 * revoked one; otherwise the revocation is standalone.
 */
export function createRevocationCommitment(
  entryId: string,
  revokedAt: string,
  supersededBy?: string,
): RevocationCommitment {
  const snapshotDigest = createHash("sha256")
    .update(`revoke:${entryId}:${revokedAt}:${supersededBy ?? ""}`)
    .digest("hex")

  return {
    entryId,
    revokedAt,
    supersededByEntryId: supersededBy ?? null,
    logicalTime: new Date().toISOString(),
    snapshotDigest,
  }
}

/**
 * Include revocation commitments in a snapshot, updating the receipt
 * digest to reflect the new state.
 *
 * Returns a **new** PublishedSnapshot with the revocations recorded
 * in its receiptDigest (the original is not mutated).
 */
export function includeRevocationInSnapshot(
  snapshot: PublishedSnapshot,
  revocations: RevocationCommitment[],
): PublishedSnapshot {
  const revocationDigest = createHash("sha256")
    .update(
      JSON.stringify(revocations.map((r) => ({
        entryId: r.entryId,
        snapshotDigest: r.snapshotDigest,
      }))),
    )
    .digest("hex")

  const newReceiptDigest = createHash("sha256")
    .update(`${snapshot.receiptDigest}|revocations:${revocationDigest}`)
    .digest("hex")

  return {
    ...snapshot,
    receiptDigest: newReceiptDigest,
  }
}
