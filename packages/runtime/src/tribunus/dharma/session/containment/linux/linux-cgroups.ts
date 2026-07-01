/**
 * Dharma OS-Enforced Sandbox — Linux cgroups v2 Resource Control
 *
 * Provides configuration builders for cgroups v2 resource controllers.
 * Manages memory, CPU, PID, and I/O limits for contained process trees.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export interface CgroupConfig {
  memoryMaxBytes: number;
  cpuMax: string;
  pidsMax: number;
  ioMax: string;
}

export interface CgroupResourceConfig {
  memoryLimitBytes: number;
  cpuQuota: number;
  cpuPeriod: number;
  pidsLimit: number;
}

const CGROUP2_MOUNT = "/sys/fs/cgroup";

/** Build cgroup configuration from resource limits. */
export function buildCgroupConfig(
  maxMemoryBytes: number,
  maxPids: number,
): CgroupConfig {
  // CPU max: "quota period" — default 100000 µs period, quota = 100% by default
  // If maxMemoryBytes is set, derive CPU share proportionally
  const cpuQuota = maxMemoryBytes > 0 ? Math.max(1, 50000) : 100000;
  const cpuPeriod = 100000;

  return {
    memoryMaxBytes: maxMemoryBytes > 0 ? maxMemoryBytes : 0,
    cpuMax: `${cpuQuota} ${cpuPeriod}`,
    pidsMax: maxPids > 0 ? maxPids : 16,
    ioMax: "rbps 1048576 wbps 1048576", // 1 MB/s read + write
  };
}

/** Check if cgroups v2 is available. */
export function hasCgroupsV2(): boolean {
  if (!existsSync(CGROUP2_MOUNT)) {
    return false;
  }

  // cgroups v2 is indicated by /sys/fs/cgroup/cgroup.controllers
  if (!existsSync(`${CGROUP2_MOUNT}/cgroup.controllers`)) {
    return false;
  }

  // Also verify it's actually v2 (not a v1 hierarchy)
  try {
    const releaseAgent = execSync(
      `cat "${CGROUP2_MOUNT}/cgroup.type" 2>/dev/null; echo`,
      { encoding: "utf-8", timeout: 2000 },
    ).trim();

    // "domain" is the default cgroup v2 type; empty or "domain" both valid
    return releaseAgent === "" || releaseAgent === "domain" ||
      releaseAgent === "domain threaded";
  } catch {
    return false;
  }
}

/** Get the cgroup v2 mount path. */
export function getCgroupPath(): string {
  if (existsSync(CGROUP2_MOUNT)) {
    return CGROUP2_MOUNT;
  }

  // Fallback: parse /proc/mounts for cgroup2
  try {
    const mounts = readFileSync("/proc/mounts", "utf-8");
    for (const line of mounts.split("\n")) {
      // cgroup2 entries look like: "cgroup2 /sys/fs/cgroup cgroup2 rw,..."
      const parts = line.split(/\s+/);
      if (parts.length >= 3 && parts[2] === "cgroup2") {
        return parts[1];
      }
    }
  } catch {
    // Fall through
  }

  return "/sys/fs/cgroup";
}

/** Create a cgroup for a containment session. */
export function createCgroup(name: string, config: CgroupResourceConfig): void {
  const path = `${getCgroupPath()}/dharma/${name}`;
  try {
    execSync(`mkdir -p "${path}"`, { encoding: "utf-8", timeout: 2000 });
    // Write memory limit
    if (config.memoryLimitBytes > 0) {
      execSync(`echo ${config.memoryLimitBytes} > "${path}/memory.max"`, {
        encoding: "utf-8", timeout: 2000,
      });
    }
    // Write PID limit
    execSync(`echo ${config.pidsLimit} > "${path}/pids.max"`, {
      encoding: "utf-8", timeout: 2000,
    });
    // Write CPU limit
    execSync(`echo ${config.cpuQuota} ${config.cpuPeriod} > "${path}/cpu.max"`, {
      encoding: "utf-8", timeout: 2000,
    });
  } catch {
    // Cgroup creation may fail on systems without cgroups v2
  }
}

/** Destroy a cgroup after session completion. */
export function destroyCgroup(name: string): void {
  const path = `${getCgroupPath()}/dharma/${name}`;
  try {
    execSync(`rmdir "${path}"`, { encoding: "utf-8", timeout: 2000 });
  } catch {
    // Cleanup may fail if processes still in cgroup
  }
}

/** Attach a PID to a cgroup. */
export function attachPidToCgroup(name: string, pid: number): void {
  const path = `${getCgroupPath()}/dharma/${name}`;
  try {
    execSync(`echo ${pid} > "${path}/cgroup.procs"`, {
      encoding: "utf-8", timeout: 2000,
    });
  } catch {
    // May fail if cgroup doesn't exist yet
  }
}
