/**
 * Dharma Social Replication — Profile, Activity, and Follow Graph Layer
 *
 * Manages per-identity Hypercore-backed cores for social data: profiles,
 * activity logs, and follow graphs. Currently uses in-memory storage (Map)
 * until Hypercore integration is enabled.
 *
 * Core naming convention (future Hypercore deployment):
 *   social/profile/<identityId>
 *   social/activity/<identityId>
 *   social/follow/<identityId>
 *
 * Topic derivation for replication:
 *   SHA-256("tribunus.dharma.social" || identityId)
 */

import { randomUUID } from "node:crypto"
import type { DharmaCorestore } from "./corestore"
import type {
  SocialProfile,
  SocialProfileUpdate,
  SocialActivity,
  SocialActivityPayload,
  FollowRecord,
  Endorsement,
  BlockEntry,
} from "../codex/codex-social"
import {
  createProfile,
  updateProfile,
  createActivity,
  follow as createFollowRecord,
  unfollow as applyUnfollow,
  getActiveFollows,
  getActiveFollowers,
  isFollowing,
  buildFeed,
} from "../codex/codex-social"

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Hyperswarm topic prefix for social core replication.
 * Topic = SHA-256(PREFIX || identityId).
 */
export const SYNC_TOPIC_PREFIX = "tribunus.dharma.social"

// ── Configuration ──────────────────────────────────────────────────────────

export interface SocialReplicationConfig {
  /** Filesystem path for Corestore storage (used when Hypercore is enabled). */
  storagePath: string
  /** The Ed25519 identity id owning this social replication instance. */
  identityId: string
  /** Human-readable display name, persisted as initial profile value. */
  displayName: string
  /** Optional Corestore instance (required for Hypercore-backed operation). */
  corestore?: DharmaCorestore
}

// ── Error ──────────────────────────────────────────────────────────────────

export class SocialReplicationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "SocialReplicationError"
    this.code = code
  }
}

// ── In-Memory Storage ──────────────────────────────────────────────────────

/**
 * Container for the in-memory backing stores of SocialReplicationManager.
 * Each manager instance owns one user's social data entirely in memory.
 */
interface InMemoryStores {
  profile: SocialProfile | null
  activities: SocialActivity[]
  followRecords: FollowRecord[]
  endorsements: Endorsement[]
  blocks: BlockEntry[]
  /** Profiles of peers we have subscribed to. */
  peerProfiles: Map<string, SocialProfile>
  /** Activity logs of subscribed peers, keyed by peer identityId. */
  peerActivities: Map<string, SocialActivity[]>
  /** Set of peer identityIds the local user is subscribed to. */
  subscribedPeers: Set<string>
}

// ── Sync State ─────────────────────────────────────────────────────────────

export interface SocialSyncState {
  peerCount: number
  lastSyncAt: string | null
  isSyncing: boolean
}

// ── SocialReplicationManager ───────────────────────────────────────────────

export class SocialReplicationManager {
  private readonly config: SocialReplicationConfig
  private stores: InMemoryStores
  private initialized = false
  private isSyncing = false
  private lastSyncAt: string | null = null
  private peerCount = 0
  private useHypercore = false

  constructor(config: SocialReplicationConfig) {
    this.config = { ...config }
    this.stores = this.createFreshStores()
    this.useHypercore = !!config.corestore
  }

  // ── Private Helpers ──────────────────────────────────────────────────

  private createFreshStores(): InMemoryStores {
    return {
      profile: null,
      activities: [],
      followRecords: [],
      endorsements: [],
      blocks: [],
      peerProfiles: new Map(),
      peerActivities: new Map(),
      subscribedPeers: new Set(),
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new SocialReplicationError("NOT_INITIALIZED", "SocialReplicationManager has not been initialized. Call initialize() first.")
    }
  }

  // ── Core Lifecycle ──────────────────────────────────────────────────────

  /**
   * Initialize the social replication manager.
   * Opens or creates in-memory stores. When Hypercore is enabled, opens
   * or creates the underlying cores.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    this.stores = this.createFreshStores()

    if (this.useHypercore) {
      // Future: open or create SocialCore + SocialBee via this.config.corestore
      //   const profileCore = await this.config.corestore!.get(`social/profile/${this.config.identityId}`)
      //   const activityCore = await this.config.corestore!.get(`social/activity/${this.config.identityId}`)
      //   const followCore = await this.config.corestore!.get(`social/follow/${this.config.identityId}`)
      //   this.socialBee = new Autobase(...)
    }

    // Initialize profile from config
    this.stores.profile = createProfile(
      this.config.identityId,
      this.config.displayName,
    )

    this.initialized = true
  }

  /**
   * Close the manager and release any resources.
   */
  async close(): Promise<void> {
    this.assertInitialized()

    if (this.useHypercore) {
      // Future: close all open cores and the SocialBee
    }

    this.stores = this.createFreshStores()
    this.initialized = false
    this.isSyncing = false
    this.lastSyncAt = null
    this.peerCount = 0
  }

  // ── Profile Management ──────────────────────────────────────────────────

  /**
   * Retrieve the local user's profile, or null if not yet created.
   */
  async getProfile(): Promise<SocialProfile | null> {
    this.assertInitialized()
    return this.stores.profile ? { ...this.stores.profile } : null
  }

  /**
   * Update the local user's profile.
   * Returns the updated profile and appends a profile_updated activity.
   */
  async updateProfile(update: SocialProfileUpdate): Promise<SocialProfile> {
    this.assertInitialized()

    if (!this.stores.profile) {
      // Create from scratch with the config identityId
      this.stores.profile = createProfile(
        this.config.identityId,
        this.config.displayName,
      )
    }

    const updated = updateProfile(this.stores.profile, update)
    this.stores.profile = updated

    // Append a profile_updated activity
    const activity = createActivity(this.config.identityId, {
      type: "profile_updated",
      data: {},
    })
    this.stores.activities.push(activity)

    return { ...updated }
  }

  // ── Activity ──────────────────────────────────────────────────────────────

  /**
   * Append a new social activity for the local user.
   * Optionally signs the activity using the provided signing function.
   * Returns the created SocialActivity.
   */
  async appendActivity(
    payload: SocialActivityPayload,
    signFn?: (json: string) => string,
  ): Promise<SocialActivity> {
    this.assertInitialized()

    const activity = createActivity(this.config.identityId, payload, signFn)
    this.stores.activities.push(activity)
    return { ...activity }
  }

  /**
   * Retrieve the local user's activities, most recent first.
   */
  async getActivities(limit = 50, offset = 0): Promise<SocialActivity[]> {
    this.assertInitialized()

    const sorted = [...this.stores.activities].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    )
    return sorted.slice(offset, offset + limit).map((a) => ({ ...a }))
  }

  // ── Follow Graph ──────────────────────────────────────────────────────────

  /**
   * Follow another user.
   * Appends a follow record and a "followed" activity.
   * Returns the created FollowRecord.
   */
  async follow(followeeId: string): Promise<FollowRecord> {
    this.assertInitialized()

    if (isFollowing(this.stores.followRecords, this.config.identityId, followeeId)) {
      throw new SocialReplicationError(
        "ALREADY_FOLLOWING",
        `Already following user ${followeeId}`,
      )
    }

    const record = createFollowRecord(this.config.identityId, followeeId)
    this.stores.followRecords.push(record)

    // Append a followed activity
    const activity = createActivity(this.config.identityId, {
      type: "followed",
      data: { followeeId },
    })
    this.stores.activities.push(activity)

    return { ...record }
  }

  /**
   * Unfollow a previously followed user.
   * Marks the follow record as unfollowed.
   */
  async unfollow(followeeId: string): Promise<void> {
    this.assertInitialized()

    if (!isFollowing(this.stores.followRecords, this.config.identityId, followeeId)) {
      throw new SocialReplicationError(
        "NOT_FOLLOWING",
        `Not currently following user ${followeeId}`,
      )
    }

    this.stores.followRecords = applyUnfollow(
      this.stores.followRecords,
      this.config.identityId,
      followeeId,
    )
  }

  /**
   * Get all users this identity is actively following.
   */
  async getFollowing(): Promise<FollowRecord[]> {
    this.assertInitialized()
    return getActiveFollows(this.stores.followRecords, this.config.identityId).map(
      (r) => ({ ...r }),
    )
  }

  /**
   * Get all active followers of a given user.
   */
  async getFollowers(followeeId: string): Promise<FollowRecord[]> {
    this.assertInitialized()
    return getActiveFollowers(this.stores.followRecords, followeeId).map((r) => ({
      ...r,
    }))
  }

  // ── Peer Subscription ────────────────────────────────────────────────────

  /**
   * Subscribe to a peer's social core, triggering replication of their
   * profile and activities. In the current in-memory mode, this simply
   * registers the peer for feed inclusion.
   */
  async subscribeToPeer(peerIdentityId: string): Promise<void> {
    this.assertInitialized()

    if (peerIdentityId === this.config.identityId) {
      throw new SocialReplicationError(
        "SELF_SUBSCRIBE",
        "Cannot subscribe to your own social core",
      )
    }

    this.stores.subscribedPeers.add(peerIdentityId)

    // Initialize peer storage if not present
    if (!this.stores.peerProfiles.has(peerIdentityId)) {
      this.stores.peerProfiles.set(peerIdentityId, {
        profileId: peerIdentityId,
        displayName: peerIdentityId.slice(0, 12),
        bio: "",
        avatarHash: null,
        website: "",
        joinedAt: new Date().toISOString(),
        profileVersion: 0,
      })
    }
    if (!this.stores.peerActivities.has(peerIdentityId)) {
      this.stores.peerActivities.set(peerIdentityId, [])
    }
  }

  /**
   * Unsubscribe from a peer's social core.
   */
  async unsubscribeFromPeer(peerIdentityId: string): Promise<void> {
    this.assertInitialized()
    this.stores.subscribedPeers.delete(peerIdentityId)
  }

  /**
   * Get the list of peer identityIds the local user is subscribed to.
   */
  async getSubscribedPeers(): Promise<string[]> {
    this.assertInitialized()
    return Array.from(this.stores.subscribedPeers)
  }

  // ── Feed Construction ───────────────────────────────────────────────────

  /**
   * Construct a feed from the local user's activities and those of all
   * subscribed peers, sorted in reverse chronological order.
   *
   * Returns an array of { activity, profile } pairs.
   */
  async getFeed(
    limit = 50,
    offset = 0,
  ): Promise<{ activity: SocialActivity; profile: SocialProfile }[]> {
    this.assertInitialized()

    // Gather all activities: local + subscribed peers
    const allActivities: SocialActivity[] = [
      ...this.stores.activities,
    ]
    for (const peerId of this.stores.subscribedPeers) {
      const peerActs = this.stores.peerActivities.get(peerId)
      if (peerActs) {
        allActivities.push(...peerActs)
      }
    }

    // Build a profile map including the local user and all subscribed peers
    const profileMap = new Map<string, SocialProfile>()

    if (this.stores.profile) {
      profileMap.set(this.stores.profile.profileId, this.stores.profile)
    }
    for (const peerId of this.stores.subscribedPeers) {
      const peerProfile = this.stores.peerProfiles.get(peerId)
      if (peerProfile) {
        profileMap.set(peerId, peerProfile)
      }
    }

    return buildFeed(allActivities, profileMap, limit, offset)
  }

  // ── Peer Data Ingestion (for tests / future replication callbacks) ─────

  /**
   * Manually ingest a peer's profile into local storage.
   * Primarily used by tests and, in the future, by the replication callback
   * when a peer's profile core syncs.
   */
  async ingestPeerProfile(peerIdentityId: string, profile: SocialProfile): Promise<void> {
    this.assertInitialized()
    this.stores.peerProfiles.set(peerIdentityId, { ...profile })
  }

  /**
   * Manually ingest a peer's activity into local storage.
   * Primarily used by tests and, in the future, by the replication callback
   * when a peer's activity core syncs.
   */
  async ingestPeerActivity(peerIdentityId: string, activity: SocialActivity): Promise<void> {
    this.assertInitialized()

    let acts = this.stores.peerActivities.get(peerIdentityId)
    if (!acts) {
      acts = []
      this.stores.peerActivities.set(peerIdentityId, acts)
    }
    acts.push({ ...activity })
  }

  // ── Sync Status ─────────────────────────────────────────────────────────

  /**
   * Returns the current sync state of the manager.
   */
  getSyncState(): SocialSyncState {
    return {
      peerCount: this.peerCount,
      lastSyncAt: this.lastSyncAt,
      isSyncing: this.isSyncing,
    }
  }

  /**
   * Update the sync state (called by the replication layer when peers
   * connect/disconnect or sync completes).
   */
  updateSyncState(state: Partial<SocialSyncState>): void {
    if (state.peerCount !== undefined) this.peerCount = state.peerCount
    if (state.lastSyncAt !== undefined) this.lastSyncAt = state.lastSyncAt
    if (state.isSyncing !== undefined) this.isSyncing = state.isSyncing
  }
}
