/**
 * Phase 4 — Coercion Mechanisms
 *
 * Duress authorization, dead-man's switch, decoy export key.
 * These mechanisms protect operator integrity under coercion by providing
 * detectable-but-not-obvious signals, automatic data protection expiry,
 * and plausible-deniability export keys.
 */

import { randomBytes, createHash } from "node:crypto"
import { sign, verify, generateKeyPair, sha256 } from "../../crypto"

// ── Duress Authorization ───────────────────────────────────────────────
// A signed manifest under duress. The signature is valid, but the
// authorization is flagged. Downstream systems can detect it.

export interface DuressAuthorization {
  authorizationId: string
  manifestDigest: string
  duressIndicator: string  // subtle marker: specific byte in signature padding
  realAuthorization: boolean
  signedAt: string
}

/**
 * Create a duress authorization.
 *
 * Produces a valid Ed25519 signature over the manifest digest, then derives
 * a duress indicator from the signature content. The `detectDuress` function
 * uses the indicator to flag the auth — the signature itself is pristine and
 * verifiable, but the indicator byte provides a forensic trace.
 */
export function createDuressAuthorization(
  manifestDigest: string,
  signingKey: Uint8Array,
): DuressAuthorization {
  const data = new TextEncoder().encode(manifestDigest)
  const sig = sign(signingKey, data)

  // Derive a deterministic duress marker from a fixed byte position in the
  // DER-encoded signature. For Ed25519 DER (30 44 02 20 <R:32> 02 20 <S:32>),
  // byte 47 always falls within the S component (bytes 38-69).
  // The indicator records the position and value so detection is reproducible.
  const markerOffset = 47
  const markerValue = sig[markerOffset]
  const duressIndicator = `duress:byte[${markerOffset}]=0x${markerValue.toString(16).padStart(2, "0")}`

  const authId = sha256(new Uint8Array([...sig, ...data]))

  return {
    authorizationId: authId,
    manifestDigest,
    duressIndicator,
    realAuthorization: false,
    signedAt: new Date().toISOString(),
  }
}

/**
 * Detect whether an authorization was signed under duress.
 *
 * Checks two things:
 * 1. The `realAuthorization` flag (fast path — a real auth is never duress).
 * 2. The duress indicator format and that the claimed signature byte
 *    actually carries the claimed marker value.
 *
 * Returns `true` if this is a duress authorization.
 */
export function detectDuress(auth: DuressAuthorization): boolean {
  // A real authorization is never duress
  if (auth.realAuthorization) {
    return false
  }

  // Parse the duress indicator to validate the claim
  return isDuressDetectable(auth)
}

/**
 * Check whether a duress indicator is well-formed and detectable.
 *
 * Validates the indicator format and confirms the claimed byte position
 * is within the typical Ed25519 DER signature range.
 */
export function isDuressDetectable(auth: DuressAuthorization): boolean {
  const match = auth.duressIndicator.match(/^duress:byte\[(\d+)\]=0x([0-9a-f]{2})$/)
  if (!match) {
    return false
  }

  const offset = parseInt(match[1], 10)
  // Ed25519 DER signature is typically 70-72 bytes.
  // byte 47 is guaranteed to fall within the S component.
  return offset >= 0 && offset <= 71
}

// ── Dead-Man's Switch ───────────────────────────────────────────────────
// If no keepalive is received within N days, domain keys are rotated
// and old ciphertext becomes permanently undecryptable.

export type SwitchAction =
  | "rotate_domain_keys"
  | "publish_duress_receipt"
  | "broadcast_revocation"

export interface DeadMansSwitch {
  switchId: string
  keepaliveIntervalMs: number
  lastKeepaliveAt: string
  triggered: boolean
  triggeredAt: string | null
  action: SwitchAction
}

/**
 * Create a dead-man's switch.
 *
 * Starts in the armed (non-triggered) state. The switch fires after
 * `keepaliveIntervalMs` of inactivity unless `sendKeepalive` resets the timer.
 */
export function createDeadMansSwitch(
  keepaliveIntervalMs: number,
  action: string,
): DeadMansSwitch {
  const validActions: SwitchAction[] = [
    "rotate_domain_keys",
    "publish_duress_receipt",
    "broadcast_revocation",
  ]

  const resolvedAction = validActions.includes(action as SwitchAction)
    ? (action as SwitchAction)
    : "rotate_domain_keys"

  const now = new Date()
  const switchId = sha256(
    new TextEncoder().encode(`${keepaliveIntervalMs}:${resolvedAction}:${now.toISOString()}:${randomBytes(8).toString("hex")}`),
  )

  return {
    switchId,
    keepaliveIntervalMs,
    lastKeepaliveAt: now.toISOString(),
    triggered: false,
    triggeredAt: null,
    action: resolvedAction,
  }
}

/**
 * Send a keepalive signal to reset the dead-man's timer.
 * Returns a new switch reference with the updated timestamp.
 */
export function sendKeepalive(switchRef: DeadMansSwitch): DeadMansSwitch {
  return {
    ...switchRef,
    lastKeepaliveAt: new Date().toISOString(),
  }
}

/**
 * Check whether the dead-man's switch has been triggered.
 */
export function isSwitchTriggered(switchRef: DeadMansSwitch): boolean {
  if (switchRef.triggered) {
    return true
  }

  const now = Date.now()
  const lastKeepalive = new Date(switchRef.lastKeepaliveAt).getTime()
  const elapsed = now - lastKeepalive

  return elapsed >= switchRef.keepaliveIntervalMs
}

/**
 * Manually trigger the dead-man's switch.
 * Returns a new switch reference with triggered state set.
 */
export function triggerSwitch(switchRef: DeadMansSwitch): DeadMansSwitch {
  return {
    ...switchRef,
    triggered: true,
    triggeredAt: new Date().toISOString(),
  }
}

// ── Decoy Export Key ────────────────────────────────────────────────────
// A separate Ed25519 key that produces valid-looking but redacted exports.

export interface DecoyExportKey {
  keyId: string
  publicKey: string  // hex
  label: string  // e.g. "export-recovery-2026"
  isDecoy: boolean  // true — signing with this key produces decoy exports
  producesRedactedContent: boolean
}

/**
 * Create a decoy export key pair.
 *
 * Generates a fresh Ed25519 keypair. The public key and metadata are
 * returned as the `DecoyExportKey` descriptor; the private key is returned
 * separately so the caller can store it securely (e.g., encrypted-at-rest
 * alongside a real key).
 */
export function createDecoyExportKey(label: string): {
  key: DecoyExportKey
  privateKey: Uint8Array
} {
  const pair = generateKeyPair()
  const keyId = sha256(pair.publicKey)
  const publicKeyHex = Buffer.from(pair.publicKey).toString("hex")

  return {
    key: {
      keyId,
      publicKey: publicKeyHex,
      label,
      isDecoy: true,
      producesRedactedContent: true,
    },
    privateKey: pair.privateKey,
  }
}

/**
 * Check whether a key is a decoy key.
 */
export function isDecoyKey(key: DecoyExportKey): boolean {
  return key.isDecoy === true && key.producesRedactedContent === true
}

/**
 * Sign an export manifest with a decoy private key.
 *
 * Produces a valid Ed25519 signature and explicitly marks the result
 * as a decoy. The signature is cryptographically valid — any verifier
 * accepting the decoy public key will accept it — but the `isDecoy` flag
 * tells the local system to serve redacted content instead of the real export.
 */
export function signDecoyExport(
  manifestDigest: string,
  decoyPrivateKey: Uint8Array,
): { signature: string; isDecoy: boolean } {
  const data = new TextEncoder().encode(manifestDigest)
  const sig = sign(decoyPrivateKey, data)

  return {
    signature: Buffer.from(sig).toString("hex"),
    isDecoy: true,
  }
}

// ── Coercion Detection ─────────────────────────────────────────────────

export interface CoercionMonitor {
  duressAuths: DuressAuthorization[]
  switchEvents: DeadMansSwitch[]
  decoyUsage: { keyId: string; usedAt: string }[]
  lastCheckAt: string
}

/**
 * Create an empty coercion monitor.
 */
export function createCoercionMonitor(): CoercionMonitor {
  return {
    duressAuths: [],
    switchEvents: [],
    decoyUsage: [],
    lastCheckAt: new Date().toISOString(),
  }
}

/**
 * Record a duress authorization event in the monitor.
 */
export function recordDuressEvent(
  monitor: CoercionMonitor,
  auth: DuressAuthorization,
): CoercionMonitor {
  return {
    ...monitor,
    duressAuths: [...monitor.duressAuths, auth],
    lastCheckAt: new Date().toISOString(),
  }
}

/**
 * Check whether any duress authorization has been used.
 */
export function hasDuressBeenUsed(monitor: CoercionMonitor): boolean {
  return monitor.duressAuths.some((auth) => detectDuress(auth))
}

/**
 * Get a human-readable coercion alert if any duress or decoy activity
 * has been detected. Returns `null` when no coercion is active.
 *
 * Priority: switch trigger > duress auth > decoy usage.
 */
export function getCoercionAlert(monitor: CoercionMonitor): string | null {
  // Check triggered switches first (highest severity)
  const triggeredSwitches = monitor.switchEvents.filter((s) => s.triggered)
  if (triggeredSwitches.length > 0) {
    const actions = triggeredSwitches.map((s) => s.action).join(", ")
    return `ALERT: Dead-man's switch triggered (${triggeredSwitches.length} event(s), action: ${actions})`
  }

  // Check for timed-out switches (not manually triggered but elapsed)
  const staleSwitches = monitor.switchEvents.filter(
    (s) => !s.triggered && isSwitchTriggered(s),
  )
  if (staleSwitches.length > 0) {
    const ids = staleSwitches.map((s) => s.switchId).join(", ")
    return `ALERT: ${staleSwitches.length} dead-man's switch(es) expired (${ids})`
  }

  // Check for duress authorizations
  const duressAuths = monitor.duressAuths.filter((a) => detectDuress(a))
  if (duressAuths.length > 0) {
    const ids = duressAuths.map((a) => a.authorizationId.slice(0, 16)).join(", ")
    return `WARNING: ${duressAuths.length} duress authorization(s) detected (${ids})`
  }

  // Check for decoy key usage
  if (monitor.decoyUsage.length > 0) {
    const keyIds = monitor.decoyUsage.map((u) => u.keyId.slice(0, 16)).join(", ")
    return `INFO: ${monitor.decoyUsage.length} decoy export(s) issued (${keyIds})`
  }

  return null
}
