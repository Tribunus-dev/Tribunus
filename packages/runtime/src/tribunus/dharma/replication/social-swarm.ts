/**
 * Dharma Social Swarm — Social P2P Peer Discovery
 *
 * A lightweight Hyperswarm wrapper for social-layer peer discovery.
 * Each social identity gets its own DHT topic derived from SYNC_TOPIC_PREFIX + identityId.
 *
 * @module
 */

import Hyperswarm from "hyperswarm"
import { createHash } from "node:crypto"
import { SYNC_TOPIC_PREFIX } from "./social-replication"
import type { DharmaCorestore } from "./corestore"

// ── Topic handle type (subset of Hyperswarm's runtime PeerDiscovery) ─────────

/**
 * Minimal interface for a Hyperswarm topic discovery handle.
 * The ambient type declarations only expose a subset of the runtime class.
 */
interface DiscoveryHandle {
  destroyed: boolean
  destroy(): Promise<void>
  flushed(): Promise<void>
}

// ── Topic derivation ─────────────────────────────────────────────────────────

/**
 * Derive the deterministic Hyperswarm topic for a social identity.
 *
 * Topic = SHA-256(SYNC_TOPIC_PREFIX || identityId).
 *
 * @param identityId - The user's Dharma identity ID
 * @returns A 32-byte Buffer suitable as a Hyperswarm topic key
 */
export function deriveSocialTopic(identityId: string): Buffer {
  const seed = `${SYNC_TOPIC_PREFIX}${identityId}`
  return createHash("sha256").update(seed).digest()
}

// ── SocialSwarm ──────────────────────────────────────────────────────────────

/**
 * SocialSwarm manages a Hyperswarm instance for social peer discovery.
 *
 * Multiple social identities can be joined simultaneously; each identity
 * produces a separate DHT topic. New connections are automatically wired
 * into the underlying Corestore's replication protocol.
 *
 * Lifecycle: stopped → started → joined (for each identity) → closed.
 */
export class SocialSwarm {
  private swarm: Hyperswarm | null = null
  private readonly topics: Map<string, { handle: DiscoveryHandle; identityId: string }> = new Map()
  private readonly connections: Set<unknown> = new Set()
  private corestore: DharmaCorestore
  private started = false

  constructor(corestore: DharmaCorestore) {
    this.corestore = corestore
  }

  /**
   * Start the Hyperswarm instance and begin listening for connections.
   */
  async start(): Promise<void> {
    if (this.started) return

    this.swarm = new Hyperswarm()

    this.swarm.on("connection", (connection: unknown, _info: unknown) => {
      this.connections.add(connection)
      this.corestore.getStore().replicate(connection)

      // Track connection close to maintain an accurate peer count
      if (
        connection &&
        typeof connection === "object" &&
        "on" in connection
      ) {
        const stream = connection as {
          on: (event: string, cb: () => void) => void
        }
        stream.on("close", () => {
          this.connections.delete(connection)
        })
      }
    })

    this.started = true
  }

  /**
   * Join the DHT topic for a social identity, enabling peer discovery
   * and replication for that identity.
   *
   * @param identityId - The user's Dharma identity ID
   */
  async joinPeer(identityId: string): Promise<void> {
    if (!this.swarm || !this.started) {
      throw new Error("SocialSwarm not started")
    }
    if (this.topics.has(identityId)) return

    const topic = deriveSocialTopic(identityId)
    const handle = this.swarm.join(topic, {
      server: true,
      client: true,
    }) as unknown as DiscoveryHandle
    await handle.flushed()
    this.topics.set(identityId, { handle, identityId })
  }

  /**
   * Leave the DHT topic for a social identity, stopping peer discovery
   * for that identity. Existing connections are not forcibly closed.
   *
   * @param identityId - The user's Dharma identity ID
   */
  async leavePeer(identityId: string): Promise<void> {
    const entry = this.topics.get(identityId)
    if (!entry) return

    await entry.handle.destroy()
    this.topics.delete(identityId)
  }

  /**
   * Close the swarm entirely: leave all topics and destroy the
   * underlying Hyperswarm instance.
   */
  async close(): Promise<void> {
    for (const [id] of this.topics) {
      await this.leavePeer(id)
    }

    if (this.swarm) {
      await this.swarm.destroy()
      this.swarm = null
    }

    this.connections.clear()
    this.started = false
  }

  /** Number of active connections. */
  get connectedPeers(): number {
    return this.connections.size
  }

  /** Whether the swarm has been started. */
  get isStarted(): boolean {
    return this.started
  }
}
