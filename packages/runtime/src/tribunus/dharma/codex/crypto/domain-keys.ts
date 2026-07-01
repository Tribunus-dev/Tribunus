/**
 * Codex — Domain Key Hierarchy
 *
 * Compartmentalized domain key management. Each visibility domain
 * ("session", "contributor", "public") has its own wrapping key.
 * Domain keys are stored securely and released only during authorized exports.
 *
 * The domain wrapping key is an AES-256 key used to wrap Data Encryption Keys
 * (DEKs) for entries in that domain.
 */

import type { CodexVisibilityClass } from "../codex-types"

// ── Types ────────────────────────────────────────────────────────────────────

export interface DomainKey {
  domainId: string
  /** AES-256 key for wrapping/unwrapping DEKs */
  wrappingKey: Buffer
  /** Unique key identifier for rotation tracking */
  keyId: string
  /** Monotonic rotation counter */
  rotation: number
}

export interface DomainKeyStore {
  getDomainKey(domainId: string): DomainKey | undefined
  listDomainIds(): string[]
}

export interface KeyReleaseResponse {
  /** Domain keys released (wrapped under export recipient key) */
  releasedKeys: { domainId: string; keyId: string; wrappedKey: string }[]
  /** Ed25519 signature over the released keys */
  signature: string
  /** Identity that signed the release */
  signedBy: string
}

// ── Domain Key Resolution ────────────────────────────────────────────────────

/**
 * Map a visibility class to its domain ID.
 */
export function visibilityToDomainId(visibilityClass: CodexVisibilityClass): string {
  return `domain-${visibilityClass}`
}

/**
 * Get the required domain IDs for decrypting entries of a given visibility class.
 *
 * "session" entries are encrypted under the session domain.
 * "contributor" entries are encrypted under the contributor domain.
 * "public" entries are encrypted under the public domain.
 */
export function getRequiredDomains(visibilityClass: CodexVisibilityClass): string[] {
  return [visibilityToDomainId(visibilityClass)]
}

/**
 * Get the active DomainKey from the store for a given domain ID.
 *
 * Throws if the domain is not found in the store.
 */
export function getActiveDomainKey(
  domainId: string,
  store: DomainKeyStore,
): DomainKey {
  const key = store.getDomainKey(domainId)
  if (!key) {
    throw new Error(`Domain key not found for domain: ${domainId}`)
  }
  return key
}

// ── In-Memory Store ──────────────────────────────────────────────────────────

/**
 * Create a simple in-memory DomainKeyStore with a key for each visibility domain.
 *
 * For testing and runtime use where domain keys are loaded from secure storage.
 */
export function createDomainKeyStore(
  domainKeys: DomainKey[],
): DomainKeyStore {
  const map = new Map(domainKeys.map((k) => [k.domainId, k]))

  return {
    getDomainKey(domainId: string): DomainKey | undefined {
      return map.get(domainId)
    },
    listDomainIds(): string[] {
      return Array.from(map.keys())
    },
  }
}
