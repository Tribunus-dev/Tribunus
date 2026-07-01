/**
 * Dharma Replication — Trifecta Adapter Factory
 *
 * Creates and wires the PGlite, Valkey, and DuckDB adapters from a
 * RuntimeConfig.  Each adapter is optional — returns null when the
 * corresponding client/config was not supplied.
 *
 * Consumers:
 *   - DharmaReplicationRuntime uses these adapters alongside the
 *     Hypercore-based FederationStore for hybrid storage.
 *   - runtime-init.ts wires them into the initialization sequence.
 */

import type { RuntimeConfig } from "../runtime"
import { PGliteFederationStore } from "./pglite-store"
import type { PGliteClient } from "./pglite-store"
import { ReplicationValkeyCache } from "./valkey-cache"
import type { ValkeyCacheConfig } from "./valkey-cache"
import { ReplicationDuckDbLogger } from "./duckdb-logger"
import type { DuckDbClient } from "./duckdb-logger"

// Re-export the adapter types so consumers have a single import point.
export type { PGliteClient } from "./pglite-store"
export type { ValkeyCacheConfig } from "./valkey-cache"
export type { DuckDbClient } from "./duckdb-logger"

// ── Aggregate Result ──────────────────────────────────────────────────────────

export interface TrifectaAdapters {
  pgliteStore: PGliteFederationStore | null
  valkeyCache: ReplicationValkeyCache | null
  duckdbLogger: ReplicationDuckDbLogger | null
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create trifecta adapters from a RuntimeConfig.
 *
 * - When `config.pglite` is provided, a PGliteFederationStore is created.
 * - When `config.valkey` is a ValkeyCacheConfig, a new ReplicationValkeyCache
 *   is constructed (caller must still `connect()` it).  When it is already a
 *   ReplicationValkeyCache instance, it is returned as-is.
 * - When `config.duckdb` is provided, a ReplicationDuckDbLogger is created.
 */
export function createTrifectaAdapters(config: RuntimeConfig): TrifectaAdapters {
  const pgliteStore: PGliteFederationStore | null =
    config.pglite ? new PGliteFederationStore(config.pglite) : null

  let valkeyCache: ReplicationValkeyCache | null = null
  if (config.valkey) {
    if (config.valkey instanceof ReplicationValkeyCache) {
      valkeyCache = config.valkey
    } else {
      valkeyCache = new ReplicationValkeyCache(config.valkey)
    }
  }

  const duckdbLogger: ReplicationDuckDbLogger | null =
    config.duckdb ? new ReplicationDuckDbLogger(config.duckdb) : null

  return { pgliteStore, valkeyCache, duckdbLogger }
}

// ── Guard Helpers ─────────────────────────────────────────────────────────────

/** True when the PGlite store adapter was initialised. */
export function hasPGlite(adapters: TrifectaAdapters): boolean {
  return adapters.pgliteStore !== null
}

/** True when the Valkey cache adapter was initialised. */
export function hasValkey(adapters: TrifectaAdapters): boolean {
  return adapters.valkeyCache !== null
}

/** True when the DuckDB logger adapter was initialised. */
export function hasDuckDb(adapters: TrifectaAdapters): boolean {
  return adapters.duckdbLogger !== null
}
