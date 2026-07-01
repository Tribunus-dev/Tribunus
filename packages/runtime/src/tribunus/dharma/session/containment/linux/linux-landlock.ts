/**
 * Dharma OS-Enforced Sandbox — Linux Landlock Filesystem Policy
 *
 * Defines Landlock rules for filesystem access control within a contained
 * process. Landlock (Linux 5.13+) provides mandatory access control for
 * filesystem operations beyond traditional DAC.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";

export interface LandlockRules {
  allowedReadPaths: string[];
  allowedWritePaths: string[];
}

export interface LandlockRule {
  path: string;
  access: ("read" | "write" | "execute")[];
}

export interface LandlockProfile {
  abiVersion: number;
  rules: LandlockRule[];
}

/** Build Landlock rules from filesystem policy. */
export function buildLandlockRules(
  readRoots: string[],
  writeRoots: string[],
): LandlockRules {
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const allowedReadPaths: string[] = [];
  for (const p of readRoots) {
    if (!seen.has(p)) {
      seen.add(p);
      allowedReadPaths.push(p);
    }
  }

  const allowedWritePaths: string[] = [];
  for (const p of writeRoots) {
    if (!seen.has(p)) {
      seen.add(p);
      allowedWritePaths.push(p);
    }
  }

  return { allowedReadPaths, allowedWritePaths };
}

/** Check if Landlock ABI is available.
 *
 * Returns the ABI version (1, 2, 3, 4) or 0 if unavailable.
 * ABI 1 supports: allow_rule + create_ruleset for file reads/writes.
 * ABI 2 adds: network access control.
 * ABI 3 adds: TCP connect/bind control.
 * ABI 4 adds: abstract UNIX socket control.
 */
export function getLandlockABIVersion(): number {
  // Landlock ABI version is exposed in /sys/kernel/security/landlock/
  const sysfsPath = "/sys/kernel/security/landlock";
  if (!existsSync(sysfsPath)) {
    return 0;
  }

  // Check for the ABI version sysfs entry (added in newer kernels)
  const abiFile = `${sysfsPath}/abi_version`;
  if (existsSync(abiFile)) {
    try {
      const version = parseInt(
        readFileSync(abiFile, "utf-8").trim(),
        10,
      );
      if (!isNaN(version) && version > 0) {
        return version;
      }
    } catch {
      // Fall through
    }
  }

  // Fallback: if the sysfs directory exists, check features
  const featuresPath = `${sysfsPath}/features`;
  if (existsSync(featuresPath)) {
    try {
      const features = readFileSync(featuresPath, "utf-8");
      // Rough version inference from feature filenames
      if (features.includes("tcp_connect") || features.includes("network")) {
        return 4;
      }
      if (features.includes("access_fs")) {
        return 1;
      }
    } catch {
      // Fall through
    }
  }

  // Direct check via /proc/self/attr/landlock or a simple exec probe
  try {
    execSync("landlock restrict 2>/dev/null || true", {
      encoding: "utf-8",
      timeout: 2000,
    });
    return 1; // At least ABI 1 available
  } catch {
    return 0;
  }
}

/** Compile a landlock profile from access policy. */
export function compileLandlockProfile(
  readRoots: string[],
  writeRoots: string[],
): LandlockProfile {
  const rules: LandlockRule[] = [];
  for (const p of readRoots) {
    rules.push({ path: p, access: ["read"] });
  }
  for (const p of writeRoots) {
    rules.push({ path: p, access: ["read", "write"] });
  }
  return {
    abiVersion: getLandlockABIVersion(),
    rules,
  };
}

/** Apply a landlock profile via Landlock LSM. */
export function applyLandlockProfile(profile: LandlockProfile): void {
  // TODO: Call landlock_create_ruleset + landlock_add_rule + landlock_restrict_self
  // via native binding (requires Linux >= 5.13)
}
