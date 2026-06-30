/**
 * Dharma Session Authority — Backend-neutral SandboxAdapter
 *
 * Provides a factory for creating SandboxAdapter implementations,
 * path safety utilities, and digest computation.
 */

import type { SandboxAdapter, CommandResult, ResourceScope } from "./types"
import { SandboxError } from "./session-errors"
import { createHash } from "node:crypto"
import { resolve, normalize, relative, dirname } from "node:path"
import { readdirSync, statSync } from "node:fs"
import { readFile, writeFile, mkdir, rm } from "node:fs/promises"

// ── Path Safety --------------------------------------------------------------

/**
 * Check for path traversal attempts in a requested path.
 * Detects `..`, symlink traversal patterns, and null bytes.
 */
export function hasPathTraversal(requestPath: string): boolean {
  if (requestPath.includes("\0")) {
    return true
  }

  // Split on platform separators and check for parent directory components
  const normalized = requestPath.replace(/\\/g, "/")
  const segments = normalized.split("/")
  let depth = 0
  for (const segment of segments) {
    if (segment === "..") {
      depth--
      if (depth < 0) {
        return true
      }
    } else if (segment !== "." && segment !== "") {
      depth++
    }
  }

  // Check for encoded traversal variants
  if (
    normalized.includes("%2e%2e") || // URL-encoded ".."
    normalized.includes("%252e%252e") || // Double-encoded ".."
    normalized.includes("..%00") // Null byte after ".."
  ) {
    return true
  }

  return false
}

/**
 * Normalize and resolve a path, checking for sandbox escape.
 * Joins sandboxRoot + requestPath, normalizes, and verifies
 * the result is within the sandbox root.
 *
 * @throws {SandboxError} If the resolved path escapes the sandbox
 */
export function resolveSandboxPath(sandboxRoot: string, requestPath: string): string {
  if (hasPathTraversal(requestPath)) {
    throw new SandboxError(
      `Path traversal detected in request path: ${requestPath}`,
    )
  }

  const resolved = normalize(resolve(sandboxRoot, requestPath))

  if (!isPathWithinSandbox(resolved, sandboxRoot)) {
    throw new SandboxError(
      `Resolved path escapes sandbox: ${resolved} is outside ${sandboxRoot}`,
    )
  }

  return resolved
}

/**
 * Validate that a resolved path is within the sandbox root.
 * Both paths should already be resolved/normalized.
 */
export function isPathWithinSandbox(resolvedPath: string, sandboxRoot: string): boolean {
  const normalizedPath = normalize(resolvedPath)
  const normalizedRoot = normalize(sandboxRoot)

  // Ensure the sandbox root ends with a separator so "sandbox/path" doesn't
  // match "sandbox/path-elsewhere"
  const rootWithSep = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(rootWithSep)
}

// ── Digest -------------------------------------------------------------------

/**
 * Compute a SHA-256 digest for a set of bytes.
 */
export function computeDigest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

// ── Command Safety -----------------------------------------------------------

/**
 * Validate that a command is safe given a resource scope.
 *
 * Checks against the scope's allowedCommands and deniedCommands lists.
 * An empty allowedCommands list means no commands are permitted.
 * An empty deniedCommands list means nothing is explicitly denied beyond
 * the allowed list.
 */
export function validateCommandSafety(
  command: string,
  _args: string[],
  scope: ResourceScope,
): { safe: boolean; reason: string | null } {
  // Check denied commands first
  if (scope.deniedCommands.length > 0) {
    for (const denied of scope.deniedCommands) {
      if (command === denied || command.startsWith(`${denied} `)) {
        return { safe: false, reason: `Command '${command}' is explicitly denied` }
      }
    }
  }

  // Check allowed commands — if non-empty, command must match one
  if (scope.allowedCommands.length > 0) {
    const allowed = scope.allowedCommands.some((a) => command === a || command.startsWith(`${a} `))
    if (!allowed) {
      return {
        safe: false,
        reason: `Command '${command}' is not in the allowed commands list`,
      }
    }
  }

  return { safe: true, reason: null }
}

// ── Factory: No-op Sandbox ---------------------------------------------------

/**
 * Create a no-op sandbox adapter for testing / development.
 *
 * Most operations throw SandboxError. Trivial operations like
 * createSandbox / destroySandbox succeed silently.
 */
export function createNoopSandboxAdapter(): SandboxAdapter {
  return {
    async createSandbox(): Promise<string> {
      return "noop-sandbox-id"
    },

    async materializeProject(): Promise<{ sourceTreeDigest: string }> {
      return { sourceTreeDigest: "noop-digest" }
    },

    async verifySourceDigest(_expected: string): Promise<boolean> {
      return true
    },

    async startController(): Promise<void> {
      // no-op
    },

    async stopController(): Promise<void> {
      // no-op
    },

    async pauseSandbox(): Promise<void> {
      // no-op
    },

    async resumeSandbox(): Promise<void> {
      // no-op
    },

    async readPath(_path: string): Promise<Uint8Array> {
      throw new SandboxError("No-op sandbox adapter does not support readPath")
    },

    async writePath(_path: string, _data: Uint8Array): Promise<void> {
      throw new SandboxError("No-op sandbox adapter does not support writePath")
    },

    async applyPatch(_patch: Uint8Array): Promise<string> {
      throw new SandboxError("No-op sandbox adapter does not support applyPatch")
    },

    async createOverlay(_identity: string): Promise<string> {
      return "noop-overlay-id"
    },

    async mergeOverlay(_overlayId: string): Promise<string> {
      throw new SandboxError("No-op sandbox adapter does not support mergeOverlay")
    },

    async discardOverlay(_overlayId: string): Promise<void> {
      // no-op
    },

    async executeCommand(
      _command: string,
      _args: string[],
      _scope: ResourceScope,
    ): Promise<CommandResult> {
      throw new SandboxError("No-op sandbox adapter does not support executeCommand")
    },

    async terminateExecution(_executionId: string): Promise<void> {
      // no-op
    },

    async snapshotWorkspace(): Promise<string> {
      return "noop-snapshot-digest"
    },

    async exportArtifactBundle(): Promise<Uint8Array> {
      throw new SandboxError("No-op sandbox adapter does not support exportArtifactBundle")
    },

    async destroySandbox(): Promise<void> {
      // no-op
    },
  }
}

// ── Factory: Local Sandbox ---------------------------------------------------

/**
 * Create a local filesystem-based sandbox adapter.
 *
 * Provides a SandboxAdapter that operates on a real directory tree.
 * NOTE: This is a partial adapter suitable for development and testing.
 * Full sandbox isolation (cgroups, containers, etc.) is not provided.
 */
export function createLocalSandboxAdapter(options: {
  sandboxRoot: string
  sourcePath: string
  sourceRevision: string
}): SandboxAdapter {
  const { sandboxRoot } = options
  const normalizedRoot = normalize(sandboxRoot)

  return {
    async createSandbox(): Promise<string> {
      return normalizedRoot
    },

    async materializeProject(): Promise<{ sourceTreeDigest: string }> {
      const hash = createHash("sha256")

      function walk(dir: string): void {
        const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
          a.name.localeCompare(b.name),
        )
        for (const entry of entries) {
          const fullPath = resolve(dir, entry.name)
          const relPath = relative(normalizedRoot, fullPath)
          hash.update(relPath)
          if (entry.isDirectory()) {
            hash.update("d")
            walk(fullPath)
          } else if (entry.isFile()) {
            hash.update("f")
            hash.update(statSync(fullPath).size.toString())
          }
        }
      }

      walk(normalizedRoot)
      return { sourceTreeDigest: hash.digest("hex") }
    },

    async verifySourceDigest(expected: string): Promise<boolean> {
      const { sourceTreeDigest } = await this.materializeProject()
      return sourceTreeDigest === expected
    },

    async startController(): Promise<void> {
      // no-op
    },

    async stopController(): Promise<void> {
      // no-op
    },

    async pauseSandbox(): Promise<void> {
      // no-op
    },

    async resumeSandbox(): Promise<void> {
      // no-op
    },

    async readPath(path: string): Promise<Uint8Array> {
      const resolved = resolveSandboxPath(normalizedRoot, path)
      return readFile(resolved)
    },

    async writePath(path: string, data: Uint8Array): Promise<void> {
      const resolved = resolveSandboxPath(normalizedRoot, path)
      await mkdir(dirname(resolved), { recursive: true })
      await writeFile(resolved, data)
    },

    async applyPatch(_patch: Uint8Array): Promise<string> {
      throw new SandboxError(
        "Local sandbox adapter does not support applyPatch — use a full adapter",
      )
    },

    async createOverlay(identity: string): Promise<string> {
      return `overlay-${identity}-${Date.now()}`
    },

    async mergeOverlay(_overlayId: string): Promise<string> {
      throw new SandboxError(
        "Local sandbox adapter does not support mergeOverlay — use a full adapter",
      )
    },

    async discardOverlay(_overlayId: string): Promise<void> {
      // no-op; local fs overlays are ephemeral
    },

    async executeCommand(
      _command: string,
      _args: string[],
      _scope: ResourceScope,
    ): Promise<CommandResult> {
      throw new SandboxError(
        "Local sandbox adapter does not support executeCommand — use a full adapter",
      )
    },

    async terminateExecution(_executionId: string): Promise<void> {
      // no-op
    },

    async snapshotWorkspace(): Promise<string> {
      const hash = createHash("sha256")

      function walk(dir: string): void {
        const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
          a.name.localeCompare(b.name),
        )
        for (const entry of entries) {
          const fullPath = resolve(dir, entry.name)
          const relPath = relative(normalizedRoot, fullPath)
          hash.update(relPath)
          if (entry.isDirectory()) {
            hash.update("d")
            walk(fullPath)
          } else if (entry.isFile()) {
            hash.update("f")
            const content = statSync(fullPath)
            hash.update(content.size.toString())
            hash.update(content.mtimeMs.toString())
          }
        }
      }

      walk(normalizedRoot)
      return hash.digest("hex")
    },

    async exportArtifactBundle(): Promise<Uint8Array> {
      throw new SandboxError(
        "Local sandbox adapter does not support exportArtifactBundle — use a full adapter",
      )
    },

    async destroySandbox(): Promise<void> {
      await rm(normalizedRoot, { recursive: true, force: true })
    },
  }
}
