/**
 * Qualification test for the coordination projection service, preload methods,
 * and dedicated IPC contract.
 */
import { describe, it, expect } from "bun:test"
import { QualificationHarness } from "./stdio-harness"
import { join, resolve } from "node:path"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

const DESKTOP_DIR = resolve(import.meta.dir, "..")
const MAIN_ENTRY = join(DESKTOP_DIR, "out", "main", "index.js")
const REPO_ROOT = resolve(DESKTOP_DIR, "..", "..")
const ELECTRON_PATH = join(
  REPO_ROOT, "node_modules", ".bun", "electron@41.2.1",
  "node_modules", "electron", "dist",
  "Electron.app", "Contents", "MacOS", "Electron",
)

const buildExists = existsSync(MAIN_ENTRY)
const itIfBuilt = buildExists ? it : it.skip

describe("PROJECTION-AUTHORITY-BINDING-0001: Coordination Projection", () => {
  itIfBuilt("queries coordination snapshot and triggers resync via dedicated channels", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tribunus-coordination-"))
    const harness = new QualificationHarness(tempDir, ELECTRON_PATH, MAIN_ENTRY)
    await harness.waitForReady(30_000)
    await harness.waitForWindow(45_000)

    // Test 1: Query coordination snapshot
    const coordSnapshot = await harness.invokeApi("getCoordinationSnapshot", [])
    console.log("[coordination-test] getCoordinationSnapshot:", coordSnapshot)
    expect(coordSnapshot.ok).toBe(true)
    expect(coordSnapshot.result).toHaveProperty("value")
    const snap = (coordSnapshot.result as { value: Record<string, unknown> }).value
    expect(snap.revision).toBeDefined()
    expect(snap.backendMode).toBeDefined()

    // Test 2: Trigger coordination resync (fire-and-forget send handler)
    const resyncResult = await harness.invokeApi("requestCoordinationResync", [])
    console.log("[coordination-test] requestCoordinationResync:", resyncResult)
    expect(resyncResult.ok).toBe(true)

    await harness.quit()
  }, 90_000)
})
