/**
 * Prism Local-Host KV Transport — Capability
 */

import type { PrismLocalHostKvTransportCapability, LocalHostAuthorityDomain } from "./local-transport-types"

/**
 * Create a Linux (Unix socket + shared memory) transport capability.
 */
export function createLinuxCapability(
  maxBytes: number,
  maxSegments: number,
  reps: string[],
): PrismLocalHostKvTransportCapability {
  return {
    backendKind: "linux_unix_socket_shared_memory",
    supported: true,
    protocolVersion: 1,
    maximumSegmentBytes: maxBytes,
    maximumConcurrentSegments: maxSegments,
    supportedTransferRepresentations: reps,
    supportsReadOnlyDestinationMapping: true,
    supportsFdPassing: true,
    supportsIntegrityTrailer: true,
    supportsCancellation: true,
    supportsOrphanRecovery: true,
    platformCapabilityDigest: computePlatformDigest("linux", maxBytes, maxSegments, reps),
  }
}

/**
 * Create a macOS capability that is explicitly unsupported for real transport.
 */
export function createMacOSUnsupportedCapability(): PrismLocalHostKvTransportCapability {
  return {
    backendKind: "macos_future_transport",
    supported: false,
    protocolVersion: 1,
    maximumSegmentBytes: 0,
    maximumConcurrentSegments: 0,
    supportedTransferRepresentations: [],
    supportsReadOnlyDestinationMapping: false,
    supportsFdPassing: false,
    supportsIntegrityTrailer: true,
    supportsCancellation: false,
    supportsOrphanRecovery: false,
    platformCapabilityDigest: "macos-unsupported-v1",
  }
}

/**
 * Returns true when the backend kind represents a real, supported transport.
 */
export function isBackendSupported(cap: PrismLocalHostKvTransportCapability): boolean {
  return cap.backendKind === "linux_unix_socket_shared_memory" && cap.supported === true
}

/**
 * Check whether two authority domains originate from the same host.
 * Returns `{ sameHost, reason }` where `reason` is non-null when the check fails.
 */
export function checkSameHostAuthority(
  sourceDomain: LocalHostAuthorityDomain,
  destDomain: LocalHostAuthorityDomain,
): { sameHost: boolean; reason: string | null } {
  if (sourceDomain.hostInstanceId !== destDomain.hostInstanceId) {
    return {
      sameHost: false,
      reason: `Host instance mismatch: ${sourceDomain.hostInstanceId} !== ${destDomain.hostInstanceId}`,
    }
  }
  if (sourceDomain.runtimeUserScope !== destDomain.runtimeUserScope) {
    return {
      sameHost: false,
      reason: `Runtime user scope mismatch: ${sourceDomain.runtimeUserScope} !== ${destDomain.runtimeUserScope}`,
    }
  }
  if (sourceDomain.transportNamespaceDigest !== destDomain.transportNamespaceDigest) {
    return {
      sameHost: false,
      reason: `Transport namespace digest mismatch: ${sourceDomain.transportNamespaceDigest} !== ${destDomain.transportNamespaceDigest}`,
    }
  }
  return { sameHost: true, reason: null }
}

/**
 * Returns true when two capabilities can interoperate.
 * Both must target the same backend, be supported, and share the same protocol version.
 */
export function areCapabilitiesCompatible(
  source: PrismLocalHostKvTransportCapability,
  dest: PrismLocalHostKvTransportCapability,
): boolean {
  if (source.backendKind !== dest.backendKind) {
    return false
  }
  if (!source.supported || !dest.supported) {
    return false
  }
  if (source.protocolVersion !== dest.protocolVersion) {
    return false
  }
  return true
}

/**
 * Returns a string identifying the platform family of the current process.
 * Values: "linux", "darwin", "win32", or "unknown".
 */
export function getPlatformFamily(): string {
  // Deno, Node, Bun all expose `process.platform`; Bun exposes it as a
  // top-level global.
  if (typeof process !== "undefined" && typeof process.platform === "string") {
    return process.platform
  }
  if (typeof navigator !== "undefined" && typeof navigator.platform === "string") {
    const p = navigator.platform.toLowerCase()
    if (p.includes("linux")) return "linux"
    if (p.includes("mac") || p.includes("darwin")) return "darwin"
    if (p.includes("win")) return "win32"
  }
  return "unknown"
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computePlatformDigest(
  family: string,
  maxBytes: number,
  maxSegments: number,
  reps: string[],
): string {
  const parts = [family, String(maxBytes), String(maxSegments), ...[...reps].sort()] 
  // Simple stable digest: hex-encoded length-prefixed concatenation.
  // In production this would be a real hash; for the structural layer
  // a repeatable string identifier is sufficient.
  return `digest:${parts.join("|")}`
}
