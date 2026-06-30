/**
 * Dharma Live Sandbox — Artifact Bundle
 *
 * Session artifact export.
 * Creates tar-like bundles of session artifacts for export,
 * verifies bundle integrity, and manages disclosure scoping.
 */

import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
const BUNDLE_HEADER = Buffer.from("TRIBUNUS_ARTIFACT_V1\n", "utf-8")

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Append a length-prefixed entry to a bundle buffer.
 * Format: [4-byte name length (BE)][name][8-byte content length (BE)][content]
 */
function appendEntry(
  buffers: Buffer[],
  entryName: string,
  content: Buffer,
): void {
  const nameBuf = Buffer.from(entryName, "utf-8")
  const nameLen = Buffer.alloc(4)
  nameLen.writeUInt32BE(nameBuf.byteLength, 0)

  const contentLen = Buffer.alloc(8)
  contentLen.writeBigUInt64BE(BigInt(content.byteLength), 0)

  buffers.push(nameLen, nameBuf, contentLen, content)
}

/**
 * Parse a single entry from a bundle buffer at the given offset.
 * Returns the entry name, content, and the next offset.
 */
function readEntry(
  bundle: Buffer,
  offset: number,
): { name: string; content: Buffer; nextOffset: number } | null {
  if (offset + 12 > bundle.byteLength) return null

  const nameLen = bundle.readUInt32BE(offset)
  offset += 4

  if (offset + nameLen > bundle.byteLength) return null
  const name = bundle.subarray(offset, offset + nameLen).toString("utf-8")
  offset += nameLen

  if (offset + 8 > bundle.byteLength) return null
  const contentLen = Number(bundle.readBigUInt64BE(offset))
  offset += 8

  if (offset + contentLen > bundle.byteLength) return null
  const content = bundle.subarray(offset, offset + contentLen)
  offset += contentLen

  return { name, content, nextOffset: offset }
}

// ── Bundle Creation ────────────────────────────────────────────────────────

/**
 * Create a tar-like bundle of session artifacts.
 *
 * Format:
 *   - 20-byte header: "TRIBUNUS_ARTIFACT_V1\n"
 *   - 32-byte content digest (SHA-256 of entry payload, filled after writing)
 *   - Series of entries: [4B name_len][name][8B content_len][content]
 *   - 4-byte terminator: 0x00000000
 */
export async function createArtifactBundle(
  sessionRoot: string,
  exportPaths: string[],
): Promise<Uint8Array> {
  const buffers: Buffer[] = []
  const entries: { name: string; content: Buffer }[] = []

  for (const exportPath of exportPaths) {
    // Resolve relative to session root, prevent path escape
    const fullPath = path.resolve(sessionRoot, exportPath)
    if (!fullPath.startsWith(path.resolve(sessionRoot))) {
      throw new Error(`Path escape detected: "${exportPath}"`)
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(fullPath)
    } catch {
      // Skip missing files
      continue
    }

    if (stat.isDirectory()) {
      // Recursively collect directory contents
      const dirEntries = await collectDirectoryEntries(fullPath, sessionRoot)
      for (const [relPath, content] of dirEntries) {
        const entryBuf = Buffer.from(content)
        entries.push({ name: relPath, content: entryBuf })
      }
    } else if (stat.isFile()) {
      const content = await fs.readFile(fullPath)
      const entryBuf = Buffer.from(content)
      entries.push({ name: exportPath, content: entryBuf })
    }
  }

  // Assemble bundle
  // Header
  buffers.push(Buffer.from(BUNDLE_HEADER))

  // Placeholder for content digest (filled below)
  const digestPlaceholder = Buffer.alloc(32)
  buffers.push(digestPlaceholder)

  // Entries
  for (const entry of entries) {
    appendEntry(buffers, entry.name, entry.content)
  }

  // Terminator
  const terminator = Buffer.alloc(4)
  terminator.writeUInt32BE(0, 0)
  buffers.push(terminator)

  // Compute content digest over entries only
  const digestHash = createHash("sha256")
  for (const entry of entries) {
    digestHash.update(entry.name)
    digestHash.update(entry.content)
  }
  const digest = digestHash.digest()

  // Write digest into placeholder
  digest.copy(digestPlaceholder, 0, 0, 32)

  return Buffer.concat(buffers)
}

async function collectDirectoryEntries(
  dirPath: string,
  sessionRoot: string,
): Promise<[string, Uint8Array][]> {
  const entries: [string, Uint8Array][] = []
  async function walk(currentPath: string) {
    const dirEntries = await fs.readdir(currentPath, { withFileTypes: true })
    for (const entry of dirEntries) {
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const relPath = path.relative(sessionRoot, fullPath)
        const content = await fs.readFile(fullPath)
        entries.push([relPath, content])
      }
    }
  }
  await walk(dirPath)
  return entries
}

// ── Export Path Filtering ──────────────────────────────────────────────────

/**
 * Get allowed export paths based on disclosure policy.
 * Filters a disclosure scope list against the actual session root contents.
 */
export async function getAllowedExportPaths(
  sessionRoot: string,
  disclosureScope: string[],
): Promise<string[]> {
  const allowed: string[] = []

  for (const scopePath of disclosureScope) {
    const fullPath = path.resolve(sessionRoot, scopePath)

    // Path escape check
    if (!fullPath.startsWith(path.resolve(sessionRoot))) continue

    try {
      const stat = await fs.stat(fullPath)
      if (stat.isFile()) {
        allowed.push(scopePath)
      } else if (stat.isDirectory()) {
        // Include the directory itself and its contents
        const dirEntries = await collectDirectoryEntries(fullPath, sessionRoot)
        allowed.push(scopePath)
        allowed.push(...dirEntries.map(([relPath]) => relPath))
      }
    } catch {
      // Path doesn't exist, skip
    }
  }

  return allowed
}

// ── Integrity Verification ─────────────────────────────────────────────────

/**
 * Verify artifact bundle integrity by checking the embedded digest.
 */
export function verifyBundleIntegrity(bundle: Uint8Array): boolean {
  const buf = Buffer.from(bundle)

  // Check header
  if (buf.byteLength < BUNDLE_HEADER.byteLength + 32) return false
  const header = buf.subarray(0, BUNDLE_HEADER.byteLength)
  if (!header.equals(BUNDLE_HEADER)) return false

  // Read stored digest
  const storedDigest = buf.subarray(
    BUNDLE_HEADER.byteLength,
    BUNDLE_HEADER.byteLength + 32,
  )

  // Parse entries and recompute digest
  let offset = BUNDLE_HEADER.byteLength + 32
  const digestHash = createHash("sha256")

  while (offset < buf.byteLength) {
    const entry = readEntry(buf, offset)
    if (entry === null) break

    digestHash.update(entry.name)
    digestHash.update(entry.content)

    offset = entry.nextOffset
  }

  const computedDigest = digestHash.digest()
  return storedDigest.equals(computedDigest)
}
