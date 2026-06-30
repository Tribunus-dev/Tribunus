/**
 * Dharma Live Sandbox — Process Runner
 *
 * Bounded non-networked command execution.
 * Spawns child processes with strict timeouts, output limits,
 * and sanitized environments.
 */

import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { randomUUID } from "node:crypto"
import type { ResourceScope } from "../types"
import type { SandboxExecutionRequest, ActiveSandboxExecution, ExecutionState } from "./live-types"
import { ProcessExecutionError, OutputLimitError } from "./live-errors"

// ── State Transitions ──────────────────────────────────────────────────────

const EXECUTION_STATE_TRANSITIONS: Record<ExecutionState, Record<string, ExecutionState>> = {
  pending: { start: "running" },
  running: { complete: "completed", fail: "failed", cancel: "cancelled", terminate: "terminated" },
  completed: {},
  failed: {},
  cancelled: {},
  terminated: {},
}

export type ExecutionAction = "start" | "complete" | "fail" | "cancel" | "terminate"

/**
 * Transition execution state following the state machine.
 * Throws if the transition is invalid.
 */
export function transitionExecutionState(
  current: ExecutionState,
  action: ExecutionAction,
): ExecutionState {
  const transitions = EXECUTION_STATE_TRANSITIONS[current]
  if (!transitions) {
    throw new ProcessExecutionError(
      "state_machine",
      `No transitions defined for state "${current}"`,
    )
  }
  const next = transitions[action]
  if (!next) {
    throw new ProcessExecutionError(
      "state_machine",
      `Transition "${action}" is not valid from state "${current}"`,
    )
  }
  return next
}

// ── Environment Sanitization ───────────────────────────────────────────────

/**
 * Build a sanitized environment from an allowlist.
 * Strips host secrets and starts with only essential vars.
 */
export function buildSanitizedEnvironment(
  allowlist: string[],
): Record<string, string> {
  // Minimal safe baseline
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    USER: process.env.USER ?? "sandbox",
  }

  const allowSet = new Set(allowlist.map((v) => v.toLowerCase()))

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    const keyLower = key.toLowerCase()
    // Check exact match
    if (allowSet.has(keyLower)) {
      env[key] = value
      continue
    }
    // Check prefix match (e.g., "NODE_" allows "NODE_ENV", "NODE_PATH")
    for (const allowed of allowSet) {
      if (allowed.endsWith("_") && keyLower.startsWith(allowed)) {
        env[key] = value
        break
      }
    }
  }

  return env
}

// ── Executable Resolution ──────────────────────────────────────────────────

/**
 * Resolve a command name to its executable path using PATH.
 * Returns the command itself if it's already an absolute or relative path.
 */
export function resolveExecutable(command: string): string {
  // If already a path (absolute or relative), return as-is
  if (command.startsWith("/") || command.startsWith("./") || command.startsWith("../")) {
    return command
  }

  // Look up in PATH
  const pathEnv = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"
  const pathDirs = pathEnv.split(":")

  for (const dir of pathDirs) {
    const fullPath = `${dir}/${command}`
    try {
      accessSync(fullPath, constants.X_OK)
      return fullPath
    } catch {
      continue
    }
  }

  throw new ProcessExecutionError(command, `Command not found in PATH`)
}

// ── Bounded Command Execution ──────────────────────────────────────────────

/**
 * Execute a bounded safe command without shell.
 * Spawns the command directly, applies timeout and output limits,
 * and captures stdout/stderr.
 */
export async function executeBoundedCommand(
  request: SandboxExecutionRequest,
  sandboxRoot: string,
  sanitizedEnv: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string; runtimeMs: number }> {
  const executable = resolveExecutable(request.command)
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const child = spawn(executable, request.arguments, {
      cwd: request.workingDirectory ?? sandboxRoot,
      env: sanitizedEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: request.timeoutSeconds * 1000,
    })

    let stdout = ""
    let stderr = ""
    let stdoutLimit = request.outputLimitBytes
    let stderrLimit = request.outputLimitBytes
    let outputExceeded = false

    child.stdout!.on("data", (chunk: Buffer) => {
      if (stdoutLimit <= 0) {
        outputExceeded = true
        child.kill()
        return
      }
      const slice = chunk.subarray(0, stdoutLimit)
      stdout += slice.toString("utf-8")
      stdoutLimit -= slice.byteLength
    })

    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderrLimit <= 0) {
        outputExceeded = true
        child.kill()
        return
      }
      const slice = chunk.subarray(0, stderrLimit)
      stderr += slice.toString("utf-8")
      stderrLimit -= slice.byteLength
    })

    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        new ProcessExecutionError(
          request.command,
          err.code === "ENOENT"
            ? "Command not found"
            : `Spawn error: ${err.message}`,
        ),
      )
    })

    child.on("close", (code: number | null) => {
      const runtimeMs = Date.now() - startTime

      if (outputExceeded) {
        reject(new OutputLimitError(request.outputLimitBytes))
        return
      }

      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        runtimeMs,
      })
    })
  })
}
