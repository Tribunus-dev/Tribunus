/**
 * MLS — Message Layer Security Integration Types
 *
 * MLS-based group-key management for the Codex. Each visibility domain
 * ("public", "contributor", "project", "session", "export_recovery") is
 * an MLS group. TreeKEM epoch keys wrap per-packet DEKs.
 *
 * This module provides:
 *   - MLS group descriptors and policy types
 *   - MLS credential binding (MLS keys + Dharma identity)
 *   - Packet key envelopes for DEK wrapping under epoch-derived keys
 *   - Dharma MLS commit receipts bridging group changes to the authority ledger
 *   - Epoch key derivation via HKDF and AES-256-GCM DEK wrapping
 */

import { randomBytes, createHmac, createCipheriv, createDecipheriv, createHash } from "node:crypto"
import { sign as dharmaSign, verify as dharmaVerify } from "../../crypto"

// ── Constants ─────────────────────────────────────────────────────────────────

export const CODEC_MLS_PROTOCOL_VERSION = 1

/** 256-bit data encryption key. */
const DEK_LENGTH = 32

/** 96-bit nonce for AES-256-GCM. */
const IV_LENGTH = 12

/** 128-bit GCM authentication tag. */
const TAG_LENGTH = 16

/**
 * Domain-specific context label for HKDF info when deriving epoch wrapping keys.
 * MLS exporter secret → HKDF(info, salt=0) → AES-256 wrapping key.
 */
const EPOCH_KEY_DERIVATION_LABEL = "codex-mls-epoch-wrap-v1"

// ── Domain Group Descriptor ──────────────────────────────────────────────────

export type MlsDomainKind = "public" | "contributor" | "project" | "session" | "export_recovery"

export interface CodexMlsGroupDescriptor {
  groupId: string
  domainId: string
  domainKind: MlsDomainKind
  mlsProtocolVersion: number
  ciphersuite: string
  authorityBinding: {
    dharmaPolicyDigest: string
    membershipRuleVersion: string
    autobaseHeadCommitment: string
  }
  currentEpoch: number
  groupStateDigest: string
  createdBy: string
  createdAtLogicalTime: string
}

// ── MLS Policy ──────────────────────────────────────────────────────────────

export interface CodexMlsPolicy {
  policyId: string
  domainKind: MlsDomainKind
  addAuthority: "owner" | "maintainer" | "policy_controller"
  removeAuthority: "owner" | "policy_controller"
  updateAuthority: "self_only" | "policy_controller"
  requireTreeKemPathOn: Array<"add" | "remove" | "update">
  historyAccess: "none" | "from_join_epoch" | "explicit_backfill_only"
  keyRotationTriggers: Array<
    | "member_add"
    | "member_remove"
    | "member_compromise"
    | "epoch_age"
    | "packet_count"
    | "policy_change"
  >
  maxEpochAgeMs: number
  maxPacketsPerEpoch: number
  externalCommitPolicy: "disabled" | "explicitly_authorized"
  externalProposalPolicy: "disabled" | "explicitly_authorized"
  requiredCredentialPolicyDigest: string
}

/**
 * Create a sensible default MLS policy for a given domain kind.
 *
 * - Public: open groups, permissive add/remove, long epochs.
 * - Contributor: moderately restricted, owner/maintainer authority.
 * - Project: restricted to maintainer add, owner remove.
 * - Session: tightly controlled, short-lived epochs.
 * - Export recovery: minimal membership, policy_controller authority.
 */
export function createDefaultMlsPolicy(domainKind: MlsDomainKind): CodexMlsPolicy {
  const hex = (n: number) => n.toString(16).padStart(64, "0")
  const policyId = `${CODEC_MLS_PROTOCOL_VERSION}-${domainKind}-default`

  switch (domainKind) {
    case "public":
      return {
        policyId,
        domainKind,
        addAuthority: "maintainer",
        removeAuthority: "owner",
        updateAuthority: "self_only",
        requireTreeKemPathOn: ["add", "update"],
        historyAccess: "from_join_epoch",
        keyRotationTriggers: ["member_add", "member_remove", "epoch_age", "packet_count"],
        maxEpochAgeMs: 86_400_000, // 24 hours
        maxPacketsPerEpoch: 1_000_000,
        externalCommitPolicy: "disabled",
        externalProposalPolicy: "explicitly_authorized",
        requiredCredentialPolicyDigest: hex(0x01),
      }
    case "contributor":
      return {
        policyId,
        domainKind,
        addAuthority: "maintainer",
        removeAuthority: "owner",
        updateAuthority: "self_only",
        requireTreeKemPathOn: ["add", "remove", "update"],
        historyAccess: "from_join_epoch",
        keyRotationTriggers: ["member_add", "member_remove", "member_compromise", "epoch_age", "packet_count"],
        maxEpochAgeMs: 43_200_000, // 12 hours
        maxPacketsPerEpoch: 100_000,
        externalCommitPolicy: "disabled",
        externalProposalPolicy: "disabled",
        requiredCredentialPolicyDigest: hex(0x02),
      }
    case "project":
      return {
        policyId,
        domainKind,
        addAuthority: "maintainer",
        removeAuthority: "owner",
        updateAuthority: "self_only",
        requireTreeKemPathOn: ["add", "remove", "update"],
        historyAccess: "from_join_epoch",
        keyRotationTriggers: ["member_add", "member_remove", "member_compromise", "epoch_age", "packet_count"],
        maxEpochAgeMs: 86_400_000, // 24 hours
        maxPacketsPerEpoch: 500_000,
        externalCommitPolicy: "disabled",
        externalProposalPolicy: "disabled",
        requiredCredentialPolicyDigest: hex(0x03),
      }
    case "session":
      return {
        policyId,
        domainKind,
        addAuthority: "owner",
        removeAuthority: "owner",
        updateAuthority: "self_only",
        requireTreeKemPathOn: ["add", "remove", "update"],
        historyAccess: "none",
        keyRotationTriggers: ["member_add", "member_remove", "epoch_age", "packet_count"],
        maxEpochAgeMs: 3_600_000, // 1 hour
        maxPacketsPerEpoch: 10_000,
        externalCommitPolicy: "disabled",
        externalProposalPolicy: "disabled",
        requiredCredentialPolicyDigest: hex(0x04),
      }
    case "export_recovery":
      return {
        policyId,
        domainKind,
        addAuthority: "policy_controller",
        removeAuthority: "policy_controller",
        updateAuthority: "policy_controller",
        requireTreeKemPathOn: ["add", "remove"],
        historyAccess: "explicit_backfill_only",
        keyRotationTriggers: ["member_compromise", "policy_change"],
        maxEpochAgeMs: 604_800_000, // 7 days
        maxPacketsPerEpoch: 50_000,
        externalCommitPolicy: "explicitly_authorized",
        externalProposalPolicy: "disabled",
        requiredCredentialPolicyDigest: hex(0x05),
      }
  }
}

/**
 * Check whether a member of the given role may add members under this policy.
 */
export function canAddMember(policy: CodexMlsPolicy, actorRole: string): boolean {
  switch (policy.addAuthority) {
    case "owner":
      return actorRole === "owner"
    case "maintainer":
      return actorRole === "owner" || actorRole === "maintainer"
    case "policy_controller":
      return actorRole === "policy_controller" || actorRole === "owner"
  }
}

/**
 * Check whether a member of the given role may remove members under this policy.
 */
export function canRemoveMember(policy: CodexMlsPolicy, actorRole: string): boolean {
  switch (policy.removeAuthority) {
    case "owner":
      return actorRole === "owner"
    case "policy_controller":
      return actorRole === "policy_controller" || actorRole === "owner"
  }
}

// ── MLS Credential ──────────────────────────────────────────────────────────

export interface CodexMlsCredential {
  identityId: string
  mlsSigningPublicKey: string
  mlsEncryptionPublicKey: string
  dharmaIdentitySignature: string
  credentialPolicyDigest: string
}

/**
 * Create an MLS credential binding MLS keying material to a Dharma identity.
 *
 * The dharmaIdentitySignature is an Ed25519 signature over the concatenation
 * of the MLS signing and encryption public keys, produced by the Dharma
 * identity's signing key.
 */
export function createMlsCredential(
  identityId: string,
  mlsSigningKey: string,
  mlsEncKey: string,
  dharmaSig: string,
): CodexMlsCredential {
  return {
    identityId,
    mlsSigningPublicKey: mlsSigningKey,
    mlsEncryptionPublicKey: mlsEncKey,
    dharmaIdentitySignature: dharmaSig,
    credentialPolicyDigest: createHash("sha256")
      .update(`mls-credential-policy-v1:${identityId}:${mlsSigningKey}:${mlsEncKey}`)
      .digest("hex"),
  }
}

/**
 * Verify that an MLS credential's dharmaIdentitySignature is valid for the
 * given Dharma identity public key.
 *
 * The signed payload is: `mls-bind-v1:<identityId>:<mlsSigningKey>:<mlsEncryptionKey>`
 */
export function verifyMlsCredential(
  cred: CodexMlsCredential,
  dharmaIdentityKey: string,
): boolean {
  const payload = Buffer.from(
    `mls-bind-v1:${cred.identityId}:${cred.mlsSigningPublicKey}:${cred.mlsEncryptionPublicKey}`,
    "utf-8",
  )
  const sig = Buffer.from(cred.dharmaIdentitySignature, "hex")
  const pubKey = Buffer.from(dharmaIdentityKey, "hex")
  return dharmaVerify(pubKey, payload, sig)
}

// ── Packet Key Envelope ─────────────────────────────────────────────────────

export interface CodexPacketKeyEnvelope {
  groupId: string
  epoch: number
  packetId: string
  keyDerivationLabel: "codex-packet-wrap-v1"
  wrappedDek: string
  aadCommitment: string
  createdAtLogicalTime: string
}

// ── Dharma MLS Commit Receipt ──────────────────────────────────────────────

export interface DharmaMlsCommitReceipt {
  receiptId: string
  groupId: string
  priorEpoch: number
  nextEpoch: number
  mlsCommitDigest: string
  postCommitTreeHash: string
  operation: "create" | "add" | "remove" | "update" | "reinit" | "external_commit"
  affectedIdentities: string[]
  authorityDecision: {
    policyDigest: string
    acceptedBy: string[]
    decisionReceiptIds: string[]
  }
  autobasePosition: {
    headCommitment: string
    logicalTime: string
  }
  signer: string
  signature: string
}

/**
 * Create a new MLS commit receipt for a given group operation.
 *
 * Generates a deterministic receipt ID from the group/epoch context.
 */
export function createMlsCommitReceipt(
  groupId: string,
  priorEpoch: number,
  nextEpoch: number,
  operation: string,
  affectedIdentities: string[],
): DharmaMlsCommitReceipt {
  const rawId = `${groupId}:${priorEpoch}:${nextEpoch}:${operation}:${affectedIdentities.sort().join(",")}`
  const receiptId = createHash("sha256").update(rawId).digest("hex").slice(0, 16)

  return {
    receiptId,
    groupId,
    priorEpoch,
    nextEpoch,
    mlsCommitDigest: "",
    postCommitTreeHash: "",
    operation: operation as DharmaMlsCommitReceipt["operation"],
    affectedIdentities: [...affectedIdentities],
    authorityDecision: {
      policyDigest: "",
      acceptedBy: [],
      decisionReceiptIds: [],
    },
    autobasePosition: {
      headCommitment: "",
      logicalTime: "",
    },
    signer: "",
    signature: "",
  }
}

/**
 * Sign an MLS commit receipt with the given Ed25519 signing key.
 *
 * The payload being signed is the canonical string serialization of the
 * receipt fields (excluding the signature field itself).
 */
export function signMlsCommitReceipt(
  receipt: DharmaMlsCommitReceipt,
  signingKey: Uint8Array,
): DharmaMlsCommitReceipt {
  const payload = canonicalReceiptPayload(receipt)
  const signature = Buffer.from(dharmaSign(signingKey, Buffer.from(payload, "utf-8"))).toString("hex")
  return { ...receipt, signature }
}

/** Build the canonical signing payload for a commit receipt. */
function canonicalReceiptPayload(receipt: DharmaMlsCommitReceipt): string {
  return [
    receipt.receiptId,
    receipt.groupId,
    receipt.priorEpoch,
    receipt.nextEpoch,
    receipt.mlsCommitDigest,
    receipt.postCommitTreeHash,
    receipt.operation,
    receipt.affectedIdentities.sort().join(","),
    receipt.authorityDecision.policyDigest,
    receipt.authorityDecision.acceptedBy.sort().join(","),
    receipt.authorityDecision.decisionReceiptIds.sort().join(","),
    receipt.autobasePosition.headCommitment,
    receipt.autobasePosition.logicalTime,
    receipt.signer,
  ].join(":")
}

// ── MLS Service Interface ──────────────────────────────────────────────────

export interface CodexMlsService {
  createGroup(descriptor: CodexMlsGroupDescriptor): Promise<{ groupId: string; epoch: number }>
  publishKeyPackage(identityId: string, keyPackage: Uint8Array): Promise<{ receipt: string }>
  proposeAdd(
    groupId: string,
    identityId: string,
    keyPackage: Uint8Array,
  ): Promise<{ proposalRef: string }>
  proposeRemove(groupId: string, identityId: string): Promise<{ proposalRef: string }>
  commit(
    groupId: string,
    proposals: string[],
  ): Promise<{ newEpoch: number; commitReceipt: DharmaMlsCommitReceipt }>
  encryptPacketDek(
    groupId: string,
    epoch: number,
    packetId: string,
    dek: Uint8Array,
  ): Promise<CodexPacketKeyEnvelope>
  unwrapPacketDek(
    envelope: CodexPacketKeyEnvelope,
    epochExporterSecret: Uint8Array,
  ): Promise<Uint8Array>
  deriveExportSecret(
    epochSecret: Uint8Array,
    groupId: string,
    epoch: number,
    packetId: string,
    domainId: string,
  ): Uint8Array
}

// ── Epoch Key Derivation ──────────────────────────────────────────────────

/**
 * Derive a deterministic AES-256 packet wrapping key from an MLS epoch
 * exporter secret using HKDF-expand (HMAC-SHA256).
 *
 * The derivation is bound to the group, epoch, packet, domain, and schema
 * version so that different contexts produce independent keys.
 *
 * @param epochExporterSecret  MLS epoch exporter secret (32 bytes)
 * @param groupId              Hex-encoded group ID
 * @param epoch                MLS epoch number
 * @param packetId             Packet identifier
 * @param domainId             Domain identifier
 * @param schemaVersion        Key derivation schema version
 * @returns                    32-byte AES-256 key
 */
export function derivePacketWrappingKey(
  epochExporterSecret: Uint8Array,
  groupId: string,
  epoch: number,
  packetId: string,
  domainId: string,
  schemaVersion: number,
): Buffer {
  // HKDF info string binds derivation to this specific context
  const label = EPOCH_KEY_DERIVATION_LABEL
  const info = Buffer.from(
    `${label}:v${schemaVersion}:${groupId}:${epoch}:${packetId}:${domainId}`,
    "utf-8",
  )

  // HKDF-expand: PRK is the epoch exporter secret itself
  // salt = 32 zero bytes (no extraction step — the exporter secret
  // is already uniformly random from the MLS ratchet)
  const salt = Buffer.alloc(DEK_LENGTH, 0)

  // Step 1: Extract — HMAC(salt, IKM) -> PRK
  const prk = createHmac("sha256", salt).update(Buffer.from(epochExporterSecret)).digest()

  // Step 2: Expand — HMAC(PRK, info || 0x01) -> 32-byte key
  const expandInput = Buffer.concat([info, Buffer.from([0x01])])
  const wrappingKey = createHmac("sha256", prk).update(expandInput).digest()

  return wrappingKey
}

/**
 * Wrap a DEK under an epoch-derived wrapping key using AES-256-GCM.
 *
 * Generates a fresh random 96-bit IV per wrapping. The GCM auth tag
 * is 128 bits.
 *
 * @param dek          32-byte Data Encryption Key to wrap
 * @param wrappingKey  32-byte AES-256 wrapping key
 * @returns            Object with wrapped DEK, IV, and GCM auth tag
 */
export function wrapDekWithEpochKey(
  dek: Buffer,
  wrappingKey: Buffer,
): { wrappedDek: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv)
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()])
  const authTag = cipher.getAuthTag()
  return { wrappedDek: encrypted, iv, authTag }
}

/**
 * Unwrap a DEK previously wrapped with wrapDekWithEpochKey.
 *
 * @throws If the GCM authentication tag does not match (wrong key or tampered data)
 *
 * @param wrappedDek  Encrypted DEK (32 bytes ciphertext)
 * @param wrappingKey 32-byte AES-256 wrapping key
 * @param iv          96-bit nonce used during wrapping
 * @param authTag     128-bit GCM authentication tag
 * @returns           The unwrapped 32-byte DEK
 */
export function unwrapDekWithEpochKey(
  wrappedDek: Buffer,
  wrappingKey: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", wrappingKey, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(wrappedDek), decipher.final()])
}
