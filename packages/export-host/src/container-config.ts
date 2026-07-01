/**
 * Container Runtime Configuration
 *
 * Describes the runtime constraints for a hardened export host container.
 * These settings are enforced by the container runtime (Docker/Podman) at
 * launch and cannot be changed by the process itself.
 *
 * Phase 3 — Hardened Export Environment
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContainerConfig {
  /** Maximum memory in megabytes (0 = unlimited) */
  memoryLimitMb: number
  /** CPU quota (fractional, e.g. 0.5 = half a core, 2 = two cores) */
  cpuLimit: number
  /** Hard timeout in milliseconds before the process is killed */
  timeLimitMs: number
  /** Mount root filesystem read-only */
  readOnlyRoot: boolean
  /** Network access policy */
  networkAccess: "none" | "unix_socket_only"
  /** Linux capabilities (empty = no capabilities granted) */
  capabilities: string[]
  /** Path to a seccomp profile JSON file, or "default" for Docker default */
  seccompProfile: string
  /** AppArmor profile name, or "unconfined" to disable */
  appArmorProfile: string
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ContainerConfig = {
  memoryLimitMb: 256,
  cpuLimit: 1,
  timeLimitMs: 60_000,
  readOnlyRoot: true,
  networkAccess: "unix_socket_only",
  capabilities: [],
  seccompProfile: "default",
  appArmorProfile: "unconfined",
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a hardened container configuration with security-first defaults.
 *
 * Defaults:
 *   - 256 MB memory limit
 *   - 1 CPU core
 *   - 60 second timeout
 *   - Read-only root filesystem
 *   - Unix-socket-only network access
 *   - No Linux capabilities
 *   - Docker default seccomp profile
 *   - AppArmor unconfined (seccomp covers the kernel-surface reduction)
 */
export function createHardenedConfig(): ContainerConfig {
  return { ...DEFAULT_CONFIG }
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Verify that a ContainerConfig is well-formed and within safe bounds.
 *
 * Returns true if the config is valid, false otherwise (logs reason to stderr).
 */
export function verifyContainerConfig(config: ContainerConfig): boolean {
  if (!config || typeof config !== "object") {
    console.error("container-config: config must be a non-null object")
    return false
  }

  if (!Number.isFinite(config.memoryLimitMb) || config.memoryLimitMb < 0) {
    console.error("container-config: memoryLimitMb must be a non-negative number")
    return false
  }

  if (!Number.isFinite(config.cpuLimit) || config.cpuLimit <= 0) {
    console.error("container-config: cpuLimit must be a positive number")
    return false
  }

  if (!Number.isFinite(config.timeLimitMs) || config.timeLimitMs <= 0) {
    console.error("container-config: timeLimitMs must be a positive number")
    return false
  }

  if (typeof config.readOnlyRoot !== "boolean") {
    console.error("container-config: readOnlyRoot must be a boolean")
    return false
  }

  if (config.networkAccess !== "none" && config.networkAccess !== "unix_socket_only") {
    console.error(`container-config: networkAccess must be "none" or "unix_socket_only", got "${config.networkAccess}"`)
    return false
  }

  if (!Array.isArray(config.capabilities)) {
    console.error("container-config: capabilities must be an array of strings")
    return false
  }

  if (typeof config.seccompProfile !== "string" || config.seccompProfile.length === 0) {
    console.error("container-config: seccompProfile must be a non-empty string")
    return false
  }

  if (typeof config.appArmorProfile !== "string" || config.appArmorProfile.length === 0) {
    console.error("container-config: appArmorProfile must be a non-empty string")
    return false
  }

  return true
}

// ── Runtime Flag Generation ──────────────────────────────────────────────────

/**
 * Convert a ContainerConfig into the corresponding container runtime CLI args.
 *
 * These flags are meant for Docker. Podman users may need to adjust
 * seccomp and AppArmor paths.
 */
export function getContainerRuntimeArgs(config: ContainerConfig): string[] {
  const args: string[] = []

  // Memory
  args.push("--memory", `${config.memoryLimitMb}m`)
  args.push("--memory-reservation", `${Math.round(config.memoryLimitMb * 0.75)}m`)

  // CPU
  args.push("--cpus", String(config.cpuLimit))

  // Read-only root
  if (config.readOnlyRoot) {
    args.push("--read-only")
  }

  // Network
  if (config.networkAccess === "none") {
    args.push("--network", "none")
  } else {
    // unix_socket_only — no IP networking, but allow Unix domain sockets
    args.push("--network", "none")
  }

  // Capabilities
  if (config.capabilities.length === 0) {
    args.push("--cap-drop", "ALL")
  } else {
    args.push("--cap-drop", "ALL")
    for (const cap of config.capabilities) {
      args.push("--cap-add", cap)
    }
  }

  // Seccomp
  if (config.seccompProfile !== "default") {
    args.push("--security-opt", `seccomp=${config.seccompProfile}`)
  }

  // AppArmor
  if (config.appArmorProfile !== "unconfined") {
    args.push("--security-opt", `apparmor=${config.appArmorProfile}`)
  }

  // No new privileges
  args.push("--security-opt", "no-new-privileges")

  return args
}
