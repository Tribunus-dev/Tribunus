/**
 * Dharma Replication — Checkpoint Verification and Management
 *
 * Checkpoints provide recovery acceleration for the Autobase view.
 * They encode agreed-upon states that new or reconnecting peers
 * can use to bootstrap without replaying the full event log.
 */

import { createPublicKey, createPrivateKey, sign, verify } from "node:crypto"
import { canonicalJson } from "../types"
import type { FederationBootstrapRecord } from "./protocol"

// ── Types --------------------------------------------------------------------

export interface FederationCheckpoint {
  checkpointId: string
  federationId: string
  autobaseSignedLength: number
  autobaseHash: string
  viewRootHash: string
  createdByWriter: string
  createdAt: string
  signature: string
  localAdopted: boolean
  localAdoptedAt: string | null
}

// ── Verification -------------------------------------------------------------

/**
 * Verify a checkpoint against federation bootstrap and current Autobase state.
 */
export function verifyCheckpoint(
  checkpoint: FederationCheckpoint,
  bootstrap: FederationBootstrapRecord,
  currentAutobaseHash: string,
  currentSignedLength: number,
): { valid: boolean; reason: string | null } {
  // 1. Federation ID must match bootstrap
  if (checkpoint.federationId !== bootstrap.federationId) {
    return {
      valid: false,
      reason: `Checkpoint federationId mismatch: expected ${bootstrap.federationId}, got ${checkpoint.federationId}`,
    }
  }

  // 2. autobaseHash must match current hash
  if (checkpoint.autobaseHash !== currentAutobaseHash) {
    return {
      valid: false,
      reason: `Checkpoint autobaseHash mismatch: expected ${currentAutobaseHash}, got ${checkpoint.autobaseHash}`,
    }
  }

  // 3. signedLength must be >= checkpoint's signedLength
  if (currentSignedLength < checkpoint.autobaseSignedLength) {
    return {
      valid: false,
      reason: `Local signedLength ${currentSignedLength} < checkpoint signedLength ${checkpoint.autobaseSignedLength}`,
    }
  }

  // 4. Signature must verify against bootstrap's federation root key
  const signingPayload = buildCheckpointSigningPayload(checkpoint)

  try {
    const publicKeyObj = createPublicKey({
      key: Buffer.from(bootstrap.federationRootPublicKey, "hex"),
      type: "spki",
      format: "der",
    })
    const isValid = verify(
      null,
      signingPayload,
      publicKeyObj,
      Buffer.from(checkpoint.signature, "hex"),
    )

    if (!isValid) {
      return { valid: false, reason: "Checkpoint signature verification failed" }
    }
  } catch (err) {
    return {
      valid: false,
      reason: `Checkpoint signature verification error: ${(err as Error).message}`,
    }
  }

  return { valid: true, reason: null }
}

/** Create a checkpoint verification result */
export function createCheckpointRecord(
  checkpointId: string,
  federationId: string,
  signedLength: number,
  autobaseHash: string,
  viewRootHash: string,
  writerKey: string,
  signingKey: Uint8Array,
): FederationCheckpoint {
  const now = new Date().toISOString()

  const record = {
    checkpointId,
    federationId,
    autobaseSignedLength: signedLength,
    autobaseHash,
    viewRootHash,
    createdByWriter: writerKey,
    createdAt: now,
    localAdopted: false,
    localAdoptedAt: null,
  }

  // Sign the checkpoint
  const signingPayload = buildCheckpointSigningPayload(record as FederationCheckpoint)
  const privateKeyObj = createPrivateKey({
    key: Buffer.from(signingKey),
    type: "pkcs8",
    format: "der",
  })
  const signatureBuffer = sign(null, signingPayload, privateKeyObj)
  const signature = signatureBuffer.toString("hex")

  return {
    ...record,
    signature,
  }
}

// ── Helpers ------------------------------------------------------------------

/**
 * Build the canonical signing payload for a checkpoint.
 * This ensures deterministic signature verification.
 */
function buildCheckpointSigningPayload(checkpoint: FederationCheckpoint): Uint8Array {
  const normalized = {
    checkpointId: checkpoint.checkpointId,
    federationId: checkpoint.federationId,
    autobaseSignedLength: checkpoint.autobaseSignedLength,
    autobaseHash: checkpoint.autobaseHash,
    viewRootHash: checkpoint.viewRootHash,
    createdByWriter: checkpoint.createdByWriter,
    createdAt: checkpoint.createdAt,
  }
  return new TextEncoder().encode(canonicalJson(normalized))
}
