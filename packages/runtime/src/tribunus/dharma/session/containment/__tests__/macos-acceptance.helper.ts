/**
 * macOS Seatbelt — Acceptance Test Execution Harness
 *
 * Runs Node.js fixture scripts inside sandbox-exec with Seatbelt
 * profiles and captures containment results.
 *
 * Profiles use (allow default) + specific deny rules. This is required
 * because (deny default) blocks the internal execvp() that sandbox-exec
 * uses to launch the target binary.
 *
 * Fixture scripts are staged under /private/tmp so they remain readable
 * even when the test profile denies access to /Users (where the
 * development tree lives).
 */

import { spawn, execSync } from "node:child_process"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as crypto from "node:crypto"
import type {
  EnvironmentPolicy,
} from "../containment-types"

// ── Constants ────────────────────────────────────────────────────────────────

const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec"
const PROFILE_DIR_PREFIX = "dharma-acceptance-"
const STAGE_DIR_PREFIX = "dharma-fixture-stage-"
const MAX_OUTPUT_BYTES = 1_048_576

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  exitCode: number | null
  stdout: string
  stderr: string
  profileContent: string
}

export interface FixtureOutput {
  allDenied: number
  succeeded: number
  total: number
  results: Array<Record<string, unknown>>
  [key: string]: unknown
}

// ── Profile Generation ───────────────────────────────────────────────────────

/**
 * Build a Seatbelt profile using (allow default) + specific deny rules.
 *
 * This pattern is mandatory because (deny default) blocks the execvp()
 * syscall that sandbox-exec uses internally to launch the target binary.
 * With (allow default) as the base, the process can execute normally
 * while targeted denies block access to specific resources.
 */
export function generateDenyBasedProfile(
  deniedReadRoots: string[],
  networkMode: string,
  extraDenyRules: string[],
): string {
  const parts: string[] = ['(version 1)', '(allow default)']

  if (deniedReadRoots.length > 0) {
    const denied = deniedReadRoots
      .map(r => {
        const escaped = r.replace(/"/g, '\\"')
        return `(deny file-read* file-read-metadata (path "${escaped}")(subpath "${escaped}"))`
      })
      .join('\n')
    parts.push(denied)
  }

  if (networkMode === "none") {
    parts.push('(deny network*)')
  }

  for (const rule of extraDenyRules) {
    parts.push(rule)
  }

  return parts.join('\n') + '\n'
}

// ── Node.js Binary Detection ─────────────────────────────────────────────────

let _nodePath: string | null = null

/**
 * Detect the system Node.js binary path.
 * Memoized after first call.
 */
export function getNodePath(): string {
  if (_nodePath) return _nodePath
  try {
    const result = execSync("which node", { encoding: "utf-8", timeout: 5000 }).trim()
    if (result) {
      _nodePath = result
      return result
    }
  } catch {
    // Fall through
  }
  _nodePath = process.execPath
  return _nodePath
}

// ── Fixture Staging ──────────────────────────────────────────────────────────

/**
 * Copy a fixture script to a temp directory so it is readable from within
 * the sandbox, even when the profile denies paths like /Users.
 *
 * Returns the staged path and a cleanup function.
 */
export async function stageFixture(
  fixturePath: string,
): Promise<{ stagedPath: string; cleanup: () => Promise<void> }> {
  const stageDir = path.join(
    os.tmpdir(),
    STAGE_DIR_PREFIX + crypto.randomBytes(4).toString("hex"),
  )
  await fs.mkdir(stageDir, { recursive: true, mode: 0o755 })

  const fixtureName = path.basename(fixturePath)
  const stagedPath = path.join(stageDir, fixtureName)
  await fs.cp(fixturePath, stagedPath, { force: true })

  const cleanup = async () => {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {})
  }

  return { stagedPath, cleanup }
}

// ── Execution Harness ────────────────────────────────────────────────────────

/**
 * Run a Node.js fixture script through sandbox-exec with a Seatbelt profile.
 *
 * The fixture is automatically staged to a temp directory to avoid path
 * conflicts when the profile denies access to /Users or other paths.
 */
export async function runInSeatbelt(
  scriptPath: string,
  args: string[],
  profileContent: string,
  envPolicy: EnvironmentPolicy,
  sandboxRoot: string,
): Promise<ExecutionResult> {
  const resolvedScript = path.resolve(scriptPath)
  const nodePath = getNodePath()

  // Stage fixture to a temp directory outside /Users
  const { stagedPath, cleanup } = await stageFixture(resolvedScript)

  const profilePath = await writeProfileFile(profileContent)

  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  for (const [key, value] of Object.entries(envPolicy.staticValues)) {
    env[key] = value
  }
  for (const key of envPolicy.deniedVariables) {
    delete env[key]
  }
  env.HOME = envPolicy.sandboxHome
  env.TMPDIR = envPolicy.sandboxTemp
  env.TMP = envPolicy.sandboxTemp
  env.SANDBOX_ROOT = sandboxRoot

  const child = spawn(SANDBOX_EXEC_PATH, [
    "-f", profilePath,
    nodePath,
    stagedPath,
    ...args,
  ], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  })

  let stdout = ""
  let stderr = ""
  let stdoutBytes = 0
  let stderrBytes = 0

  child.stdout?.on("data", (chunk: Buffer) => {
    const remaining = MAX_OUTPUT_BYTES - stdoutBytes
    if (remaining <= 0) return
    const slice = chunk.subarray(0, remaining)
    stdout += slice.toString("utf-8")
    stdoutBytes += slice.length
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const remaining = MAX_OUTPUT_BYTES - stderrBytes
    if (remaining <= 0) return
    const slice = chunk.subarray(0, remaining)
    stderr += slice.toString("utf-8")
    stderrBytes += slice.length
  })

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve)
    child.on("error", () => resolve(null))
  })

  // Cleanup
  await cleanup()
  await fs.unlink(profilePath).catch(() => {})
  const profileDir = path.dirname(profilePath)
  await fs.rmdir(profileDir).catch(() => {})

  return { exitCode, stdout, stderr, profileContent }
}

// ── Availability Check ───────────────────────────────────────────────────────

/**
 * Check if sandbox-exec is available on this system.
 */
export async function isSandboxExecAvailable(): Promise<boolean> {
  try {
    await fs.access(SANDBOX_EXEC_PATH, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

// ── Profile File Management ──────────────────────────────────────────────────

/**
 * Create a temporary Seatbelt profile file on disk.
 * Returns the absolute path to the created file.
 */
export async function writeProfileFile(profileContent: string): Promise<string> {
  const tmpDir = path.join(
    os.tmpdir(),
    PROFILE_DIR_PREFIX + crypto.randomBytes(4).toString("hex"),
  )
  await fs.mkdir(tmpDir, { recursive: true, mode: 0o700 })

  const profilePath = path.join(tmpDir, "sandbox.sb")
  await fs.writeFile(profilePath, profileContent, { mode: 0o600 })

  return profilePath
}

// ── Fixture Output Parsing ───────────────────────────────────────────────────

/**
 * Parse fixture output JSON from stdout.
 * Returns null if no valid JSON is found.
 */
export function parseFixtureOutput(stdout: string): FixtureOutput | null {
  const lines = stdout.trim().split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as FixtureOutput
      }
    } catch {
      continue
    }
  }
  return null
}

// ── Policy Builders ──────────────────────────────────────────────────────────

/**
 * Build an environment policy that cleanses host secrets and sets
 * sandboxed home/temp directories.
 */
export function makeCleansedEnvironmentPolicy(
  additionalDenied: string[] = [],
): EnvironmentPolicy {
  return {
    allowedVariables: ["SANDBOX_ROOT"],
    deniedVariables: [
      "SSH_AUTH_SOCK",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "GITHUB_TOKEN",
      "NPM_TOKEN",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "AZURE_CLIENT_SECRET",
      "GOOGLE_APPLICATION_CREDENTIALS",
      ...additionalDenied,
    ],
    staticValues: {
      SANDBOX_ROOT: "/tmp/sandbox-test",
    },
    sandboxHome: "/tmp/sandbox-home",
    sandboxTemp: "/tmp/sandbox-temp",
  }
}
