/**
 * Checkpoint Recovery Tests
 *
 * Tests recovery logic: no-checkpoint path, recovery from valid checkpoint,
 * recovery on error, isRecoveryNeeded checks, and getRecoverySummary output.
 */

import { describe, test, expect } from "bun:test"
import {
  recoverFromCheckpoint,
  isRecoveryNeeded,
  getRecoverySummary,
} from "../checkpoint-recovery"
import type { CheckpointRecoveryResult } from "../checkpoint-recovery"

// ── Mock FederationBase -------------------------------------------------------

/**
 * A minimal stub that implements only the FederationBase surface
 * recoverFromCheckpoint depends on: `getCheckpoint()`.
 */
class MockFederationBase {
  private checkpoint: {
    signedLength: number
    viewRootHash: string
    federationId: string
    createdAt: string
  } | null
  private shouldThrow: boolean

  constructor(opts: {
    checkpoint?: {
      signedLength: number
      viewRootHash: string
      federationId: string
      createdAt: string
    } | null
    throwOnGet?: boolean
  }) {
    this.checkpoint = opts.checkpoint ?? null
    this.shouldThrow = opts.throwOnGet ?? false
  }

  async getCheckpoint(): Promise<{
    signedLength: number
    viewRootHash: string
    federationId: string
    createdAt: string
  } | null> {
    if (this.shouldThrow) {
      throw new Error("Checkpoint core unavailable")
    }
    return this.checkpoint
  }
}

// ── Tests ---------------------------------------------------------------------

describe("recoverFromCheckpoint", () => {
  test("returns result with checkpointExists=false when no checkpoint exists", async () => {
    const fb = new MockFederationBase({ checkpoint: null })
    const result = await recoverFromCheckpoint(fb as any)

    expect(result.checkpointExists).toBe(false)
    expect(result.recovered).toBe(false)
    expect(result.lastOrderIndex).toBe(0)
    expect(result.error).toBeNull()
    expect(result.recoveredAt).toBeTruthy()
  })

  test("returns recovered=true and lastOrderIndex from valid checkpoint", async () => {
    const checkpoint = {
      signedLength: 42,
      viewRootHash: "view:fed-1:len=84",
      federationId: "fed-1",
      createdAt: "2026-06-30T12:00:00.000Z",
    }
    const fb = new MockFederationBase({ checkpoint })
    const result = await recoverFromCheckpoint(fb as any)

    expect(result.checkpointExists).toBe(true)
    expect(result.recovered).toBe(true)
    expect(result.lastOrderIndex).toBe(42)
    expect(result.error).toBeNull()
  })

  test("returns error result when getCheckpoint throws", async () => {
    const fb = new MockFederationBase({ throwOnGet: true })
    const result = await recoverFromCheckpoint(fb as any)

    expect(result.checkpointExists).toBe(false)
    expect(result.recovered).toBe(false)
    expect(result.lastOrderIndex).toBe(0)
    expect(result.error).toBe("Checkpoint core unavailable")
  })
})

describe("isRecoveryNeeded", () => {
  test("returns true when checkpoint exists, recovered, and lastOrderIndex > 0", () => {
    const result: CheckpointRecoveryResult = {
      checkpointExists: true,
      recovered: true,
      lastOrderIndex: 15,
      recoveredAt: new Date().toISOString(),
      error: null,
    }
    expect(isRecoveryNeeded(result)).toBe(true)
  })

  test("returns false when checkpoint does not exist", () => {
    const result: CheckpointRecoveryResult = {
      checkpointExists: false,
      recovered: false,
      lastOrderIndex: 0,
      recoveredAt: new Date().toISOString(),
      error: null,
    }
    expect(isRecoveryNeeded(result)).toBe(false)
  })

  test("returns false when recovered is false despite checkpoint existing", () => {
    const result: CheckpointRecoveryResult = {
      checkpointExists: true,
      recovered: false,
      lastOrderIndex: 0,
      recoveredAt: new Date().toISOString(),
      error: null,
    }
    expect(isRecoveryNeeded(result)).toBe(false)
  })

  test("returns false when lastOrderIndex is 0", () => {
    const result: CheckpointRecoveryResult = {
      checkpointExists: true,
      recovered: true,
      lastOrderIndex: 0,
      recoveredAt: new Date().toISOString(),
      error: null,
    }
    expect(isRecoveryNeeded(result)).toBe(false)
  })
})

describe("getRecoverySummary", () => {
  test("describes no checkpoint found", () => {
    const result: CheckpointRecoveryResult = {
      checkpointExists: false,
      recovered: false,
      lastOrderIndex: 0,
      recoveredAt: new Date().toISOString(),
      error: null,
    }
    expect(getRecoverySummary(result)).toBe("No checkpoint found — starting from scratch")
  })

  test("describes successful recovery", () => {
    const result: CheckpointRecoveryResult = {
      checkpointExists: true,
      recovered: true,
      lastOrderIndex: 99,
      recoveredAt: "2026-07-01T00:00:00.000Z",
      error: null,
    }
    const summary = getRecoverySummary(result)
    expect(summary).toContain("Recovered from checkpoint at order index 99")
    expect(summary).toContain("2026-07-01T00:00:00.000Z")
  })

  test("describes recovery error", () => {
    const result: CheckpointRecoveryResult = {
      checkpointExists: false,
      recovered: false,
      lastOrderIndex: 0,
      recoveredAt: new Date().toISOString(),
      error: "Disk I/O error",
    }
    expect(getRecoverySummary(result)).toBe("Checkpoint recovery failed: Disk I/O error")
  })
})
