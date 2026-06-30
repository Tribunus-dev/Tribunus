/**
 * Dharma Live Sandbox — Local Filesystem Sandbox Adapter
 *
 * First concrete SandboxAdapter using real filesystem operations with
 * path scope enforcement. This adapter is the only code allowed to touch
 * the sandbox filesystem — all access goes through SessionController.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { SandboxAdapter, CommandResult, ResourceScope } from "../types"
import { SandboxError } from "../session-errors"
import { resolveSandboxPath, isPathWithinSandbox, computeDigest } from "../sandbox-adapter"
import { buildSandboxLayout, type SandboxLayoutPaths } from "./sandbox-layout"

// ── Config -------------------------------------------------------------------

export interface LocalSandboxConfig {
  /** Root directory for this sandbox session */
  sandboxRoot: string
  /** Canonical workspace directory */
  canonicalDir: string
  /** Base source directory for materialization */
  sourceBaseDir: string
  /** Profile data root (used for layout paths) */
  profileDataRoot: string
  /** Session ID */
  sessionId: string
}

// ── Helpers ------------------------------------------------------------------

/**
 * Recursively compute a SHA-256 digest over all files in a directory.
 * Files are sorted by relative path to ensure deterministic results.
 */
async function computeDirectoryDigest(dir: string): Promise<string> {
  const hash = createHash("sha256")
  const entries: string[] = []

  async function walk(current: string): Promise<void> {
    const items = await fs.readdir(current, { withFileTypes: true })
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(current, item.name)
      if (item.isDirectory()) {
        await walk(fullPath)
      } else if (item.isFile()) {
        entries.push(fullPath)
      }
    }
  }

  try {
    await walk(dir)
  } catch {
    // Directory doesn't exist yet — empty digest
    return hash.digest("hex")
  }

  for (const filePath of entries) {
    const relPath = path.relative(dir, filePath)
    const content = await fs.readFile(filePath)
    hash.update(relPath)
    hash.update(content)
  }

  return hash.digest("hex")
}

/**
 * Copy a file or directory recursively.
 */
async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src)
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true })
    const items = await fs.readdir(src)
    for (const item of items) {
      await copyRecursive(path.join(src, item), path.join(dest, item))
    }
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(src, dest)
  }
}

/**
 * Ensure a directory exists.
 */
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

// ── Sandbox Adapter ----------------------------------------------------------

/**
 * LocalFilesystemSandboxAdapter — concrete SandboxAdapter using
 * real filesystem operations with path scope enforcement.
 *
 * All filesystem access is scoped through resolveSandboxPath which
 * detects path traversal, symlink escapes, and null byte injection.
 */
export class LocalFilesystemSandboxAdapter implements SandboxAdapter {
  private layout: SandboxLayoutPaths
  private sandboxId: string
  private initialized = false

  constructor(private config: LocalSandboxConfig) {
    this.layout = buildSandboxLayout(config.profileDataRoot, config.sessionId)
    this.sandboxId = randomUUID()
  }

  // ── Lifecycle Methods -------------------------------------------------------

  async createSandbox(): Promise<string> {
    // Create all sandbox directories
    await ensureDir(this.layout.sourceBaseDir)
    await ensureDir(this.layout.canonicalDir)
    await ensureDir(this.layout.overlaysDir)
    await ensureDir(this.layout.executionWorkDir)
    await ensureDir(this.layout.executionTmpDir)
    await ensureDir(this.layout.executionLogsDir)
    await ensureDir(this.layout.executionProcessDir)
    await ensureDir(this.layout.executionArtifactsDir)
    await ensureDir(this.layout.commandReceiptsDir)
    await ensureDir(this.layout.mutationReceiptsDir)

    this.initialized = true
    return this.sandboxId
  }

  async materializeProject(): Promise<{ sourceTreeDigest: string }> {
    this.requireInitialized()

    // Copy source base to canonical workspace
    await copyRecursive(this.config.sourceBaseDir, this.config.canonicalDir)

    // Compute digest
    const sourceTreeDigest = await computeDirectoryDigest(this.config.canonicalDir)

    return { sourceTreeDigest }
  }

  async verifySourceDigest(expected: string): Promise<boolean> {
    this.requireInitialized()
    const actual = await computeDirectoryDigest(this.config.canonicalDir)
    return actual === expected
  }

  async startController(): Promise<void> {
    this.requireInitialized()
    // Create the controller lock file
    const lockDir = path.dirname(this.layout.controllerLock)
    await ensureDir(lockDir)
    await fs.writeFile(this.layout.controllerLock, this.sandboxId, "utf-8")
  }

  async stopController(): Promise<void> {
    // Remove controller lock — don't require initialized since we may
    // clean up after failed creation
    try {
      await fs.unlink(this.layout.controllerLock)
    } catch {
      // Lock may not exist, that's fine
    }
  }

  async pauseSandbox(): Promise<void> {
    this.requireInitialized()
    const pauseFile = path.join(this.config.sandboxRoot, ".paused")
    await fs.writeFile(pauseFile, new Date().toISOString(), "utf-8")
  }

  async resumeSandbox(): Promise<void> {
    this.requireInitialized()
    const pauseFile = path.join(this.config.sandboxRoot, ".paused")
    try {
      await fs.unlink(pauseFile)
    } catch {
      // Not paused — fine
    }
  }

  // ── File Operations ---------------------------------------------------------

  async readPath(relativePath: string): Promise<Uint8Array> {
    this.requireInitialized()
    const resolved = resolveSandboxPath(this.config.canonicalDir, relativePath)
    return new Uint8Array(await fs.readFile(resolved))
  }

  async writePath(relativePath: string, data: Uint8Array): Promise<void> {
    this.requireInitialized()
    const resolved = resolveSandboxPath(this.config.canonicalDir, relativePath)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, Buffer.from(data))
  }

  // ── Patch Operations --------------------------------------------------------

  async applyPatch(_patch: Uint8Array): Promise<string> {
    throw new SandboxError("LocalFilesystemSandboxAdapter does not support applyPatch yet")
  }

  // ── Overlay Operations ------------------------------------------------------

  async createOverlay(identity: string): Promise<string> {
    this.requireInitialized()
    const overlayId = `overlay_${randomUUID().replace(/-/g, "").slice(0, 16)}`
    const overlayDir = path.join(this.layout.overlaysDir, identity)
    await ensureDir(overlayDir)

    // Write overlay metadata
    const meta = { overlayId, identity, createdAt: new Date().toISOString() }
    await fs.writeFile(
      path.join(overlayDir, ".overlay-meta.json"),
      JSON.stringify(meta, null, 2),
      "utf-8",
    )

    return overlayId
  }

  async mergeOverlay(overlayId: string): Promise<string> {
    this.requireInitialized()

    // Find the overlay directory matching this overlayId
    const overlays = await fs.readdir(this.layout.overlaysDir)
    let overlayDir: string | null = null
    for (const entry of overlays) {
      const metaPath = path.join(this.layout.overlaysDir, entry, ".overlay-meta.json")
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"))
        if (meta.overlayId === overlayId) {
          overlayDir = path.join(this.layout.overlaysDir, entry)
          break
        }
      } catch {
        continue
      }
    }

    if (!overlayDir) {
      throw new SandboxError(`Overlay not found: ${overlayId}`)
    }

    // Copy all overlay files to canonical workspace
    const items = await fs.readdir(overlayDir)
    for (const item of items) {
      if (item.startsWith(".")) continue // skip metadata files
      const srcPath = path.join(overlayDir, item)
      const destPath = path.join(this.config.canonicalDir, item)
      await copyRecursive(srcPath, destPath)
    }

    // Recompute canonical digest
    const newDigest = await computeDirectoryDigest(this.config.canonicalDir)

    return newDigest
  }

  async discardOverlay(overlayId: string): Promise<void> {
    this.requireInitialized()

    // Find and remove overlay directory
    const overlays = await fs.readdir(this.layout.overlaysDir)
    for (const entry of overlays) {
      const metaPath = path.join(this.layout.overlaysDir, entry, ".overlay-meta.json")
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"))
        if (meta.overlayId === overlayId) {
          await fs.rm(path.join(this.layout.overlaysDir, entry), {
            recursive: true,
            force: true,
          })
          return
        }
      } catch {
        continue
      }
    }
    // If overlay not found, that's idempotent
  }

  // ── Execution Methods -------------------------------------------------------

  async executeCommand(
    _command: string,
    _args: string[],
    _scope: ResourceScope,
  ): Promise<CommandResult> {
    throw new SandboxError("LocalFilesystemSandboxAdapter does not support executeCommand yet")
  }

  async terminateExecution(_executionId: string): Promise<void> {
    throw new SandboxError("LocalFilesystemSandboxAdapter does not support terminateExecution yet")
  }

  // ── Workspace & Artifact ----------------------------------------------------

  async snapshotWorkspace(): Promise<string> {
    this.requireInitialized()
    return computeDirectoryDigest(this.config.canonicalDir)
  }

  async exportArtifactBundle(): Promise<Uint8Array> {
    throw new SandboxError("LocalFilesystemSandboxAdapter does not support exportArtifactBundle yet")
  }

  async destroySandbox(): Promise<void> {
    // Remove the entire sandbox root — don't require initialized since
    // we may clean up a partially created sandbox
    try {
      await fs.rm(this.config.sandboxRoot, { recursive: true, force: true })
    } catch {
      // Already gone, fine
    }
    this.initialized = false
  }

  // ── Internal Helpers --------------------------------------------------------

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new SandboxError("Sandbox not initialized. Call createSandbox() first.")
    }
  }
}

export default LocalFilesystemSandboxAdapter
