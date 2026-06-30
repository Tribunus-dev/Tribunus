/**
 * Dharma macOS Seatbelt — Process Tree Management
 *
 * Manages a macOS process tree rooted at a specific PID. Supports graceful
 * termination (SIGTERM => wait => SIGKILL) and emergency kill (SIGKILL
 * immediately) via process group signals.
 */

import { execSync } from "node:child_process"
import type { ContainedProcessTree, ProcessTreeState } from "../containment-types"

// ── MacOS Process Tree -------------------------------------------------------

export class MacOSProcessTree {
  constructor(
    private executionId: string,
    private rootPid: number,
  ) {}

  /**
   * Get current process tree state by checking if the root process exists.
   */
  async getState(): Promise<ProcessTreeState> {
    try {
      process.kill(this.rootPid, 0)
      return "running"
    } catch {
      return "terminated"
    }
  }

  /**
   * Get all child PIDs of the root process using recursive pgrep.
   */
  async getChildPids(): Promise<number[]> {
    const allChildren: number[] = []
    const visited = new Set<number>()

    const collectChildren = (pid: number): void => {
      if (visited.has(pid)) return
      visited.add(pid)

      try {
        const output = execSync(`pgrep -P ${pid}`, {
          encoding: "utf-8",
          timeout: 5000,
        })
        const children = output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(Number)
          .filter(n => !isNaN(n) && n > 0)

        for (const child of children) {
          allChildren.push(child)
          collectChildren(child)
        }
      } catch {
        // pgrep exits non-zero when no children found
      }
    }

    collectChildren(this.rootPid)
    return [...new Set(allChildren)]
  }

  /**
   * Gracefully terminate the process tree.
   * Sends SIGTERM to the process group, waits for processes to exit,
   * then escalates to SIGKILL for survivors.
   */
  async gracefulTerminate(timeoutMs = 5000): Promise<void> {
    const pids = await this.getChildPids()
    const allPids = [this.rootPid, ...pids]

    // Send SIGTERM to entire process group
    try {
      process.kill(-this.rootPid, "SIGTERM")
    } catch {
      // Process may already be gone
    }

    // Wait for all processes to exit
    const deadline = Date.now() + timeoutMs
    for (const pid of allPids) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break

      try {
        const pollUntil = Date.now() + remaining
        while (Date.now() < pollUntil) {
          try {
            process.kill(pid, 0)
            await MacOSProcessTree.sleep(100)
          } catch {
            break // Process no longer exists
          }
        }
      } catch {
        // Already gone
      }
    }

    // SIGKILL any survivors
    for (const pid of allPids) {
      try {
        process.kill(pid, 0)
        // Process still exists — escalate
        try {
          process.kill(-this.rootPid, "SIGKILL")
        } catch {
          process.kill(pid, "SIGKILL")
        }
      } catch {
        // Already terminated
      }
    }
  }

  /**
   * Emergency kill the entire process tree immediately with SIGKILL.
   */
  async emergencyKill(): Promise<void> {
    try {
      process.kill(-this.rootPid, "SIGKILL")
    } catch {
      // Process group may already be gone
    }

    // Also kill any remaining children individually
    const children = await this.getChildPids()
    for (const pid of children) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // Already gone
      }
    }
  }

  /**
   * Get process tree summary string for receipt.
   */
  async getSummary(): Promise<string> {
    const state = await this.getState()
    const children = await this.getChildPids()
    return `root:${this.rootPid},children:${children.length},state:${state}`
  }

  /**
   * Create a process tree record.
   */
  createRecord(): ContainedProcessTree {
    return {
      executionId: this.executionId,
      rootPid: this.rootPid,
      containmentId: `macos-ptree-${this.executionId}`,
      processGroupId: String(-this.rootPid),
      startedAt: new Date().toISOString(),
      childCount: 0,
      state: "running",
      leafPids: [],
    }
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
