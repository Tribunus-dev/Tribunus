/**
 * Dharma Federation Runtime — Identity Vault
 *
 * In-memory identity management with encrypted key storage.
 */

import type { DharmaIdentity, IdentityStatus } from "./types"
import {
  generateKeyPair,
  sign,
  verify,
  sha256,
  encryptPrivateKey,
  decryptPrivateKey,
  serializeEncryptedBundle,
  deserializeEncryptedBundle,
} from "./crypto"

// ── Identity Vault -----------------------------------------------------------

const DEFAULT_PASSPHRASE = "dharma-default"

function createIdentityId(publicKey: Uint8Array): string {
  return sha256(publicKey)
}

export class IdentityVault {
  private identities: Map<string, DharmaIdentity> = new Map()
  private passphrase: string

  constructor(passphrase?: string) {
    this.passphrase = passphrase ?? DEFAULT_PASSPHRASE
  }

  /** Create a new Dharma identity with generated Ed25519 keypair */
  createIdentity(displayName: string): DharmaIdentity {
    const name = displayName.length === 0 ? "Unnamed" : displayName
    const keyPair = generateKeyPair()
    const identityId = createIdentityId(keyPair.publicKey)
    const bundle = encryptPrivateKey(keyPair.privateKey, this.passphrase)
    const encryptedPrivateKey = serializeEncryptedBundle(bundle)

    const identity: DharmaIdentity = {
      identityId,
      publicKey: keyPair.publicKey,
      encryptedPrivateKey,
      displayName: name,
      profileVersion: 1,
      createdAt: new Date().toISOString(),
      status: "active",
      recoveryPolicy: null,
    }

    this.identities.set(identityId, identity)
    return identity
  }

  /** Get identity by ID */
  getIdentity(identityId: string): DharmaIdentity | undefined {
    return this.identities.get(identityId)
  }

  /** List all identities */
  listIdentities(): DharmaIdentity[] {
    return Array.from(this.identities.values())
  }

  /** Sign data with identity's private key (decrypts key first) */
  signWithIdentity(identityId: string, data: Uint8Array): Uint8Array {
    const identity = this.identities.get(identityId)
    if (!identity) {
      throw new Error(`Identity not found: ${identityId}`)
    }
    const bundle = deserializeEncryptedBundle(identity.encryptedPrivateKey)
    const privateKey = decryptPrivateKey(bundle, this.passphrase)
    return sign(privateKey, data)
  }

  /** Verify that data was signed by identity */
  verifyIdentity(identityId: string, data: Uint8Array, signature: Uint8Array): boolean {
    const identity = this.identities.get(identityId)
    if (!identity) {
      return false
    }
    return verify(identity.publicKey, data, signature)
  }

  /** Rotate identity: create new keypair, mark old as rotated, return new identity */
  rotateIdentity(identityId: string, newDisplayName?: string): DharmaIdentity {
    const identity = this.identities.get(identityId)
    if (!identity) {
      throw new Error(`Identity not found: ${identityId}`)
    }
    if (identity.status === "rotated") {
      throw new Error(`Identity already rotated: ${identityId}`)
    }

    identity.status = "rotated"

    return this.createIdentity(newDisplayName ?? identity.displayName)
  }

  /** Set identity status */
  setStatus(identityId: string, status: IdentityStatus): void {
    const identity = this.identities.get(identityId)
    if (!identity) {
      throw new Error(`Identity not found: ${identityId}`)
    }
    identity.status = status
  }
}
