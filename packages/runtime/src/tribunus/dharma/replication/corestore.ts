/**
 * Dharma Corestore — Corestore Ownership and Federation Namespace
 *
 * One Corestore per Tribunus profile, managing all Dharma Hypercores.
 * Core names are deterministic ASCII paths:
 *   dharma/system
 *   dharma/federation/<federation_id>/writer/<identity_id>
 *   dharma/federation/<federation_id>/view
 *   dharma/federation/<federation_id>/checkpoint
 *   dharma/federation/<federation_id>/private-inbox
 *
 * All I/O is lazy — cores are opened and cached on first access.
 */

import Corestore from "corestore"
import type Hypercore from "hypercore"
import type { ReplicationLimits } from "./protocol"
import { CorestoreError } from "./errors"


export interface CorestoreConfig {
  /** Filesystem path to the Corestore data directory, e.g. <profile-data>/dharma/corestore/ */
  storagePath: string
  /** Replication limits governing this Corestore's swarm participation. */
  limits: ReplicationLimits
}

// ── Core Name Constants & Helpers -------------------------------------------

const SYSTEM_CORE_NAME = "dharma/system"
const FEDERATION_PREFIX = "dharma/federation"

function writerCoreName(federationId: string, identityId: string): string {
  return `${FEDERATION_PREFIX}/${federationId}/writer/${identityId}`
}

function viewCoreName(federationId: string): string {
  return `${FEDERATION_PREFIX}/${federationId}/view`
}

function checkpointCoreName(federationId: string): string {
  return `${FEDERATION_PREFIX}/${federationId}/checkpoint`
}

function privateInboxCoreName(federationId: string): string {
  return `${FEDERATION_PREFIX}/${federationId}/private-inbox`
}

const SOCIAL_PROFILE_PREFIX = "social/profile"
const SOCIAL_ACTIVITY_PREFIX = "social/activity"
const SOCIAL_FOLLOW_PREFIX = "social/follow"

function socialProfileCoreName(identityId: string): string {
  return `${SOCIAL_PROFILE_PREFIX}/${identityId}`
}
function socialActivityCoreName(identityId: string): string {
  return `${SOCIAL_ACTIVITY_PREFIX}/${identityId}`
}
function socialFollowBeeName(identityId: string): string {
  return `${SOCIAL_FOLLOW_PREFIX}/${identityId}`
}

/**
 * Exported name helpers — useful for tests and external consumers that
 * need to predict or inspect core names without instantiating a store.
 */
export const CoreName = {
  system: (): string => SYSTEM_CORE_NAME,
  writer: writerCoreName,
  view: viewCoreName,
  checkpoint: checkpointCoreName,
  privateInbox: privateInboxCoreName,
  socialProfile: socialProfileCoreName,
  socialActivity: socialActivityCoreName,
  socialFollow: socialFollowBeeName,
} as const

// ── DharmaCorestore ----------------------------------------------------------

export class DharmaCorestore {
  private store: Corestore
  private cores: Map<string, Hypercore> = new Map()
  private _opened: boolean = false

  constructor(private config: CorestoreConfig) {
    this.store = new Corestore(config.storagePath)
  }

  // ── Lifecycle --------------------------------------------------------

  /** Open/reopen the Corestore. Idempotent. */
  async open(): Promise<void> {
    if (this._opened) return
    try {
      await this.store.ready()
      this._opened = true
    } catch (cause) {
      throw new CorestoreError("Failed to open Corestore", cause)
    }
  }

  /** Close the Corestore and all cached cores. Idempotent. */
  async close(): Promise<void> {
    if (!this._opened) return
    try {
      await this.store.close()
    } catch (cause) {
      throw new CorestoreError("Failed to close Corestore", cause)
    } finally {
      this.cores.clear()
      this._opened = false
    }
  }

  // ── Core Access ------------------------------------------------------

  /** Get or create a named core. Cached in memory after first open. */
  async getCore(name: string): Promise<Hypercore> {
    const cached = this.cores.get(name)
    if (cached) return cached

    try {
      const core: Hypercore = this.store.get(name)
      await core.ready()
      this.cores.set(name, core)
      return core
    } catch (cause) {
      throw new CorestoreError(`Failed to get core: ${name}`, cause)
    }
  }

  /** Create a writer core for a specific federation + identity pair. */
  async getWriterCore(federationId: string, identityId: string): Promise<Hypercore> {
    return this.getCore(writerCoreName(federationId, identityId))
  }

  /** Get the federation view core (shared autobase-linearized view). */
  async getViewCore(federationId: string): Promise<Hypercore> {
    return this.getCore(viewCoreName(federationId))
  }

  /** Get the federation checkpoint core (recovery acceleration). */
  async getCheckpointCore(federationId: string): Promise<Hypercore> {
    return this.getCore(checkpointCoreName(federationId))
  }

  /** Get the federation private-inbox core. */
  async getPrivateInboxCore(federationId: string): Promise<Hypercore> {
    return this.getCore(privateInboxCoreName(federationId))
  }

  /** Get the system core (identity metadata, device registrations). */
  async getSystemCore(): Promise<Hypercore> {
    return this.getCore(SYSTEM_CORE_NAME)
  }

  /** Get or create the social profile core for a given identity. */
  async getSocialProfileCore(identityId: string): Promise<Hypercore<any>> {
    return this.getCore(socialProfileCoreName(identityId))
  }

  /** Get or create the social activity core for a given identity. */
  async getSocialActivityCore(identityId: string): Promise<Hypercore<any>> {
    return this.getCore(socialActivityCoreName(identityId))
  }

  /** Get or create the social follow bee core for a given identity. */
  async getSocialFollowBee(identityId: string): Promise<Hypercore<any>> {
    return this.getCore(socialFollowBeeName(identityId))
  }

  // ── Queries ----------------------------------------------------------

  /** Return all opened federation cores for replication (used by swarm). */
  getReplicationCores(): Hypercore[] {
    const result: Hypercore[] = []
    for (const [name, core] of this.cores) {
      if (name.startsWith(FEDERATION_PREFIX)) {
        result.push(core)
      }
      if (name.startsWith(SOCIAL_PROFILE_PREFIX) || name.startsWith(SOCIAL_ACTIVITY_PREFIX) || name.startsWith(SOCIAL_FOLLOW_PREFIX)) {
        result.push(core)
      }
    }
    return result
  }

  /** Check if a named core has already been opened and cached. */
  async hasCore(name: string): Promise<boolean> {
    return this.cores.has(name)
  }

  /** Get the underlying Corestore instance (for wiring into Hyperswarm replication). */
  getStore(): Corestore {
    return this.store
  }

  /** Whether the Corestore has been opened. */
  get isOpened(): boolean {
    return this._opened
  }

  /** The config supplied at construction. */
  getConfig(): CorestoreConfig {
    return this.config
  }
}
