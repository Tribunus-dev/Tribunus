/**
 * DuckDB Diagnostics Logger
 *
 * Logs diagnostics snapshots, handshake history, and peer metrics to DuckDB
 * for historical analysis. Uses the existing DuckDB raw client from
 * @/storage/db.duckdb for database access.
 *
 * Tables are created on first use (lazy initialization).
 *
 * @module
 */

import type { DharmaReplicationDiagnostics } from "../protocol"
import type { DuckDBRawClient } from "@/storage/db.duckdb"

/** Convenience alias for the DuckDB raw client used by the runtime config. */
export type DuckDbClient = DuckDBRawClient

// ── Table Names ───────────────────────────────────────────

const DIAGNOSTICS_TABLE = "replication_diagnostics"
const HANDSHAKES_TABLE = "replication_handshakes"
const PEER_METRICS_TABLE = "replication_peer_metrics"

// ── DDL Statements ────────────────────────────────────────

const CREATE_DIAGNOSTICS_TABLE = `
  CREATE TABLE IF NOT EXISTS ${DIAGNOSTICS_TABLE} (
    federation_id VARCHAR NOT NULL,
    data JSON NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`

const CREATE_HANDSHAKES_TABLE = `
  CREATE TABLE IF NOT EXISTS ${HANDSHAKES_TABLE} (
    federation_id VARCHAR NOT NULL,
    peer_id VARCHAR NOT NULL,
    result VARCHAR NOT NULL,
    duration_ms DOUBLE NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`

const CREATE_PEER_METRICS_TABLE = `
  CREATE TABLE IF NOT EXISTS ${PEER_METRICS_TABLE} (
    federation_id VARCHAR NOT NULL,
    peer_id VARCHAR NOT NULL,
    metric VARCHAR NOT NULL,
    value DOUBLE NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`

// ── ReplicationDuckDbLogger ───────────────────────────────

export class ReplicationDuckDbLogger {
  private initialized = false

  constructor(private db: DuckDBRawClient) {}

  // ── Lazy init ───────────────────────────────────────────

  /**
   * Ensure tables exist. Safe to call multiple times — uses IF NOT EXISTS.
   */
  private async ensureTables(): Promise<void> {
    if (this.initialized) return
    await this.db.run(CREATE_DIAGNOSTICS_TABLE)
    await this.db.run(CREATE_HANDSHAKES_TABLE)
    await this.db.run(CREATE_PEER_METRICS_TABLE)
    this.initialized = true
  }

  // ── Diagnostics snapshots ───────────────────────────────

  /**
   * Log a diagnostics snapshot as a JSON blob.
   */
  async logDiagnostics(
    federationId: string,
    diag: DharmaReplicationDiagnostics,
  ): Promise<void> {
    await this.ensureTables()
    const data = JSON.stringify(diag)
    await this.db.run(
      `INSERT INTO ${DIAGNOSTICS_TABLE} (federation_id, data) VALUES ('${federationId.replace(/'/g, "''")}', '${data.replace(/'/g, "''")}')`,
    )
  }

  /**
   * Retrieve diagnostics history for a federation, most recent first.
   */
  async getDiagnosticsHistory(
    federationId: string,
    limit?: number,
  ): Promise<DharmaReplicationDiagnostics[]> {
    await this.ensureTables()
    const sql =
      limit !== undefined
        ? `SELECT data::VARCHAR AS data FROM ${DIAGNOSTICS_TABLE} WHERE federation_id = '${federationId.replace(/'/g, "''")}' ORDER BY recorded_at DESC LIMIT ${limit}`
        : `SELECT data::VARCHAR AS data FROM ${DIAGNOSTICS_TABLE} WHERE federation_id = '${federationId.replace(/'/g, "''")}' ORDER BY recorded_at DESC`
    const rows = await this.db.all<{ data: string }>(sql)
    return rows.map((r) => JSON.parse(r.data) as DharmaReplicationDiagnostics)
  }

  /**
   * Retrieve the latest diagnostics snapshot for a federation.
   */
  async getLatestDiagnostics(
    federationId: string,
  ): Promise<DharmaReplicationDiagnostics | null> {
    await this.ensureTables()
    const row = await this.db.get<{ data: string }>(
      `SELECT data::VARCHAR AS data FROM ${DIAGNOSTICS_TABLE} WHERE federation_id = '${federationId.replace(/'/g, "''")}' ORDER BY recorded_at DESC LIMIT 1`,
    )
    return row ? (JSON.parse(row.data) as DharmaReplicationDiagnostics) : null
  }

  // ── Handshake events ────────────────────────────────────

  /**
   * Log a handshake event.
   */
  async logHandshake(
    federationId: string,
    peerId: string,
    result: string,
    durationMs: number,
  ): Promise<void> {
    await this.ensureTables()
    await this.db.run(
      `INSERT INTO ${HANDSHAKES_TABLE} (federation_id, peer_id, result, duration_ms) VALUES ('${federationId.replace(/'/g, "''")}', '${peerId.replace(/'/g, "''")}', '${result.replace(/'/g, "''")}', ${durationMs})`,
    )
  }

  /**
   * Retrieve aggregate handshake stats for a federation.
   */
  async getHandshakeStats(
    federationId: string,
  ): Promise<{ total: number; succeeded: number; failed: number; avgDurationMs: number }> {
    await this.ensureTables()
    const row = await this.db.get<{
      total: number
      succeeded: number | string
      failed: number | string
      avgDurationMs: number | null
    }>(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END) AS failed,
        AVG(duration_ms) AS avgDurationMs
      FROM ${HANDSHAKES_TABLE}
      WHERE federation_id = '${federationId.replace(/'/g, "''")}'`,
    )
    return {
      total: Number(row?.total ?? 0),
      succeeded: Number(row?.succeeded ?? 0),
      failed: Number(row?.failed ?? 0),
      avgDurationMs: row?.avgDurationMs ?? 0,
    }
  }

  // ── Peer metrics ────────────────────────────────────────

  /**
   * Log a peer metric sample.
   */
  async logPeerMetric(
    federationId: string,
    peerId: string,
    metric: string,
    value: number,
  ): Promise<void> {
    await this.ensureTables()
    await this.db.run(
      `INSERT INTO ${PEER_METRICS_TABLE} (federation_id, peer_id, metric, value) VALUES ('${federationId.replace(/'/g, "''")}', '${peerId.replace(/'/g, "''")}', '${metric.replace(/'/g, "''")}', ${value})`,
    )
  }

  /**
   * Retrieve metric history for a peer+metric combination, most recent first.
   */
  async getPeerMetricHistory(
    federationId: string,
    peerId: string,
    metric: string,
    limit?: number,
  ): Promise<{ timestamp: string; value: number }[]> {
    await this.ensureTables()
    const sql =
      limit !== undefined
        ? `SELECT recorded_at AS timestamp, value FROM ${PEER_METRICS_TABLE} WHERE federation_id = '${federationId.replace(/'/g, "''")}' AND peer_id = '${peerId.replace(/'/g, "''")}' AND metric = '${metric.replace(/'/g, "''")}' ORDER BY recorded_at DESC LIMIT ${limit}`
        : `SELECT recorded_at AS timestamp, value FROM ${PEER_METRICS_TABLE} WHERE federation_id = '${federationId.replace(/'/g, "''")}' AND peer_id = '${peerId.replace(/'/g, "''")}' AND metric = '${metric.replace(/'/g, "''")}' ORDER BY recorded_at DESC`
    return this.db.all<{ timestamp: string; value: number }>(sql)
  }

  // ── Maintenance ─────────────────────────────────────────

  /**
   * Prune rows older than the given age from all three tables.
   * Returns total number of deleted rows.
   */
  async pruneOlderThan(ageMs: number): Promise<number> {
    await this.ensureTables()
    const cutoff = new Date(Date.now() - ageMs).toISOString()
    let total = 0

    for (const table of [DIAGNOSTICS_TABLE, HANDSHAKES_TABLE, PEER_METRICS_TABLE]) {
      // Count rows to delete
      const before = await this.db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM ${table} WHERE recorded_at < '${cutoff}'`,
      )
      const count = before?.cnt ?? 0
      if (count > 0) {
      await this.db.run(
        `DELETE FROM ${table} WHERE recorded_at < '${cutoff}'`,
      )
      }
      total += count
    }

    return total
  }
}
