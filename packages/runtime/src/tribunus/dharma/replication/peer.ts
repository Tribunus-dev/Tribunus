/**
 * Dharma Replication — Peer Lifecycle Tracker
 *
 * Tracks discovered, handshaking, active, and disconnected peers
 * within a single federation.  Provides counters and pruning for
 * resource management.
 *
 * @module
 */

import type { PeerState, ReplicationLimits, DharmaPeerHello } from "./protocol"

// ── Peer Record ---------------------------------------------------------------

export interface PeerRecord {
  peerId: string
  nodeInstanceId: string
  state: PeerState
  identityPublicKey: string | null
  devicePublicKey: string
  connectedAt: string | null
  lastActivityAt: string | null
  eventsReceived: number
  bytesReceived: number
  limits: ReplicationLimits | null
}

// ── Peer Tracker --------------------------------------------------------------

export class PeerTracker {
  private peers: Map<string, PeerRecord> = new Map()

  constructor(private federationId: string) {}

  /** Register a newly discovered peer from its hello message. */
  registerPeer(peerId: string, hello: DharmaPeerHello): PeerRecord {
    const now = new Date().toISOString()
    const record: PeerRecord = {
      peerId,
      nodeInstanceId: hello.nodeInstanceId,
      state: "discovered",
      identityPublicKey: hello.identityPublicKey,
      devicePublicKey: hello.devicePublicKey,
      connectedAt: null,
      lastActivityAt: now,
      eventsReceived: 0,
      bytesReceived: 0,
      limits: null,
    }
    this.peers.set(peerId, record)
    return record
  }

  /** Update a peer's state. */
  setState(peerId: string, state: PeerState): void {
    const record = this.peers.get(peerId)
    if (record) {
      record.state = state
      record.lastActivityAt = new Date().toISOString()
      if (state === "active" && !record.connectedAt) {
        record.connectedAt = new Date().toISOString()
      }
    }
  }

  /** Record an event received from a peer. */
  recordEvent(peerId: string, bytes: number): void {
    const record = this.peers.get(peerId)
    if (record) {
      record.eventsReceived++
      record.bytesReceived += bytes
      record.lastActivityAt = new Date().toISOString()
    }
  }

  /** Get a single peer record. */
  getPeer(peerId: string): PeerRecord | undefined {
    return this.peers.get(peerId)
  }

  /** Get all active peers (state === "active"). */
  getActivePeers(): PeerRecord[] {
    const result: PeerRecord[] = []
    for (const record of this.peers.values()) {
      if (record.state === "active") {
        result.push(record)
      }
    }
    return result
  }

  /** Count peers, optionally filtered by state. */
  getPeerCount(state?: PeerState): number {
    if (state === undefined) {
      return this.peers.size
    }
    let count = 0
    for (const record of this.peers.values()) {
      if (record.state === state) count++
    }
    return count
  }

  /** Mark a peer as disconnected. */
  disconnectPeer(peerId: string): void {
    const record = this.peers.get(peerId)
    if (record) {
      record.state = "disconnected"
      record.lastActivityAt = new Date().toISOString()
    }
  }

  /** Remove peer entries that have been disconnected or stale for longer than maxAgeMs. */
  prunePeers(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs
    const toDelete: string[] = []

    for (const [id, record] of this.peers) {
      if (record.state === "disconnected" || record.state === "blocked") {
        if (record.lastActivityAt) {
          const lastActivity = new Date(record.lastActivityAt).getTime()
          if (lastActivity < cutoff) {
            toDelete.push(id)
          }
        }
      }
    }

    for (const id of toDelete) {
      this.peers.delete(id)
    }

    return toDelete.length
  }

  /** Get all stored peer IDs. */
  getAllPeerIds(): string[] {
    return Array.from(this.peers.keys())
  }
}
