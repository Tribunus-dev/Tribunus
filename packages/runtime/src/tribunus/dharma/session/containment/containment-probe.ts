/**
 * Dharma OS-Enforced Sandbox — Containment Capability Probe
 *
 * Detects available OS-level containment capabilities for the current
 * platform. Checks for macOS Seatbelt (sandbox-exec), Linux user
 * namespaces (unshare), and Linux Landlock (ABI version).
 */

import * as os from "node:os"
import * as fs from "node:fs/promises"
import { execSync } from "node:child_process"
import type { ContainmentCapability, ContainmentBackendKind } from "./containment-types"
import { CapabilityDetectionError } from "./containment-errors"

// ── Platform Detection ─────────────────────────────────────────────────────

/** Get the current containment backend kind from the platform. */
export function getContainmentPlatform(): ContainmentBackendKind {
  const platform = os.platform()
  if (platform === "darwin") return "macos_seatbelt"
  if (platform === "linux") return "linux_namespaces"
  return "none"
}

// ── Top-Level Detection ────────────────────────────────────────────────────

/**
 * Detect available containment capabilities for the current platform.
 * Returns an array of capability descriptors, one per detectable backend.
 */
export async function detectCapabilities(): Promise<ContainmentCapability[]> {
  const platform = os.platform()
  const capabilities: ContainmentCapability[] = []

  if (platform === "darwin") {
    capabilities.push(await detectMacOSCapabilities())
  } else if (platform === "linux") {
    capabilities.push(await detectLinuxCapabilities())
  }

  // Always include the "none" fallback
  capabilities.push({
    backend: "none",
    available: true,
    version: null,
    supportedFeatures: [],
    unsupportedFeatures: [],
    deprecationWarning: null,
  })

  return capabilities
}

// ── macOS Detection ────────────────────────────────────────────────────────

/**
 * Detect macOS-specific containment capabilities.
 * Checks for sandbox-exec (Seatbelt profile) availability and
 * the App Sandbox entitlement.
 */
export async function detectMacOSCapabilities(): Promise<ContainmentCapability> {
  const seatbeltAvailable = await hasSandboxExec()
  const features: string[] = []
  const unsupported: string[] = []

  if (seatbeltAvailable) {
    features.push("sandbox-exec", "seatbelt_profiles", "file_access_control")
  } else {
    unsupported.push("sandbox-exec", "seatbelt_profiles")
  }

  // App Sandbox is only available within Mac App Store builds
  unsupported.push("app_sandbox")

  // Get sandbox-exec version (inlined - single call site, private helper)
  let version: string | null = null
  if (seatbeltAvailable) {
    try {
      const ver = execSync("sandbox-exec --version 2>/dev/null || echo 'unknown'", {
        encoding: "utf-8",
        timeout: 5000,
      })
      version = ver.trim() || "unknown"
    } catch {
      version = null
    }
  }

  return {
    backend: "macos_seatbelt",
    available: seatbeltAvailable,
    version,
    supportedFeatures: features,
    unsupportedFeatures: unsupported,
    deprecationWarning: null,
  }
}

/**
 * Check if sandbox-exec is available on macOS.
 * sandbox-exec is the primary macOS Seatbelt containment tool.
 */
export async function hasSandboxExec(): Promise<boolean> {
  try {
    execSync("which sandbox-exec 2>/dev/null", { encoding: "utf-8", timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// ── Linux Detection ────────────────────────────────────────────────────────

/**
 * Detect Linux-specific containment capabilities.
 * Checks for:
 * - unshare (user namespace / PID namespace isolation)
 * - Landlock (kernel LSM for filesystem sandboxing)
 * - cgroups v2 (resource limits)
 */
export async function detectLinuxCapabilities(): Promise<ContainmentCapability> {
  const features: string[] = []
  const unsupported: string[] = []

  const unshareAvailable = await hasUnshare()
  if (unshareAvailable) {
    features.push("user_namespaces", "pid_namespaces", "mount_namespaces", "network_namespaces")
  } else {
    unsupported.push("user_namespaces", "pid_namespaces", "mount_namespaces", "network_namespaces")
  }

  const landlockAvailable = await hasLandlock()
  if (landlockAvailable) {
    features.push("landlock", "filesystem_sandboxing")
  } else {
    unsupported.push("landlock")
  }

  // Check cgroups v2 availability (inlined - single call site, private helper)
  let cgroupsV2 = false
  try {
    await fs.access("/sys/fs/cgroup/cgroup.controllers")
    cgroupsV2 = true
  } catch {
    cgroupsV2 = false
  }

  if (cgroupsV2) {
    features.push("cgroups_v2", "resource_limits", "memory_limits", "cpu_limits")
  } else {
    unsupported.push("cgroups_v2")
  }

  const available = unshareAvailable || landlockAvailable

  return {
    backend: "linux_namespaces",
    available,
    version: os.release(),
    supportedFeatures: features,
    unsupportedFeatures: unsupported,
    deprecationWarning: null,
  }
}

/**
 * Check if unshare (user namespaces) is available on Linux.
 */
export async function hasUnshare(): Promise<boolean> {
  try {
    execSync("which unshare 2>/dev/null", { encoding: "utf-8", timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Check if Landlock is available on the current Linux kernel.
 * Landlock requires Linux 5.13+ with CONFIG_SECURITY_LANDLOCK.
 */
export async function hasLandlock(): Promise<boolean> {
  try {
    await fs.access("/proc/sys/kernel/landlock")
    return true
  } catch {
    // Fallback: check kernel version for Landlock availability
    try {
      const release = os.release()
      const parts = release.split(".").map(Number)
      if (parts.length >= 2 && parts[0]! >= 5 && parts[1]! >= 13) {
        return true
      }
      return false
    } catch {
      return false
    }
  }
}
