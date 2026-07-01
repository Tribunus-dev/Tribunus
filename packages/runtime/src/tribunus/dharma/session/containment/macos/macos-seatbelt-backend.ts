/**
 * Dharma macOS Seatbelt — Compatibility Backend
 *
 * Executes commands within a sandbox-exec Seatbelt profile on macOS.
 * Provides process-level containment beneath the SessionController →
 * LocalFilesystemSandboxAdapter authority chain.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { spawn } from "node:child_process"
import type {
  ContainedExecutionRequest,
  ContainedExecutionReceipt,
  ContainedProcessTree,
  ContainmentCapability,
} from "../containment-types"
import {
  compileFilesystemPolicy,
  compileNetworkPolicy,
  compileEnvironmentPolicy,
  compileResourceLimits,
  computePolicyDigest,
} from "../containment-policy"
import { generateSeatbeltProfile } from "./macos-seatbelt-profile"
import { createViolation } from "../containment-audit"
import { MacOSProcessTree } from "./macos-process-tree"
import { createHash } from "node:crypto"

// ── Constants ----------------------------------------------------------------

const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec"
const MAX_OUTPUT_BYTES = 1_048_576 // 1 MB — prevents runaway output
const PROFILE_DIR_PREFIX = "dharma-seatbelt-"
const DEFAULT_KILL_TIMEOUT_MS = 5000

// ── Backend Implementation ---------------------------------------------------

export class MacOSSeatbeltCompatibilityBackend {
  /**
   * Execute a command inside a sandbox-exec Seatbelt profile.
   */
  async execute(req: ContainedExecutionRequest): Promise<ContainedExecutionReceipt> {
    const startedAt = new Date().toISOString()

    // Compile policy objects from request
    const fsPolicy = compileFilesystemPolicy(req)
    const netPolicy = compileNetworkPolicy(req)
    const envPolicy = compileEnvironmentPolicy(req)
    const resourceLimits = compileResourceLimits(req)

    // Compute policy digests
    const filesystemPolicyDigest = computePolicyDigest(fsPolicy as unknown as Record<string, unknown>)
    const networkPolicyDigest = computePolicyDigest(netPolicy as unknown as Record<string, unknown>)
    const resourcePolicyDigest = computePolicyDigest(resourceLimits as unknown as Record<string, unknown>)

    // Generate and write Seatbelt profile
    const profilePath = await this.writeProfileFile(fsPolicy, netPolicy, envPolicy)

    // Compute profile digest for receipt
    const profileContent = await fs.readFile(profilePath, "utf-8")
    const containmentProfileDigest = createHash("sha256").update(profileContent).digest("hex")

    const violationEvents: Array<{ timestamp: string; kind: string; details: string }> = []
    let exitCode: number | null = null
    let terminationReason: string | null = null
    let stdoutDigest: string | null = null
    let stderrDigest: string | null = null

    try {
      // Execute via sandbox-exec
      const result = await this.runSandboxed(
        profilePath,
        req.executablePath,
        req.argv,
        envPolicy,
        resourceLimits,
      )

      exitCode = result.exitCode
      stdoutDigest = createHash("sha256").update(result.stdout).digest("hex")
      stderrDigest = createHash("sha256").update(result.stderr).digest("hex")
    } catch (err) {
      terminationReason = err instanceof Error ? err.message : String(err)
    } finally {
      // Clean up profile file
      await fs.unlink(profilePath).catch(() => {})

      // Attempt to clean up temp directory
      const profileDir = path.dirname(profilePath)
      await fs.rmdir(profileDir).catch(() => {})
    }

    const endedAt = new Date().toISOString()

    // Build process tree summary
    let processTreeSummary = ""
    try {
      const processTree = new MacOSProcessTree(req.executionId, process.pid)
      processTreeSummary = await processTree.getSummary()
    } catch {
      processTreeSummary = "root:unknown,children:0,state:unknown"
    }

    return {
      executionId: req.executionId,
      containmentBackend: "macos_seatbelt",
      containmentProfileDigest,
      filesystemPolicyDigest,
      networkPolicyDigest,
      resourcePolicyDigest,
      startedAt,
      endedAt,
      exitCode,
      terminationReason,
      violationEvents: violationEvents.map(v => ({
        timestamp: v.timestamp,
        kind: v.kind,
        details: v.details,
      })),
      stdoutDigest,
      stderrDigest,
      processTreeSummary,
    }
  }

  /**
   * Check if sandbox-exec is available on this system.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await fs.access(SANDBOX_EXEC_PATH, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * Terminate a running process tree by process group ID.
   */
  async terminateProcessTree(processGroupId: string, emergency: boolean): Promise<void> {
    const pgid = parseInt(processGroupId, 10)
    if (isNaN(pgid)) {
      throw new Error(`Invalid process group ID: ${processGroupId}`)
    }

    if (emergency) {
      try {
        process.kill(-pgid, "SIGKILL")
      } catch {
        // Process group may already be gone
      }
    } else {
      try {
        process.kill(-pgid, "SIGTERM")
      } catch {
        // Process group may already be gone
        return
      }

      // Wait then escalate
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Escalate to SIGKILL after timeout
          try {
            process.kill(-pgid, "SIGKILL")
          } catch {
            // Already gone
          }
          resolve()
        }, DEFAULT_KILL_TIMEOUT_MS)

        // Check if process exits before timeout
        const check = setInterval(() => {
          try {
            process.kill(pgid, 0)
          } catch {
            clearTimeout(timeout)
            clearInterval(check)
            resolve()
          }
        }, 200)

        // Ensure cleanup
        setTimeout(() => {
          clearInterval(check)
        }, DEFAULT_KILL_TIMEOUT_MS + 1000)
      })
    }
  }

  /**
   * Detect containment capabilities for this backend.
   */
  async detectCapabilities(): Promise<ContainmentCapability> {
    const available = await this.isAvailable()

    return {
      backend: "macos_seatbelt",
      available,
      version: available ? await this.getSandboxExecVersion() : null,
      supportedFeatures: available
        ? ["filesystem_isolation", "network_isolation", "process_isolation"]
        : [],
      unsupportedFeatures: [],
      deprecationWarning: null,
    }
  }

  /**
   * Create a temporary Seatbelt profile file.
   */
  private async writeProfileFile(
    fsPolicy: Parameters<typeof generateSeatbeltProfile>[0],
    netPolicy: Parameters<typeof generateSeatbeltProfile>[1],
    envPolicy: Parameters<typeof generateSeatbeltProfile>[2],
  ): Promise<string> {
    const profile = generateSeatbeltProfile(fsPolicy, netPolicy, envPolicy)

    const tmpDir = path.join(
      os.tmpdir(),
      PROFILE_DIR_PREFIX + Date.now().toString(36),
    )
    await fs.mkdir(tmpDir, { recursive: true, mode: 0o700 })

    const profilePath = path.join(tmpDir, "sandbox.sb")
    await fs.writeFile(profilePath, profile.profileContent, {
      mode: 0o600,
    })

    return profilePath
  }

  /**
   * Execute command via sandbox-exec with the generated profile.
   */
  private async runSandboxed(
    profilePath: string,
    executable: string,
    args: string[],
    envPolicy?: Parameters<typeof compileEnvironmentPolicy>[0] extends undefined ? undefined : {
      allowedVariables: string[]
      deniedVariables: string[]
      staticValues: Record<string, string>
      sandboxHome: string
      sandboxTemp: string
    },
    resourceLimits?: Parameters<typeof compileResourceLimits>[0] extends undefined ? undefined : {
      maximumOutputBytes: number
      maximumRuntimeSeconds: number
    },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      // Build environment
      const env: Record<string, string> = { ...process.env as Record<string, string> }

      // Apply static values from environment policy
      if (envPolicy?.staticValues) {
        for (const [key, value] of Object.entries(envPolicy.staticValues)) {
          env[key] = value
        }
      }

      // Strip denied environment variables
      if (envPolicy?.deniedVariables) {
        for (const key of envPolicy.deniedVariables) {
          delete env[key]
        }
      }

      // Set sanitized HOME/TMP
      if (envPolicy?.sandboxHome) {
        env.HOME = envPolicy.sandboxHome
      }
      if (envPolicy?.sandboxTemp) {
        env.TMPDIR = envPolicy.sandboxTemp
        env.TMP = envPolicy.sandboxTemp
      }

      const sandboxArgs = ["-f", profilePath, executable, ...args]

      const child = spawn(SANDBOX_EXEC_PATH, sandboxArgs, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        // Use a process group so we can kill the tree
        detached: false,
      })

      let stdout = ""
      let stderr = ""
      let stdoutBytes = 0
      let stderrBytes = 0
      const maxOut = resourceLimits?.maximumOutputBytes ?? MAX_OUTPUT_BYTES

      child.stdout?.on("data", (chunk: Buffer) => {
        const remaining = maxOut - stdoutBytes
        if (remaining <= 0) return
        const slice = chunk.subarray(0, remaining)
        stdout += slice.toString("utf-8")
        stdoutBytes += slice.length
      })

      child.stderr?.on("data", (chunk: Buffer) => {
        const remaining = maxOut - stderrBytes
        if (remaining <= 0) return
        const slice = chunk.subarray(0, remaining)
        stderr += slice.toString("utf-8")
        stderrBytes += slice.length
      })

      // Runtime timeout
      const maxRuntime = (resourceLimits?.maximumRuntimeSeconds ?? 30) * 1000
      let runtimeTimer: ReturnType<typeof setTimeout> | null = null

      if (maxRuntime > 0) {
        runtimeTimer = setTimeout(() => {
          try {
            if (child.pid) {
              process.kill(-child.pid, "SIGKILL")
            }
          } catch {
            // Already gone
          }
        }, maxRuntime)
      }

      child.on("close", (code) => {
        if (runtimeTimer) clearTimeout(runtimeTimer)
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
        })
      })

      child.on("error", (err) => {
        if (runtimeTimer) clearTimeout(runtimeTimer)
        reject(err)
      })
    })
  }

  /**
   * Get sandbox-exec version string.
   */
  private async getSandboxExecVersion(): Promise<string | null> {
    try {
      const { execSync } = await import("node:child_process")
      const output = execSync(`${SANDBOX_EXEC_PATH} --version`, {
        encoding: "utf-8",
        timeout: 5000,
      })
      return output.trim().split("\n")[0] ?? null
    } catch {
      return null
    }
  }
}
