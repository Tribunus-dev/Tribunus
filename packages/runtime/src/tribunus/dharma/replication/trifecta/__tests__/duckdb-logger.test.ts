/**
 * DuckDB Diagnostics Logger — Tests
 *
 * Covers diagnostics snapshots (log + retrieve), handshake logging and stats,
 * peer metrics history, and data pruning.
 *
 * Uses a temporary DuckDB file to avoid interfering with any configured
 * DuckDB pipeline. A test-local read-write client is created via spawning
 * the duckdb CLI directly (the production client from @/storage/db.duckdb
 * enforces -readonly, which would reject DDL/INSERT).
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

import type { DuckDBRawClient } from "@/storage/db.duckdb"
import type { DharmaReplicationDiagnostics } from "../../protocol"
import { ReplicationDuckDbLogger } from "../duckdb-logger"

// ── Helpers ───────────────────────────────────────────────

/**
 * Create a DuckDB read-write client for testing.
 * Spawns `duckdb` CLI without -readonly so DDL + DML work.
 */
function createTestClient(dbPath: string): DuckDBRawClient {
  const all: DuckDBRawClient["all"] = async <T>(sql: string) => {
    const proc = spawnSync("duckdb", [dbPath, "-json", "-c", sql], {
      encoding: "utf-8",
      timeout: 15_000,
    })
    if (proc.status !== 0 || proc.error) {
      throw new Error(
        `DuckDB query failed (exit ${proc.status}): ${proc.stderr ?? proc.error?.message}`,
      )
    }
    return JSON.parse(proc.stdout.trim()) as T[]
  }

  return {
    all,

    get: async <T>(sql: string) => {
      const rows = await all<T>(sql)
      return rows[0] ?? undefined
    },

    run: async (sql: string) => {
      // For DDL/DML we don't need JSON output — -c alone is sufficient
      const proc = spawnSync("duckdb", [dbPath, "-c", sql], {
        encoding: "utf-8",
        timeout: 15_000,
      })
      if (proc.status !== 0 || proc.error) {
        throw new Error(
          `DuckDB exec failed (exit ${proc.status}): ${proc.stderr ?? proc.error?.message}`,
        )
      }
    },

    close: async () => {
      // Nothing to close for CLI-based client
    },
  }
}

// ── Fixtures ──────────────────────────────────────────────

const FED_ID = "test-fed-001"
const PEER_A = "peer-alpha"
const PEER_B = "peer-beta"

function sampleDiag(overrides?: Partial<DharmaReplicationDiagnostics>): DharmaReplicationDiagnostics {
  return {
    federationId: FED_ID,
    lifecycleState: "connected",
    swarmJoined: true,
    activePeerCount: 3,
    successfulHandshakes: 5,
    failedHandshakes: 1,
    writerCount: 2,
    autobaseLength: 100,
    autobaseSignedLength: 80,
    importerProvisionalCursor: 75,
    importerFinalizedCursor: 70,
    pendingOutboxCount: 2,
    pendingDependencyCount: 0,
    quarantineCount: 0,
    lastSuccessfulReplicationAt: new Date().toISOString(),
    lastError: null,
    ...overrides,
  }
}

// ── Test Suite ────────────────────────────────────────────

describe("ReplicationDuckDbLogger", () => {
  let dbPath: string
  let client: DuckDBRawClient
  let logger: ReplicationDuckDbLogger

  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), "tribunus-duckdb-logger-test-"))
    dbPath = join(tmp, "test.db")
    client = createTestClient(dbPath)
    logger = new ReplicationDuckDbLogger(client)
  })

  afterAll(() => {
    try {
      unlinkSync(dbPath)
    } catch {
      // temp file may already be gone
    }
  })

  // ── Diagnostics snapshots ───────────────────────────────

  it("logs and retrieves diagnostics snapshots", async () => {
    const diag1 = sampleDiag({ activePeerCount: 3 })
    const diag2 = sampleDiag({ activePeerCount: 5 })

    await logger.logDiagnostics(FED_ID, diag1)
    await logger.logDiagnostics(FED_ID, diag2)

    const history = await logger.getDiagnosticsHistory(FED_ID)
    expect(history.length).toBeGreaterThanOrEqual(2)
    // Most recent first
    expect(history[0].activePeerCount).toBe(5)
    expect(history[1].activePeerCount).toBe(3)
  })

  it("returns empty history for unknown federation", async () => {
    const history = await logger.getDiagnosticsHistory("nonexistent")
    expect(history).toEqual([])
  })

  it("limits diagnostics history when limit is specified", async () => {
    // Log a third entry
    await logger.logDiagnostics(FED_ID, sampleDiag({ activePeerCount: 7 }))

    const limited = await logger.getDiagnosticsHistory(FED_ID, 2)
    expect(limited).toHaveLength(2)
  })

  it("returns latest diagnostics snapshot", async () => {
    const latest = await logger.getLatestDiagnostics(FED_ID)
    expect(latest).not.toBeNull()
    expect(latest!.federationId).toBe(FED_ID)
    expect(latest!.activePeerCount).toBeGreaterThanOrEqual(3)
  })

  it("returns null for latest diagnostics on unknown federation", async () => {
    const latest = await logger.getLatestDiagnostics("missing-fed")
    expect(latest).toBeNull()
  })

  // ── Handshake events ────────────────────────────────────

  it("logs handshake events and aggregates stats", async () => {
    await logger.logHandshake(FED_ID, PEER_A, "success", 120)
    await logger.logHandshake(FED_ID, PEER_A, "success", 80)
    await logger.logHandshake(FED_ID, PEER_B, "failed", 200)
    await logger.logHandshake(FED_ID, PEER_B, "success", 150)
    await logger.logHandshake(FED_ID, PEER_A, "success", 100)

    const stats = await logger.getHandshakeStats(FED_ID)
    expect(stats.total).toBe(5)
    expect(stats.succeeded).toBe(4)
    expect(stats.failed).toBe(1)
    // Average = (120 + 80 + 200 + 150 + 100) / 5 = 650 / 5 = 130
    expect(stats.avgDurationMs).toBeCloseTo(130, 0)
  })

  it("returns zero stats for federation with no handshakes", async () => {
    const stats = await logger.getHandshakeStats("empty-fed")
    expect(stats).toEqual({ total: 0, succeeded: 0, failed: 0, avgDurationMs: 0 })
  })

  // ── Peer metrics ────────────────────────────────────────

  it("logs peer metrics and retrieves history", async () => {
    await logger.logPeerMetric(FED_ID, PEER_A, "latency_ms", 42)
    await logger.logPeerMetric(FED_ID, PEER_A, "latency_ms", 38)
    await logger.logPeerMetric(FED_ID, PEER_A, "throughput", 1024)

    const latencyHistory = await logger.getPeerMetricHistory(
      FED_ID,
      PEER_A,
      "latency_ms",
    )
    expect(latencyHistory.length).toBeGreaterThanOrEqual(2)
    // Most recent first
    expect(latencyHistory[0].value).toBe(38)
    expect(latencyHistory[1].value).toBe(42)
  })

  it("limits peer metric history when limit is specified", async () => {
    await logger.logPeerMetric(FED_ID, PEER_A, "latency_ms", 50)

    const limited = await logger.getPeerMetricHistory(
      FED_ID,
      PEER_A,
      "latency_ms",
      2,
    )
    expect(limited).toHaveLength(2)
  })

  it("filters peer metrics by federation, peer, and metric", async () => {
    const otherFed = "other-fed"
    await logger.logPeerMetric(otherFed, PEER_A, "latency_ms", 999)

    // Should not include cross-fed records
    const history = await logger.getPeerMetricHistory(
      otherFed,
      PEER_A,
      "latency_ms",
    )
    expect(history).toHaveLength(1)
    expect(history[0].value).toBe(999)
  })

  it("returns empty array when no metrics match", async () => {
    const history = await logger.getPeerMetricHistory(
      FED_ID,
      "unknown-peer",
      "latency_ms",
    )
    expect(history).toEqual([])
  })

  // ── Pruning ─────────────────────────────────────────────

  it("prunes rows older than the given age", async () => {
    // Add a handshake with a deliberately old timestamp by setting
    // recorded_at directly via SQL (we know the table schema)
    const oldFed = "prune-test-fed"
    const oldTs = new Date(Date.now() - 86_400_000).toISOString() // 1 day ago

    // Sanity: add recent data
    await logger.logHandshake(oldFed, "p1", "success", 100)
    await logger.logDiagnostics(oldFed, sampleDiag({ federationId: oldFed }))

    // Now reach in and add an old row directly
    await client.run(
      `INSERT INTO replication_handshakes (federation_id, peer_id, result, duration_ms, recorded_at)
       VALUES ('${oldFed}', 'p-old', 'failed', 999, '${oldTs}')`,
    )
    await client.run(
      `INSERT INTO replication_diagnostics (federation_id, data, recorded_at)
       VALUES ('${oldFed}', '{"old":true}', '${oldTs}')`,
    )

    // Prune rows older than 1 hour — should catch the old ones but not recent
    const deleted = await logger.pruneOlderThan(3_600_000) // 1 hour
    expect(deleted).toBeGreaterThanOrEqual(2)
  })

  it("returns 0 when no rows are old enough to prune", async () => {
    const freshFed = "fresh-fed"
    await logger.logHandshake(freshFed, "p1", "success", 50)

    const deleted = await logger.pruneOlderThan(86_400_000) // 24 hours — nothing that old
    expect(deleted).toBe(0)
  })
})
