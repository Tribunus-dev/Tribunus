/**
 * Dharma Replication — Hyperswarm Lifecycle Manager
 *
 * Manages a Hyperswarm instance for a single federation: topic
 * derivation, connection tracking, pause/resume, and clean teardown.
 *
 * @module
 */

import Hyperswarm from "hyperswarm"
import { createHash } from "node:crypto"
import { DHARMA_SWARM_TOPIC_PREFIX } from "./protocol"
import type { SwarmLifecycleState, ReplicationLimits } from "./protocol"
import { SwarmError } from "./errors"

// ── Topic derivation ----------------------------------------------------------

/**
 * Derive the deterministic Hyperswarm topic for a federation.
 *
 * The topic is SHA-256("tribunus.dharma.phase2" || federationId || autobaseDiscoveryKey).
 */
export function deriveSwarmTopic(
  federationId: string,
  autobaseDiscoveryKey: string,
): Buffer {
  const seed = `${DHARMA_SWARM_TOPIC_PREFIX}${federationId}${autobaseDiscoveryKey}`
  return createHash("sha256").update(seed).digest()
}

// ── Internal discovery handle type -------------------------------------------

/**
 * Expanded handle returned by Hyperswarm.join() at runtime.
 * The ambient declarations only expose a subset — we add suspend/resume
 * which the real PeerDiscovery class provides.
 */
interface DiscoveryHandle {
  destroyed: boolean
  destroy(): Promise<void>
  flushed(): Promise<void>
  suspend(opts?: { log?: (msg: string) => void }): Promise<void>
  resume(): void
}

// ── Config --------------------------------------------------------------------

export interface SwarmConfig {
  federationId: string
  autobaseDiscoveryKey: string
  limits: ReplicationLimits
  keyPair: { publicKey: Buffer; secretKey: Buffer } | null
  onConnection: (connection: unknown, peerInfo: unknown) => void
  /** DHT bootstrap nodes. Defaults to public Hyperswarm bootstrap servers. */
  bootstrap?: string[]
  /** When true, prefer IPv6. Default false. */
  preferIPv6?: boolean
}

// ── DharmaSwarm ---------------------------------------------------------------

/**
 * DharmaSwarm manages a Hyperswarm instance for a single federation.
 *
 * Lifecycle: stopped → starting → joining → connected (↔ degraded / paused).
 */
export class DharmaSwarm {
  private swarm: Hyperswarm | null = null
  private topic: Buffer | null = null
  private discovery: DiscoveryHandle | null = null
  private state: SwarmLifecycleState = "stopped"
  private connections: Set<unknown> = new Set()

  constructor(private config: SwarmConfig) {}

  /** Start the swarm and join the federation topic. */
  async start(): Promise<void> {
    if (this.state !== "stopped") {
      throw new SwarmError(`Cannot start swarm from state: ${this.state}`)
    }

    try {
      this.state = "starting"

      const opts = this.config.keyPair
        ? { keyPair: this.config.keyPair }
        : undefined

      const swarmOpts = {
        ...opts,
        bootstrap: this.config.bootstrap ?? [
          "bootstrap1.hyperswarm.org:49737",
          "bootstrap2.hyperswarm.org:49737",
          "bootstrap3.hyperswarm.org:49737",
        ],
      }
      if (this.config.preferIPv6) {
        ;(swarmOpts as Record<string, unknown>).preferIPv6 = true
      }

      this.swarm = new Hyperswarm(swarmOpts)

      this.topic = deriveSwarmTopic(
        this.config.federationId,
        this.config.autobaseDiscoveryKey,
      )

      this.swarm.on("connection", (connection: unknown, info: unknown) => {
        this.handleConnection(connection, info)
      })

      // Join the topic — returns a PeerDiscovery at runtime
      const handle = this.swarm.join(this.topic)
      this.discovery = handle as unknown as DiscoveryHandle

      // Wait for the first flush to confirm the DHT is ready
      await this.discovery.flushed()

      this.state = "joining"
    } catch (cause) {
      this.state = "stopped"
      throw new SwarmError(
        `Failed to start swarm for federation ${this.config.federationId}`,
        cause,
      )
    }
  }

  /** Stop the swarm, leave the topic, and destroy all connections. */
  async stop(): Promise<void> {
    if (this.state === "stopped") return

    this.state = "stopping"

    try {
      // Destroy the peer discovery (leaves the topic)
      if (this.discovery) {
        await this.discovery.destroy()
        this.discovery = null
      }

      // Destroy the swarm (drops all connections)
      if (this.swarm) {
        await this.swarm.destroy()
        this.swarm = null
      }

      this.connections.clear()
      this.topic = null
      this.state = "stopped"
    } catch (cause) {
      this.state = "stopped"
      throw new SwarmError(
        `Failed to stop swarm for federation ${this.config.federationId}`,
        cause,
      )
    }
  }

  /** Pause discovery but keep existing connections alive. */
  pause(): void {
    if (this.state !== "connected") return
    if (this.discovery) {
      this.discovery.suspend().catch(() => {
        // suspension failures are non-fatal
      })
    }
    this.state = "paused"
  }

  /** Resume discovery after a pause. */
  resume(): void {
    if (this.state !== "paused") return
    if (this.discovery) {
      this.discovery.resume()
    } else if (this.swarm && this.topic) {
      this.discovery = this.swarm.join(this.topic) as unknown as DiscoveryHandle
    }
    this.state = "connected"
  }

  /** Get current swarm lifecycle state. */
  getState(): SwarmLifecycleState {
    return this.state
  }

  /** Get the raw Hyperswarm instance (may be null before start). */
  getSwarm(): Hyperswarm | null {
    return this.swarm
  }

  /** Number of active connections. */
  getConnectionCount(): number {
    return this.connections.size
  }

  /** Get the derived swarm topic buffer. */
  getTopic(): Buffer | null {
    return this.topic
  }

  // ── Internal connection handlers -------------------------------------------

  private handleConnection(connection: unknown, info: unknown): void {
    // Track the connection
    this.connections.add(connection)

    // Notify the configured callback
    this.config.onConnection(connection, info)

    // If this is the first connection, transition to "connected"
    if (this.state === "joining" || this.state === "starting") {
      this.state = "connected"
    }

    // Wire up close handler to clean up tracking
    if (
      connection &&
      typeof connection === "object" &&
      "on" in connection
    ) {
      const stream = connection as { on: (event: string, cb: () => void) => void }
      stream.on("close", () => {
        this.handleConnectionClose(connection)
      })
    }
  }

  private handleConnectionClose(connection: unknown): void {
    this.connections.delete(connection)

    // If all connections are gone, reflect state change
    if (this.connections.size === 0 && this.state === "connected") {
      this.state = "joining"
    }
  }
}

/** The default Hyperswarm DHT bootstrap server addresses. */
export const DEFAULT_HYPERSWARM_BOOTSTRAP: readonly string[] = Object.freeze([
  "bootstrap1.hyperswarm.org:49737",
  "bootstrap2.hyperswarm.org:49737",
  "bootstrap3.hyperswarm.org:49737",
])

/**
 * Configure a SwarmConfig with default bootstrap servers.
 * Accepts a config without the `bootstrap` field and fills in the defaults.
 */
export function withDefaultBootstrap(config: Omit<SwarmConfig, "bootstrap">): SwarmConfig {
  return { ...config, bootstrap: [...DEFAULT_HYPERSWARM_BOOTSTRAP] }
}
