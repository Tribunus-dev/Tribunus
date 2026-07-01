/**
 * Dharma OS-Enforced Sandbox — Linux Namespace Helpers
 *
 * Utilities for detecting and configuring Linux namespaces for process
 * containment. Provides clone flags, availability checks, and the canonical
 * set of required namespaces.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

export const LINUX_REQUIRED_NAMESPACES = [
  "mount",
  "pid",
  "net",
  "ipc",
  "uts",
  "user",
] as const;

export type NamespaceKind = (typeof LINUX_REQUIRED_NAMESPACES)[number];

export interface NamespacePlan {
  namespaces: NamespaceKind[];
  cloneFlags: number;
  unshareFlags: string[];
  userNamespace: boolean;
}

/** Check if user namespaces are enabled on the host. */
export function checkUserNamespaces(): boolean {
  // /proc/sys/kernel/unprivileged_userns_clone — default 0 on some distros
  // /proc/sys/user/max_user_namespaces — >0 indicates support
  if (existsSync("/proc/sys/user/max_user_namespaces")) {
    try {
      const val = execSync(
        "cat /proc/sys/user/max_user_namespaces",
        { encoding: "utf-8", timeout: 2000 },
      ).trim();
      return parseInt(val, 10) > 0;
    } catch {
      return false;
    }
  }
  return false;
}

/** Build clone flags for namespace creation. */
export function getNamespaceFlags(): number {
  // CLONE_NEWNS   = 0x00020000
  // CLONE_NEWCGROUP = 0x02000000
  // CLONE_NEWUTS  = 0x04000000
  // CLONE_NEWIPC  = 0x08000000
  // CLONE_NEWUSER = 0x10000000
  // CLONE_NEWPID  = 0x20000000
  // CLONE_NEWNET  = 0x40000000
  // Combined for full isolation
  return (
    0x00020000 |  // CLONE_NEWNS
    0x02000000 |  // CLONE_NEWCGROUP
    0x04000000 |  // CLONE_NEWUTS
    0x08000000 |  // CLONE_NEWIPC
    0x10000000 |  // CLONE_NEWUSER
    0x20000000 |  // CLONE_NEWPID
    0x40000000    // CLONE_NEWNET
  );
}

/** Check if unshare binary is available. */
export function hasUnshareBinary(): boolean {
  try {
    execSync("which unshare", { encoding: "utf-8", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** Create a namespace plan for a containment session. */
export function createNamespacePlan(
  userNamespace: boolean = true,
  namespaces: NamespaceKind[] = [...LINUX_REQUIRED_NAMESPACES],
): NamespacePlan {
  const flags = getNamespaceFlags();
  return {
    namespaces,
    cloneFlags: flags,
    unshareFlags: namespaces.map((ns) => `--${ns}`),
    userNamespace,
  };
}

/** Plan namespace isolation strategy based on request requirements. */
export function planNamespaces(
  requirePid: boolean = true,
  requireNet: boolean = true,
  requireIpc: boolean = true,
): NamespacePlan {
  const namespaces: NamespaceKind[] = ["mount", "uts", "user"];
  if (requirePid) namespaces.push("pid");
  if (requireNet) namespaces.push("net");
  if (requireIpc) namespaces.push("ipc");
  return createNamespacePlan(true, namespaces);
}
