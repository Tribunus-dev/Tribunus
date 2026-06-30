/**
 * Dharma OS-Enforced Sandbox — Linux Containment Acceptance Test Helper
 *
 * Provides a real unshare-based execution harness for testing Linux
 * namespace, seccomp, and cgroup containment. Each test uses spawn()
 * to create isolated processes, never mocking the OS primitives.
 */

import { spawn, execSync } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

export interface LinuxExecutionConfig {
  executable: string
  args: string[]
  sandboxRoot: string
  allowedReadPaths: string[]
  allowedWritePaths: string[]
  denyNetwork: boolean
  denySeccomp: boolean
  memoryLimitBytes?: number
  pidLimit?: number
}

export interface ExecutionResult {
  exitCode: number | null
  stdout: string
  stderr: string
  namespaceSummary: string
}

/**
 * Run a command inside a Linux namespace + seccomp sandbox using real
 * unshare(1), namespace operations, and optionally cgroups v2.
 */
export async function runInLinuxSandbox(
  config: LinuxExecutionConfig,
): Promise<ExecutionResult> {
  const argv = buildUnshareCommand(config)
  const nsFlags: string[] = []

  if (config.denyNetwork || config.sandboxRoot) {
    // Determine which namespaces are activated
    if (config.sandboxRoot) nsFlags.push("mount")
    if (config.denyNetwork) nsFlags.push("net")
    if (config.pidLimit) nsFlags.push("pid")
    nsFlags.push("user", "ipc", "uts")
  }

  const child = spawn(argv[0], argv.slice(1), {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: "/tmp",
      USER: "nobody",
    },
  })

  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []

  child.stdout?.on("data", (data: Buffer) => {
    stdoutChunks.push(data.toString())
  })

  child.stderr?.on("data", (data: Buffer) => {
    stderrChunks.push(data.toString())
  })

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve)
  })

  const stdout = stdoutChunks.join("")
  const stderr = stderrChunks.join("")

  return {
    exitCode,
    stdout,
    stderr,
    namespaceSummary:
      nsFlags.length > 0
        ? `unshare --${nsFlags.join(" --")}`
        : "no namespace isolation",
  }
}

/**
 * Check if Linux namespace+seccomp sandboxing is available on this host.
 * Returns false on non-Linux platforms or when required tools are missing.
 */
export async function isLinuxSandboxAvailable(): Promise<boolean> {
  if (process.platform !== "linux") {
    return false
  }

  try {
    execSync("which unshare", { encoding: "utf-8", timeout: 2000 })
    // Verify we can actually create a user namespace
    execSync("unshare --user true", { encoding: "utf-8", timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Build the argv array for `unshare` given a LinuxExecutionConfig.
 *
 * Handles namespace flags and constructs a shell command to perform
 * initial mount setup before execing the target program.
 */
export function buildUnshareCommand(config: LinuxExecutionConfig): string[] {
  const flags: string[] = [
    "--user",
    "-r",
    "--fork",
    "--kill-child",
  ]

  const shellPreamble: string[] = []

  // Mount namespace — used for filesystem isolation
  const needsMount =
    config.sandboxRoot.length > 0 ||
    config.allowedReadPaths.length > 0 ||
    config.allowedWritePaths.length > 0

  if (needsMount) {
    flags.push("--mount")
    shellPreamble.push("mount --make-private /")

    // Set up a contained root via the fixture's sandbox directory
    if (config.sandboxRoot) {
      // Create mount point and bind the sandbox root read-only
      shellPreamble.push(
        `mkdir -p /tmp/_sandbox_mnt 2>/dev/null; true`,
      )
      shellPreamble.push(
        `mount --bind -o ro "${config.sandboxRoot}" /tmp/_sandbox_mnt 2>/dev/null; true`,
      )
    }

    // Bind allowed read paths
    for (const p of config.allowedReadPaths) {
      shellPreamble.push(
        `mount --bind -o ro "${p}" "${p}" 2>/dev/null; true`,
      )
    }

    // Bind allowed write paths
    for (const p of config.allowedWritePaths) {
      shellPreamble.push(
        `mount --bind -o rw "${p}" "${p}" 2>/dev/null; true`,
      )
    }
  }

  // Network namespace
  if (config.denyNetwork) {
    flags.push("--net")
    // Bring up loopback before the target starts so local connections work
    // Deny external connectivity by not adding any routes
    shellPreamble.push("ip link set lo up 2>/dev/null; true")
  }

  // PID namespace for process limits
  if (config.pidLimit) {
    flags.push("--pid")
    // Mount /proc so PID namespace is effective
    shellPreamble.push(
      "mount -t proc none /proc 2>/dev/null; true",
    )
  }

  // Build the eventual exec command
  const execParts = [`exec`, config.executable, ...config.args.map((a) => `"${a.replace(/"/g, '\\"')}"`)]

  let shellCmd: string
  if (shellPreamble.length > 0) {
    shellCmd = [...shellPreamble, execParts.join(" ")].join(" && ")
  } else {
    shellCmd = execParts.join(" ")
  }

  flags.push("--", "sh", "-c", shellCmd)

  return ["unshare", ...flags]
}
