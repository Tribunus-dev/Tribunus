/**
 * macOS Seatbelt — Acceptance Tests
 *
 * Executes real hostile payloads through sandbox-exec Seatbelt profiles
 * and verifies containment from outside the sandbox.
 *
 * These are REAL OS-level containment tests — they use actual
 * sandbox-exec via spawn and exercise real macOS Seatbelt enforcement.
 *
 * All tests skip gracefully when sandbox-exec is unavailable
 * (Linux, CI without macOS sandbox, etc.).
 */

import { describe, it, expect, beforeAll } from "bun:test"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import { z } from "zod/v4"
import {
  runInSeatbelt,
  isSandboxExecAvailable,
  parseFixtureOutput,
  generateDenyBasedProfile,
  makeCleansedEnvironmentPolicy,
} from "./macos-acceptance.helper"
import type { EnvironmentPolicy } from "../containment-types"

// ── Zod Schemas for Fixture Output ───────────────────────────────────────────

/** Generic fixture output: { allDenied, succeeded, total, results }. */
/** read-escape.js uses { allDenied, leaked, total, results }. */
const ReadEscapeSchema = z.object({
  allDenied: z.number().int().nonnegative(),
  leaked: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  results: z.array(z.any()).optional(),
})

/** network-connect.js / symlink-escape.js uses { allDenied, succeeded, total, results }. */
const DenialCountingSchema = z.object({
  allDenied: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  results: z.array(z.any()).optional(),
})

/** secret-read.js output: { found, total, results, homeDirectory, homeContents }. */
const SecretReadSchema = z.object({
  found: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  results: z.array(z.any()).optional(),
})

/** fork-bomb.js output: { spawned, failed, maxReached, liveChildren }. */
const ForkOutputSchema = z.object({
  spawned: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  maxReached: z.boolean(),
  liveChildren: z.number().int().nonnegative(),
})

// ── Paths ────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.resolve(__dirname, "..", "__fixtures__")
const SANDBOX_ROOT = path.join(os.tmpdir(), "dharma-acceptance-sandbox-" + Date.now().toString(36))

// ── Fixture Target Counts ────────────────────────────────────────────────────

const READ_ESCAPE_TARGETS = 11
const NETWORK_CONNECT_TARGETS = 5
const SYMLINK_ESCAPE_TARGETS = 5
const SECRET_READ_TARGETS = 10

// ── Setup ────────────────────────────────────────────────────────────────────

let sandboxAvailable: boolean

beforeAll(async () => {
  sandboxAvailable = await isSandboxExecAvailable()
  if (sandboxAvailable) {
    // Create sandbox root and sandbox home so fixtures can write there
    // secret-read.js also calls fs.readdirSync on HOME
    await mkdirp(SANDBOX_ROOT)
    await mkdirp("/tmp/sandbox-home")
    await mkdirp("/tmp/sandbox-temp")
  }
})

async function mkdirp(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o755 })
  } catch {
    // best effort
  }
}

// ── Filesystem Escape Test ───────────────────────────────────────────────────

describe("Filesystem Escape", () => {
  const fixturePath = path.join(FIXTURES_DIR, "read-escape.js")

  it(
    "prevents reading files outside the sandbox",
    async () => {
      if (!sandboxAvailable) {
        console.log("Skipping: sandbox-exec not available on this system")
        return
      }

      const denies = ["/etc", "/private/var/db", "/var/root"]
      const profile = generateDenyBasedProfile(denies, "none", [])
      const envPolicy: EnvironmentPolicy = makeCleansedEnvironmentPolicy()

      const result = await runInSeatbelt(
        fixturePath,
        [],
        profile,
        envPolicy,
        SANDBOX_ROOT,
      )
      
      const parsed = parseFixtureOutput(result.stdout)
      expect(parsed).not.toBeNull()
      const output = ReadEscapeSchema.parse(parsed)
      expect(output.allDenied).toBe(READ_ESCAPE_TARGETS)
      expect(output.leaked).toBe(0)
      expect(result.exitCode).toBe(0)
    },
    30_000,
  )
})

// ── Network Denial Test ──────────────────────────────────────────────────────

describe("Network Denial", () => {
  const fixturePath = path.join(FIXTURES_DIR, "network-connect.js")

  it(
    "prevents all network connections with mode 'none'",
    async () => {
      if (!sandboxAvailable) {
        console.log("Skipping: sandbox-exec not available on this system")
        return
      }

      const profile = generateDenyBasedProfile([], "none", [])
      const envPolicy: EnvironmentPolicy = makeCleansedEnvironmentPolicy()

      const result = await runInSeatbelt(
        fixturePath,
        [],
        profile,
        envPolicy,
        SANDBOX_ROOT,
      )

      const parsed = parseFixtureOutput(result.stdout)
      expect(parsed).not.toBeNull()
      const output = DenialCountingSchema.parse(parsed)

      expect(output.total).toBe(NETWORK_CONNECT_TARGETS)
      expect(output.allDenied).toBe(NETWORK_CONNECT_TARGETS)
      expect(output.succeeded).toBe(0)
      expect(result.exitCode).toBe(0)
    },
    30_000,
  )
})

// ── Symlink Escape Test ──────────────────────────────────────────────────────

describe("Symlink Escape", () => {
  const fixturePath = path.join(FIXTURES_DIR, "symlink-escape.js")

  it(
    "prevents symlink-based sandbox escapes",
    async () => {
      if (!sandboxAvailable) {
        console.log("Skipping: sandbox-exec not available on this system")
        return
      }

      const denies = ["/etc", "/Users", "/var/root"]
      const extra = ['(deny file-write*)', '(deny file-link)']
      const profile = generateDenyBasedProfile(denies, "none", extra)
      const envPolicy: EnvironmentPolicy = makeCleansedEnvironmentPolicy()

      const result = await runInSeatbelt(
        fixturePath,
        [],
        profile,
        envPolicy,
        SANDBOX_ROOT,
      )

      const parsed = parseFixtureOutput(result.stdout)
      expect(parsed).not.toBeNull()
      const output = DenialCountingSchema.parse(parsed)

      expect(output.total).toBe(SYMLINK_ESCAPE_TARGETS)
      expect(output.allDenied).toBe(SYMLINK_ESCAPE_TARGETS)
      expect(output.succeeded).toBe(0)
      expect(result.exitCode).toBe(0)
    },
    30_000,
  )
})

// ── Secret Isolation Test ────────────────────────────────────────────────────

describe("Secret Isolation", () => {
  const fixturePath = path.join(FIXTURES_DIR, "secret-read.js")

  it(
    "prevents host secrets from leaking into the sandbox environment",
    async () => {
      if (!sandboxAvailable) {
        console.log("Skipping: sandbox-exec not available on this system")
        return
      }

      const profile = generateDenyBasedProfile([], "none", [])
      const envPolicy: EnvironmentPolicy = makeCleansedEnvironmentPolicy()

      const result = await runInSeatbelt(
        fixturePath,
        [],
        profile,
        envPolicy,
        SANDBOX_ROOT,
      )

      const parsed = parseFixtureOutput(result.stdout)
      expect(parsed).not.toBeNull()
      const output = SecretReadSchema.parse(parsed)

      expect(output.total).toBe(SECRET_READ_TARGETS)
      expect(output.found).toBe(0)
      expect(result.exitCode).toBe(0)
    },
    30_000,
  )
})

// ── Fork Limit Test ──────────────────────────────────────────────────────────

describe("Fork Limit", () => {
  const fixturePath = path.join(FIXTURES_DIR, "fork-bomb.js")

  it(
    "denies process forking under restrictive profile",
    async () => {
      if (!sandboxAvailable) {
        console.log("Skipping: sandbox-exec not available on this system")
        return
      }

      const extra = ['(deny process-fork)']
      const profile = generateDenyBasedProfile([], "none", extra)
      const envPolicy: EnvironmentPolicy = makeCleansedEnvironmentPolicy()

      const result = await runInSeatbelt(
        fixturePath,
        [],
        profile,
        envPolicy,
        SANDBOX_ROOT,
      )

      const parsed = parseFixtureOutput(result.stdout)
      expect(parsed).not.toBeNull()
      const output = ForkOutputSchema.parse(parsed)

      expect(output.spawned).toBe(0)
      expect(result.exitCode).toBe(0)
    },
    30_000,
  )
})
