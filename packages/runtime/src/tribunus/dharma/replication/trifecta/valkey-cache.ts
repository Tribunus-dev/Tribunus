/**
 * Dharma Replication — Valkey Cache
 *
 * Provides fast crash-recovery caching for:
 * - Peer connection state (ephemeral, per-federation)
 * - Outbox pending entries (fast recovery on restart)
 * - Active session tracking (transient session data)
 *
 * Uses ioredis as the client. All keys are namespaced under a configurable
 * prefix (default: "dharma:replication:") to coexist with other caches.
 */

import Redis from "ioredis"

// ── Types --------------------------------------------------------------------

export interface ValkeyCacheConfig {
  /** Valkey connection URL, default "redis://127.0.0.1:6379" */
  url?: string
  /** Key prefix for namespacing, default "dharma:replication:" */
  prefix?: string
}

// ── Key format helpers -------------------------------------------------------

function peerStateKey(prefix: string, federationId: string, peerId: string): string {
  return `${prefix}${federationId}:peers:${peerId}`
}

function outboxListKey(prefix: string, federationId: string): string {
  return `${prefix}${federationId}:outbox`
}

function sessionKey(prefix: string, sessionId: string): string {
  return `${prefix}sessions:${sessionId}`
}

// ── Valkey Cache -------------------------------------------------------------

export class ReplicationValkeyCache {
  private client: Redis | null = null
  private config: Required<ValkeyCacheConfig>

  constructor(config?: ValkeyCacheConfig) {
    this.config = {
      url: config?.url ?? "redis://127.0.0.1:6379",
      prefix: config?.prefix ?? "dharma:replication:",
    }
  }

  // ── Peer connection state ─────────────────────────────────────────────────

  /**
   * Store peer connection state.
   * The caller is responsible for serialising complex state objects to JSON.
   */
  async setPeerState(federationId: string, peerId: string, state: string): Promise<void> {
    const key = peerStateKey(this.config.prefix, federationId, peerId)
    await this.client!.set(key, state)
  }

  /**
   * Retrieve stored peer connection state, or null when no state exists.
   */
  async getPeerState(federationId: string, peerId: string): Promise<string | null> {
    const key = peerStateKey(this.config.prefix, federationId, peerId)
    return this.client!.get(key)
  }

  /**
   * Remove peer connection state (e.g. on disconnect).
   */
  async removePeerState(federationId: string, peerId: string): Promise<void> {
    const key = peerStateKey(this.config.prefix, federationId, peerId)
    await this.client!.del(key)
  }

  /**
   * List all peer ids that have stored connection state for a given federation.
   * Uses SCAN to avoid blocking on large sets.
   */
  async listActivePeers(federationId: string): Promise<string[]> {
    const pattern = `${this.config.prefix}${federationId}:peers:*`
    const peerIds: string[] = []
    let cursor = "0"

    do {
      const result = await this.client!.scan(cursor, "MATCH", pattern, "COUNT", 100)
      cursor = result[0]
      for (const key of result[1]) {
        const parts = key.split(":")
        const peerId = parts[parts.length - 1]
        peerIds.push(peerId)
      }
    } while (cursor !== "0")

    return peerIds
  }

  // ── Outbox pending entries (FIFO queue) ──────────────────────────────────

  /**
   * Push an outbox entry id onto the pending queue for recovery.
   * Entries are consumed in FIFO order via popPendingOutbox.
   */
  async pushPendingOutbox(federationId: string, outboxId: string): Promise<void> {
    const key = outboxListKey(this.config.prefix, federationId)
    await this.client!.rpush(key, outboxId)
  }

  /**
   * Pop the oldest pending outbox entry id, or null when the queue is empty.
   */
  async popPendingOutbox(federationId: string): Promise<string | null> {
    const key = outboxListKey(this.config.prefix, federationId)
    return this.client!.lpop(key)
  }

  /**
   * Return the number of pending outbox entries for a federation.
   */
  async getPendingOutboxCount(federationId: string): Promise<number> {
    const key = outboxListKey(this.config.prefix, federationId)
    return this.client!.llen(key)
  }

  /**
   * Remove all pending outbox entries for a federation.
   */
  async clearPendingOutbox(federationId: string): Promise<void> {
    const key = outboxListKey(this.config.prefix, federationId)
    await this.client!.del(key)
  }

  // ── Session tracking ─────────────────────────────────────────────────────

  /**
   * Store active session data (e.g. JSON-serialised handshake state).
   */
  async setActiveSession(sessionId: string, data: string): Promise<void> {
    const key = sessionKey(this.config.prefix, sessionId)
    await this.client!.set(key, data)
  }

  /**
   * Retrieve stored session data, or null when no session exists.
   */
  async getActiveSession(sessionId: string): Promise<string | null> {
    const key = sessionKey(this.config.prefix, sessionId)
    return this.client!.get(key)
  }

  /**
   * Remove an active session record.
   */
  async removeActiveSession(sessionId: string): Promise<void> {
    const key = sessionKey(this.config.prefix, sessionId)
    await this.client!.del(key)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Connect to the Valkey server. MUST be called before any cache operations.
   */
  async connect(): Promise<void> {
    this.client = new Redis(this.config.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
    })
    await this.client.connect()
  }

  /**
   * Gracefully disconnect from the Valkey server.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit()
      this.client = null
    }
  }

  /**
   * Flush all keys under the configured prefix.
   * Uses SCAN + DEL to avoid disrupting other namespaces.
   */
  async flushAll(): Promise<void> {
    const pattern = `${this.config.prefix}*`
    let cursor = "0"

    do {
      const result = await this.client!.scan(cursor, "MATCH", pattern, "COUNT", 100)
      cursor = result[0]
      if (result[1].length > 0) {
        await this.client!.del(...result[1])
      }
    } while (cursor !== "0")
  }

  /**
   * Ping the Valkey server to verify connectivity.
   * Returns true on success, false on failure.
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client!.ping()
      return result === "PONG"
    } catch {
      return false
    }
  }
}
