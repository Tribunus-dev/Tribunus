/**
 * Prism Local-Host KV Transport — Deployment Configuration
 *
 * Typed configuration for local-host KV transport deployment on Linux.
 */

import type { LocalTransportBackendKind } from "./local-transport-types"

/**
 * Deployment-level configuration that controls local-host transport
 * behaviour at process start.
 */
export interface LocalTransportDeploymentConfig {
  /** Whether local-host transport is enabled at all. */
  enabled: boolean

  /** The active transport backend kind. */
  backend: LocalTransportBackendKind

  /** Directory in which Unix-domain sockets are created. */
  socketDirectory: string

  /** Maximum payload bytes per shared-memory segment. */
  maxSegmentBytes: number

  /** Maximum concurrently live segments. */
  maxConcurrentSegments: number

  /** Time-to-live for an unclaimed segment (milliseconds). */
  segmentTtlMs: number

  /** Time-to-live for a pending handshake (milliseconds). */
  handshakeTtlMs: number

  /** Require source and destination to share the same host. */
  requireSameHost: boolean

  /** Require strict compatibility checks (protocol version, digest, …). */
  requireStrictCompatibility: boolean
}

/**
 * Create a sensible default `LocalTransportDeploymentConfig` for a Linux
 * deployment backed by Unix-domain sockets + shared memory.
 */
export function createDefaultLinuxDeploymentConfig(socketDir: string): LocalTransportDeploymentConfig {
  return {
    enabled: true,
    backend: "linux_unix_socket_shared_memory",
    socketDirectory: socketDir,
    maxSegmentBytes: 256 * 1024 * 1024, // 256 MiB
    maxConcurrentSegments: 16,
    segmentTtlMs: 120_000,   // 2 minutes
    handshakeTtlMs: 10_000,  // 10 seconds
    requireSameHost: true,
    requireStrictCompatibility: true,
  }
}
