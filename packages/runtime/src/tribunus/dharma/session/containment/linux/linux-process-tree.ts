/**
 * Dharma OS-Enforced Sandbox — Linux Process Tree Management
 *
 * Manages contained process trees on Linux: tracks parent-child relationships,
 * performs graceful termination and emergency kill, and reports tree state.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type {
  ContainedProcessTree,
  ProcessTreeState,
} from "../containment-types";

export interface LinuxProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  state: string;
  threadCount: number;
}

export class LinuxProcessTree {
  constructor(
    private executionId: string,
    private rootPid: number,
    private cgroupPath?: string,
  ) {}

  /** Get the current state of the process tree. */
  async getState(): Promise<ProcessTreeState> {
    // Check if root process is alive
    const alive = await this.isAlive(this.rootPid);
    if (!alive) {
      return "terminated";
    }

    // Check if we have any child processes
    const children = await this.getChildPids();
    if (children.length === 0) {
      return "draining";
    }

    return "running";
  }

  /** Get all child PIDs of the root process. */
  async getChildPids(): Promise<number[]> {
    const pids: number[] = [];
    const seen = new Set<number>();
    const queue = [this.rootPid];

    while (queue.length > 0) {
      const pid = queue.shift()!;
      if (seen.has(pid)) continue;
      seen.add(pid);

      try {
        // Read /proc/<pid>/task/<tid>/children for direct children
        const childrenStr = readFileSync(
          `/proc/${pid}/task/${pid}/children`,
          "utf-8",
        ).trim();
        if (childrenStr) {
          const childPids = childrenStr.split(/\s+/).map(Number);
          for (const childPid of childPids) {
            if (!isNaN(childPid) && childPid > 0 && !seen.has(childPid)) {
              pids.push(childPid);
              queue.push(childPid);
            }
          }
        }
      } catch {
        // Process no longer exists or permission denied
      }
    }

    return pids;
  }

  /** Gracefully terminate the process tree. */
  async gracefulTerminate(timeoutMs: number = 5000): Promise<void> {
    const children = await this.getChildPids();

    // Send SIGTERM to all children first (leaf-first)
    for (const pid of children) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may already be dead
      }
    }

    // Then SIGTERM the root
    try {
      process.kill(this.rootPid, "SIGTERM");
    } catch {
      // Already dead
    }

    // Wait for processes to exit
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const children = await this.getChildPids();
      const rootAlive = await this.isAlive(this.rootPid);
      if (!rootAlive && children.length === 0) {
        return; // All dead
      }
      await sleep(100);
    }
  }

  /** Force-kill the process tree immediately. */
  async emergencyKill(): Promise<void> {
    // Send SIGKILL to all children first
    try {
      const children = await this.getChildPids();
      for (const pid of children) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already dead
        }
      }
    } catch {
      // Failed to enumerate children — kill root directly
    }

    // Kill root
    try {
      process.kill(this.rootPid, "SIGKILL");
    } catch {
      // Already dead
    }
  }

  /** Get a human-readable summary of the process tree. */
  async getSummary(): Promise<string> {
    const state = await this.getState();
    const children = await this.getChildPids();
    return `execution=${this.executionId} rootPid=${this.rootPid} state=${state} children=${children.length} cgroup=${this.cgroupPath ?? "none"}`;
  }

  /** Create a ContainedProcessTree record for this containment session. */
  createRecord(): ContainedProcessTree {
    return {
      executionId: this.executionId,
      rootPid: this.rootPid,
      containmentId: `linux-contain-${this.executionId}`,
      processGroupId: `pg-${this.executionId}`,
      startedAt: new Date().toISOString(),
      childCount: 0, // Updated lazily
      state: "running",
      leafPids: [],
    };
  }

  private async isAlive(pid: number): Promise<boolean> {
    try {
      // /proc/<pid> exists while the process is alive (or a zombie)
      return existsSync(`/proc/${pid}`);
    } catch {
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Enumerate child processes of a given PID on Linux. */
export function enumerateChildProcesses(
  pid: number,
): LinuxProcessInfo[] {
  const tree = new LinuxProcessTree("", pid);
  // Synchronous variant using /proc enumeration
  const results: LinuxProcessInfo[] = [];
  try {
    const taskDir = `/proc/${pid}/task`;
    const tasks = execSync(`ls "${taskDir}"`, {
      encoding: "utf-8", timeout: 2000,
    }).trim().split("\n");
    for (const tid of tasks) {
      if (!tid) continue;
      try {
        const status = execSync(
          `cat /proc/${pid}/task/${tid}/status 2>/dev/null`,
          { encoding: "utf-8", timeout: 2000 },
        );
        const nameMatch = status.match(/^Name:\s+(.+)$/m);
        const stateMatch = status.match(/^State:\s+(.+)$/m);
        const pPidMatch = status.match(/^PPid:\s+(\d+)$/m);
        const threadMatch = status.match(/^Threads:\s+(\d+)$/m);
        results.push({
          pid: parseInt(tid, 10),
          ppid: pPidMatch ? parseInt(pPidMatch[1], 10) : 0,
          name: nameMatch ? nameMatch[1].trim() : "unknown",
          state: stateMatch ? stateMatch[1].trim() : "?",
          threadCount: threadMatch ? parseInt(threadMatch[1], 10) : 0,
        });
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // Process no longer exists
  }
  return results;
}

/** Kill a process tree on Linux. */
export function killProcessTree(pid: number, signal: string = "SIGTERM"): void {
  try {
    // Kill process group
    process.kill(-pid, signal);
  } catch {
    // May fail if process already dead
  }
}

/** Wait for a process to exit. */
export function waitForProcessExit(pid: number, timeoutMs: number = 5000): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(`/proc/${pid}`)) {
      return true;
    }
  }
  return false;
}
