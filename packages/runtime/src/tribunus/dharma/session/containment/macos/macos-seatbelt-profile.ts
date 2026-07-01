/**
 * Dharma OS-Enforced Sandbox — macOS Seatbelt Profile
 *
 * Generates per-execution sandbox profiles (.sb files) from policy objects.
 * MacOS Seatbelt uses the Sandbox Profile Language (SBPL) — S-expression-based
 * rules that control file, network, and environment access.
 */

import { createHash } from "node:crypto"
import type {
  FilesystemPolicy,
  NetworkPolicy,
  EnvironmentPolicy,
} from "../containment-types"

// ── Public Interface ---------------------------------------------------------

export interface SeatbeltProfile {
  profileContent: string
  profileDigest: string
}

// ── Profile Generator --------------------------------------------------------

/**
 * Generate a complete Seatbelt profile from policy objects.
 */
export function generateSeatbeltProfile(
  fsPolicy: FilesystemPolicy,
  netPolicy: NetworkPolicy,
  envPolicy: EnvironmentPolicy,
): SeatbeltProfile {
  const systemPaths = getSystemRequiredPaths()
  const parts: string[] = ['(version 1)']

  // Default: deny everything
  parts.push('(deny default)')

  // System-required read access
  const allReadRoots = [...new Set([...systemPaths, ...fsPolicy.readableRoots])]
  parts.push(generateFileReadRules(allReadRoots))

  // Writable roots
  parts.push(generateFileWriteRules(fsPolicy.writableRoots))

  // Denied roots — emit explicit deny rules for critical denied paths.
  if (fsPolicy.deniedRoots.length > 0) {
    parts.push(generateDenyRules(fsPolicy.deniedRoots))
  }

  // Working directory
  if (fsPolicy.allowWorkingDirectory) {
    parts.push(
      `(allow file-read* file-write* (path "${fsPolicy.allowWorkingDirectory.replace(/"/g, '\\"')}"))`,
    )
  }

  // Executable
  if (fsPolicy.allowExecutable) {
    parts.push(
      `(allow file-read* file-write* (path "${fsPolicy.allowExecutable.replace(/"/g, '\\"')}"))`,
    )
  }

  // Symlink escape
  if (fsPolicy.allowSymlinkEscape) {
    parts.push(
      '(allow file-read* file-write* file-read-metadata file-write-metadata (require-not (home-relative "/")))',
    )
  }

  // Network rules
  parts.push(generateNetworkRules(netPolicy.mode, netPolicy.allowedDomains, netPolicy.allowedPorts))

  // Environment rules
  parts.push(generateEnvironmentRules(envPolicy))

  // Signal self (required for normal process lifecycle)
  parts.push('(allow process-fork)')
  parts.push('(allow signal (target self))')

  const profileContent = parts.join('\n') + '\n'
  const profileDigest = computeProfileDigest(profileContent)

  return { profileContent, profileDigest }
}

// ── File Read Rules ----------------------------------------------------------

/**
 * Generate (allow file-read*) statements from readable roots.
 */
export function generateFileReadRules(roots: string[]): string {
  if (roots.length === 0) return ''
  return roots
    .map(r => {
      const escaped = r.replace(/"/g, '\\"')
      return `(allow file-read* file-read-metadata (path "${escaped}")(subpath "${escaped}"))`
    })
    .join('\n')
}

// ── File Write Rules ---------------------------------------------------------

/**
 * Generate (allow file-write*) statements from writable roots.
 */
export function generateFileWriteRules(roots: string[]): string {
  if (roots.length === 0) return ''
  return roots
    .map(r => {
      const escaped = r.replace(/"/g, '\\"')
      return `(allow file-write* file-read* file-read-metadata (path "${escaped}")(subpath "${escaped}"))`
    })
    .join('\n')
}

// ── Network Rules ------------------------------------------------------------

/**
 * Generate network deny/allow rules.
 */
export function generateNetworkRules(
  mode: string,
  allowedDomains?: string[],
  allowedPorts?: number[],
): string {
  const rules: string[] = []

  switch (mode) {
    case "none":
      rules.push('(deny network* (require-all (not (local ip "127.0.0.1"))))')
      rules.push('(deny network* (require-all (not (local ip "::1"))))')
      rules.push('(allow network* (local ip "127.0.0.1"))')
      rules.push('(allow network* (local ip "::1"))')
      break

    case "loopback_only":
      rules.push('(deny network* (require-all (not (local ip "127.0.0.1"))))')
      rules.push('(deny network* (require-all (not (local ip "::1"))))')
      rules.push('(allow network* (local ip "127.0.0.1"))')
      rules.push('(allow network* (local ip "::1"))')
      break

    default:
      // "allowlisted" or unknown — deny all by default
      rules.push('(deny network*)')
      if (allowedDomains && allowedDomains.length > 0) {
        for (const domain of allowedDomains) {
          rules.push(
            `(allow network* (remote tcp (domain "${domain.replace(/"/g, '\\"')}")))`,
          )
        }
      }
      if (allowedPorts && allowedPorts.length > 0) {
        for (const port of allowedPorts) {
          rules.push(`(allow network* (remote tcp (local port ${port})))`)
          rules.push(`(allow network* (remote udp (local port ${port})))`)
        }
      }
      break
  }

  return rules.join('\n')
}

// ── Deny Rules ---------------------------------------------------------------

/**
 * Generate (deny*) statements for denied roots.
 */
export function generateDenyRules(deniedRoots: string[]): string {
  if (deniedRoots.length === 0) return ''
  return deniedRoots
    .map(r => {
      const escaped = r.replace(/"/g, '\\"')
      return `(deny file-read* file-write* file-read-metadata (path "${escaped}")(subpath "${escaped}"))`
    })
    .join('\n')
}

// ── Environment Rules --------------------------------------------------------

/**
 * Generate environment rules from policy.
 *
 * macOS Seatbelt doesn't have direct environment variable filtering in SBPL,
 * but we express the intent via comments and rely on the backend to strip/
 * inject vars at launch time. The profile documents the policy for audit.
 */
export function generateEnvironmentRules(policy: EnvironmentPolicy): string {
  const rules: string[] = []

  // Document sanitized HOME
  rules.push(`; SANDBOX_HOME=${policy.sandboxHome}`)
  rules.push(`; SANDBOX_TEMP=${policy.sandboxTemp}`)

  // Denied variables documented for audit
  if (policy.deniedVariables.length > 0) {
    for (const v of policy.deniedVariables) {
      rules.push(`; DENY_ENV=${v}`)
    }
  }

  // Allowed variables documented
  if (policy.allowedVariables.length > 0) {
    for (const v of policy.allowedVariables) {
      rules.push(`; ALLOW_ENV=${v}`)
    }
  }

  return rules.join('\n')
}

// ── Digest Computation ------------------------------------------------------

/**
 * Compute profile content digest (SHA-256 hex).
 */
export function computeProfileDigest(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex")
}

// ── System Paths -------------------------------------------------------------

/**
 * Get default system paths required for runtime operation.
 */
export function getSystemRequiredPaths(): string[] {
  return [
    "/usr/lib",
    "/System/Library",
    "/usr/share",
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/private/tmp",
    "/private/var/tmp",
  ]
}
