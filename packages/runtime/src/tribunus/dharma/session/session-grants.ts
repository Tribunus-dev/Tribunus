/**
 * Dharma Session Authority — Grant Model
 *
 * Capability checking, resource scope enforcement, grant lifecycle checks.
 */

import type {
  Capability,
  ResourceScope,
  SessionAuthorityGrant,
  GrantProfile,
} from "./types"
import { ALL_CAPABILITIES, GRANT_PROFILES, DEFAULT_EMPTY_SCOPE } from "./types"

// ── Capability Checks ──────────────────────────────────────────────────────

/** Check if a grant has a specific capability. */
export function hasCapability(
  grant: SessionAuthorityGrant,
  capability: Capability,
): boolean {
  return grant.capabilitySet.includes(capability)
}

/** Check if all capabilities in a set are present. */
export function hasAllCapabilities(
  grant: SessionAuthorityGrant,
  capabilities: Capability[],
): boolean {
  return capabilities.every((c) => grant.capabilitySet.includes(c))
}

// ── Glob Matching ──────────────────────────────────────────────────────────

/**
 * Simple glob-to-regex converter for path matching.
 * Supports `**` (any number of directory segments), `*` (within a segment),
 * and `?` (single character within a segment).
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const regexStr = escaped
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/__GLOBSTAR__/g, ".*")
  return new RegExp(`^${regexStr}$`)
}

// ── Scope Enforcement ──────────────────────────────────────────────────────

/** Check if a path is within the allowed resource scope.
 *  Denied paths take precedence over allowed paths. */
export function isPathAllowed(scope: ResourceScope, path: string): boolean {
  // denied paths take precedence
  for (const denied of scope.deniedPaths) {
    const regex = globToRegex(denied)
    if (regex.test(path)) return false
  }
  // if no allowed paths, nothing is allowed
  if (scope.allowedPaths.length === 0) return false
  // check allowed
  for (const allowed of scope.allowedPaths) {
    const regex = globToRegex(allowed)
    if (regex.test(path)) return true
  }
  return false
}

/** Check if a command is within the allowed command scope.
 *  A command is allowed if it starts with any allowed command prefix.
 *  Denied command prefixes take precedence. */
export function isCommandAllowed(scope: ResourceScope, command: string): boolean {
  // denied take precedence
  for (const denied of scope.deniedCommands) {
    if (command.startsWith(denied)) return false
  }
  // if no allowed commands, nothing is allowed
  if (scope.allowedCommands.length === 0) return false
  // check allowed
  for (const allowed of scope.allowedCommands) {
    if (command.startsWith(allowed)) return true
  }
  return false
}

/** Check if a network domain is within the allowed network scope.
 *  Checks if the domain (or a parent domain) is in the allowed list.
 *  Denied domains take precedence. */
export function isNetworkDomainAllowed(scope: ResourceScope, domain: string): boolean {
  // denied take precedence
  for (const denied of scope.deniedNetworkDomains) {
    if (matchesDomain(domain, denied)) return false
  }
  // if no allowed domains, nothing is allowed
  if (scope.allowedNetworkDomains.length === 0) return false
  // check allowed
  for (const allowed of scope.allowedNetworkDomains) {
    if (matchesDomain(domain, allowed)) return true
  }
  return false
}

/**
 * Check if `target` is equal to `pattern` or is a subdomain of `pattern`.
 * Both are trimmed, lowercased, and leading/trailing dots stripped.
 */
function matchesDomain(target: string, pattern: string): boolean {
  const t = target.toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "")
  const p = pattern.toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "")
  return t === p || t.endsWith(`.${p}`)
}

/** Check if an environment variable is within the allowed scope.
 *  Denied variable names take precedence. */
export function isEnvironmentVariableAllowed(
  scope: ResourceScope,
  name: string,
): boolean {
  // denied take precedence
  for (const denied of scope.deniedEnvironmentVariables) {
    if (name.startsWith(denied)) return false
    // exact match with wildcard suffix
    if (denied.endsWith("*") && name.startsWith(denied.slice(0, -1))) return false
  }
  // if no allowed env vars, nothing is allowed
  if (scope.allowedEnvironmentVariables.length === 0) return false
  // check allowed
  for (const allowed of scope.allowedEnvironmentVariables) {
    if (name.startsWith(allowed)) return true
    if (allowed.endsWith("*") && name.startsWith(allowed.slice(0, -1))) return true
  }
  return false
}

/** Check if a file extension is within the allowed scope.
 *  Denied extensions take precedence. */
export function isFileExtensionAllowed(
  scope: ResourceScope,
  extension: string,
): boolean {
  const ext = extension.startsWith(".") ? extension.slice(1).toLowerCase() : extension.toLowerCase()

  for (const denied of scope.deniedFileExtensions) {
    const d = denied.startsWith(".") ? denied.slice(1).toLowerCase() : denied.toLowerCase()
    if (ext === d) return false
  }
  if (scope.allowedFileExtensions.length === 0) return false
  for (const allowed of scope.allowedFileExtensions) {
    const a = allowed.startsWith(".") ? allowed.slice(1).toLowerCase() : allowed.toLowerCase()
    if (ext === a) return true
  }
  return false
}

// ── Grant Validity ─────────────────────────────────────────────────────────

/** Check if a grant is currently valid (not expired, not revoked, correct epoch). */
export function isGrantValid(
  grant: SessionAuthorityGrant,
  currentKeyEpoch: number,
): boolean {
  // check revoked
  if (grant.revokedAt !== null) return false
  // check expired
  if (grant.expiresAt !== null) {
    const now = new Date().toISOString()
    if (grant.expiresAt < now) return false
  }
  // check epoch
  if (grant.sessionKeyEpoch !== currentKeyEpoch) return false
  return true
}

// ── Profile Resolution ─────────────────────────────────────────────────────

/** Compile a grant profile into a set of capabilities. */
export function getProfileCapabilities(profile: GrantProfile): Capability[] {
  return [...GRANT_PROFILES[profile]]
}

// ── Grant Creation ─────────────────────────────────────────────────────────

/** Create a standard grant from a profile with a scope. */
export function createGrantFromProfile(config: {
  grantId: string
  sessionId: string
  subjectIdentityPublicKey: string
  subjectMembershipId: string
  issuedByIdentityPublicKey: string
  profile: GrantProfile
  resourceScope?: Partial<ResourceScope>
  sessionKeyEpoch?: number
  expiresAt?: string
}): SessionAuthorityGrant {
  const capabilities = getProfileCapabilities(config.profile)
  const scope = config.resourceScope
    ? mergeScope(DEFAULT_EMPTY_SCOPE, config.resourceScope)
    : DEFAULT_EMPTY_SCOPE

  return {
    grantId: config.grantId,
    sessionId: config.sessionId,
    subjectIdentityPublicKey: config.subjectIdentityPublicKey,
    subjectMembershipId: config.subjectMembershipId,
    issuedByIdentityPublicKey: config.issuedByIdentityPublicKey,
    issuedByGrantId: null,
    capabilitySet: capabilities,
    resourceScope: scope,
    executionConstraints: null,
    disclosureScope: null,
    approvalPolicy: null,
    delegationPolicy: null,
    issuedAt: new Date().toISOString(),
    expiresAt: config.expiresAt ?? null,
    revokedAt: null,
    revocationReason: null,
    sessionKeyEpoch: config.sessionKeyEpoch ?? 0,
    signature: "",
  }
}

// ── Scope Utilities ────────────────────────────────────────────────────────

/** Merge a partial scope into a full ResourceScope. */
export function mergeScope(
  base: ResourceScope,
  partial: Partial<ResourceScope>,
): ResourceScope {
  return {
    allowedPaths: partial.allowedPaths ?? base.allowedPaths,
    deniedPaths: partial.deniedPaths ?? base.deniedPaths,
    allowedFileExtensions: partial.allowedFileExtensions ?? base.allowedFileExtensions,
    deniedFileExtensions: partial.deniedFileExtensions ?? base.deniedFileExtensions,
    allowedCommands: partial.allowedCommands ?? base.allowedCommands,
    deniedCommands: partial.deniedCommands ?? base.deniedCommands,
    allowedNetworkDomains: partial.allowedNetworkDomains ?? base.allowedNetworkDomains,
    deniedNetworkDomains: partial.deniedNetworkDomains ?? base.deniedNetworkDomains,
    allowedEnvironmentVariables: partial.allowedEnvironmentVariables ?? base.allowedEnvironmentVariables,
    deniedEnvironmentVariables: partial.deniedEnvironmentVariables ?? base.deniedEnvironmentVariables,
    maximumRuntimeSeconds: partial.maximumRuntimeSeconds ?? base.maximumRuntimeSeconds,
    maximumCpuSeconds: partial.maximumCpuSeconds ?? base.maximumCpuSeconds,
    maximumMemoryBytes: partial.maximumMemoryBytes ?? base.maximumMemoryBytes,
    maximumDiskWriteBytes: partial.maximumDiskWriteBytes ?? base.maximumDiskWriteBytes,
    maximumProcessCount: partial.maximumProcessCount ?? base.maximumProcessCount,
    maximumOutputBytes: partial.maximumOutputBytes ?? base.maximumOutputBytes,
    maximumComputeTokens: partial.maximumComputeTokens ?? base.maximumComputeTokens,
    maximumComputeCost: partial.maximumComputeCost ?? base.maximumComputeCost,
  }
}

// ── Budget Checks ──────────────────────────────────────────────────────────

/** Check if resource budgets would be exceeded.
 *  A limit of 0 means unlimited. */
export function isWithinBudget(
  scope: ResourceScope,
  usage: {
    runtimeMs?: number
    cpuMs?: number
    memoryBytes?: number
    diskBytes?: number
    processCount?: number
    outputBytes?: number
  },
): boolean {
  const checks: [number | undefined, number][] = [
    [usage.runtimeMs, scope.maximumRuntimeSeconds * 1000],
    [usage.cpuMs, scope.maximumCpuSeconds * 1000],
    [usage.memoryBytes, scope.maximumMemoryBytes],
    [usage.diskBytes, scope.maximumDiskWriteBytes],
    [usage.processCount, scope.maximumProcessCount],
    [usage.outputBytes, scope.maximumOutputBytes],
  ]
  for (const [used, limit] of checks) {
    if (used === undefined) continue
    // limit 0 means unlimited
    if (limit !== 0 && used > limit) return false
  }
  return true
}
