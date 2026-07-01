/**
 * Prism Local-Host KV Transport — Linux Unix Domain Socket Transport Stub
 *
 * Platform detection and capability creation for the Linux UDS + shared-memory
 * transport backend.
 */

import type { PrismLocalHostKvTransportCapability } from "./local-transport-types"

// ── Platform Detection ──────────────────────────────────────────────────────

/**
 * Check whether the current platform supports the Linux UDS transport backend.
 * Only Linux is supported.
 */
export function isLinuxTransportAvailable(): boolean {
  return typeof process !== "undefined" && process.platform === "linux"
}

// ── Capability Creation ─────────────────────────────────────────────────────

const LINUX_PROTOCOL_VERSION = 1
const LINUX_MAX_SEGMENT_BYTES = 256 * 1024 * 1024 // 256 MiB
const LINUX_MAX_CONCURRENT_SEGMENTS = 4
const LINUX_SUPPORTED_REPRESENTATIONS: string[] = ["flat_buffer", "tensor_page_array"]
const LINUX_PLATFORM_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000001"

/**
 * Create a capability descriptor for the Linux UDS transport backend.
 * The descriptor is created regardless of whether the current platform is
 * Linux — the caller should check availability before use.
 */
export function createLinuxTransportCapability(): PrismLocalHostKvTransportCapability {
  return {
    backendKind: "linux_unix_socket_shared_memory",
    supported: true,
    protocolVersion: LINUX_PROTOCOL_VERSION,
    maximumSegmentBytes: LINUX_MAX_SEGMENT_BYTES,
    maximumConcurrentSegments: LINUX_MAX_CONCURRENT_SEGMENTS,
    supportedTransferRepresentations: [...LINUX_SUPPORTED_REPRESENTATIONS],
    supportsReadOnlyDestinationMapping: true,
    supportsFdPassing: true,
    supportsIntegrityTrailer: true,
    supportsCancellation: true,
    supportsOrphanRecovery: true,
    platformCapabilityDigest: LINUX_PLATFORM_DIGEST,
  }
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Get the current Linux transport availability status.
 */
export function getLinuxTransportStatus(): { available: boolean; reason: string | null } {
  if (isLinuxTransportAvailable()) {
    return { available: true, reason: null }
  }
  return {
    available: false,
    reason: `unsupported platform: ${typeof process !== "undefined" ? process.platform : "unknown"}`,
  }
}
