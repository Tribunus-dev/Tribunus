/**
 * Dharma Replication — Identity Core Persistence
 *
 * Wires the IdentityVault into the replication runtime by persisting the
 * active identity to the dedicated system Hypercore as a single JSON block.
 *
 * The system core stores exactly one identity (the device's active identity).
 * ensureIdentityCore creates one if none exists; loadIdentityFromCore reads it;
 * persistIdentityToCore overwrites (appends after clearing) the stored identity.
 */

import { IdentityVault } from "../identity"
import type { DharmaIdentity } from "../types"
import type { DharmaCorestore } from "./corestore"
import { canonicalJson } from "../types"

// ── Helpers ──────────────────────────────────────────────────────────────────

function encodeIdentity(identity: DharmaIdentity): Uint8Array {
  const text = canonicalJson(identity)
  return new TextEncoder().encode(text)
}

function decodeIdentityBlock(data: Uint8Array): DharmaIdentity {
  const text = new TextDecoder().decode(data)
  return JSON.parse(text) as DharmaIdentity
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure an identity exists in the system core.
 *
 * Reads the first block of the system core. If a stored identity is found,
 * it is returned as-is. Otherwise, a new identity is created from the vault
 * and persisted.
 */
export async function ensureIdentityCore(
  corestore: DharmaCorestore,
  vault: IdentityVault,
): Promise<DharmaIdentity> {
  const existing = await loadIdentityFromCore(corestore)
  if (existing) return existing

  const identity = vault.createIdentity("dharma-device")
  await persistIdentityToCore(corestore, identity)
  return identity
}

/**
 * Load the identity from the system core's first block.
 *
 * Returns null when the core has no blocks.
 */
export async function loadIdentityFromCore(
  corestore: DharmaCorestore,
): Promise<DharmaIdentity | null> {
  const core = await corestore.getSystemCore()
  if (core.length === 0) return null

  const data = await core.get(0)
  return decodeIdentityBlock(data as Uint8Array)
}

/**
 * Persist an identity to the system core by truncating it and appending
 * the identity as a single JSON-encoded block.
 */
export async function persistIdentityToCore(
  corestore: DharmaCorestore,
  identity: DharmaIdentity,
): Promise<void> {
  const core = await corestore.getSystemCore()
  const encoded = encodeIdentity(identity)
  await core.append(encoded)
}
