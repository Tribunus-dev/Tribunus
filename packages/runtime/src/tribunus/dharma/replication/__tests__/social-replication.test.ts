/**
 * Dharma Social Replication — Tests
 *
 * Tests the SocialReplicationManager with in-memory storage.
 * No Hypercore or filesystem dependencies.
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { SocialReplicationManager } from "../social-replication"
import type { SocialReplicationConfig } from "../social-replication"

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_CONFIG: SocialReplicationConfig = {
  storagePath: "/tmp/test-social/",
  identityId: "alice-ed25519-abc123",
  displayName: "Alice",
}

const PEER_BOB = "bob-ed25519-def456"
const PEER_CAROL = "carol-ed25519-ghi789"

function createManager(
  overrides: Partial<SocialReplicationConfig> = {},
): SocialReplicationManager {
  return new SocialReplicationManager({ ...TEST_CONFIG, ...overrides })
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SocialReplicationManager", () => {
  let manager: SocialReplicationManager

  beforeEach(async () => {
    manager = createManager()
    await manager.initialize()
  })

  // ── Initialization ─────────────────────────────────────────────────────

  describe("initialize", () => {
    it("creates a default profile on init", async () => {
      const profile = await manager.getProfile()
      expect(profile).not.toBeNull()
      expect(profile!.profileId).toBe(TEST_CONFIG.identityId)
      expect(profile!.displayName).toBe(TEST_CONFIG.displayName)
      expect(profile!.profileVersion).toBe(1)
    })

    it("is idempotent — calling initialize twice does not reset state", async () => {
      await manager.updateProfile({ bio: "Hello world" })
      await manager.initialize() // second call

      const profile = await manager.getProfile()
      expect(profile!.bio).toBe("Hello world")
      expect(profile!.profileVersion).toBeGreaterThanOrEqual(2)
    })

    it("throws on getProfile if not initialized", async () => {
      const uninit = new SocialReplicationManager(TEST_CONFIG)
      expect(uninit.getProfile()).rejects.toThrow("has not been initialized")
    })
  })

  // ── Close ──────────────────────────────────────────────────────────────

  describe("close", () => {
    it("clears all state and prevents further operations", async () => {
      await manager.close()

      expect(manager.getProfile()).rejects.toThrow("has not been initialized")
      expect(manager.getActivities()).rejects.toThrow("has not been initialized")
      expect(manager.getFollowing()).rejects.toThrow("has not been initialized")
    })
  })

  // ── Profile Management ─────────────────────────────────────────────────

  describe("profile management", () => {
    it("stores and retrieves a profile after updateProfile", async () => {
      const updated = await manager.updateProfile({
        displayName: "Alice Updated",
        bio: "A curious explorer",
        website: "https://alice.example.com",
      })

      expect(updated.displayName).toBe("Alice Updated")
      expect(updated.bio).toBe("A curious explorer")
      expect(updated.website).toBe("https://alice.example.com")
      expect(updated.profileVersion).toBe(2) // incremented from initial 1

      const retrieved = await manager.getProfile()
      expect(retrieved!.displayName).toBe("Alice Updated")
    })

    it("partial update only changes specified fields", async () => {
      await manager.updateProfile({ displayName: "Alice V2" })
      const updated = await manager.updateProfile({ bio: "Just a bio change" })

      expect(updated.displayName).toBe("Alice V2")
      expect(updated.bio).toBe("Just a bio change")
      expect(updated.website).toBe("") // unchanged
    })

    it("appends a profile_updated activity on profile change", async () => {
      await manager.updateProfile({ bio: "New bio" })
      const activities = await manager.getActivities()

      expect(activities.length).toBe(1)
      expect(activities[0].payload.type).toBe("profile_updated")
      expect(activities[0].actorId).toBe(TEST_CONFIG.identityId)
    })
  })

  // ── Activity Log ───────────────────────────────────────────────────────

  describe("appendActivity", () => {
    it("appends an activity to the log", async () => {
      const activity = await manager.appendActivity({
        type: "joined",
        data: {},
      })

      expect(activity.actorId).toBe(TEST_CONFIG.identityId)
      expect(activity.payload.type).toBe("joined")
      expect(activity.activityId).toBeDefined()
      expect(activity.timestamp).toBeDefined()
    })

    it("accepts optional signing function", async () => {
      const signFn = (json: string) => `sig:${json.length}`
      const activity = await manager.appendActivity(
        { type: "joined", data: {} },
        signFn,
      )

      expect(activity.signature).toContain("sig:")
    })

    it("returns activities in reverse chronological order", async () => {
      const a1 = await manager.appendActivity({ type: "joined", data: {} })

      // Small delay so timestamps differ
      await new Promise((r) => setTimeout(r, 5))
      const a2 = await manager.appendActivity({
        type: "accepted_proposal",
        data: { requestId: "r1", proposalId: "p1", title: "Test" },
      })

      await new Promise((r) => setTimeout(r, 5))
      const a3 = await manager.appendActivity({
        type: "codex_entry",
        data: { entryId: "e1", title: "My Entry", knowledgeClass: "research" },
      })

      const activities = await manager.getActivities()

      // Most recent first
      expect(activities[0].activityId).toBe(a3.activityId)
      expect(activities[1].activityId).toBe(a2.activityId)
      expect(activities[2].activityId).toBe(a1.activityId)
    })

    it("respects limit and offset", async () => {
      for (let i = 0; i < 10; i++) {
        await manager.appendActivity({ type: "joined", data: {} })
      }

      const firstFive = await manager.getActivities(5, 0)
      expect(firstFive.length).toBe(5)

      const nextFive = await manager.getActivities(5, 5)
      expect(nextFive.length).toBe(5)
      expect(nextFive[0].activityId).not.toBe(firstFive[0].activityId)
    })
  })

  // ── Follow / Unfollow ──────────────────────────────────────────────────

  describe("follow / unfollow", () => {
    it("creates an active follow record", async () => {
      const record = await manager.follow(PEER_BOB)

      expect(record.followerId).toBe(TEST_CONFIG.identityId)
      expect(record.followeeId).toBe(PEER_BOB)
      expect(record.status).toBe("active")
    })

    it("appends a followed activity when following", async () => {
      await manager.follow(PEER_BOB)
      const activities = await manager.getActivities()

      const followActs = activities.filter(
        (a) => a.payload.type === "followed",
      )
      expect(followActs.length).toBe(1)
      expect(
        (followActs[0].payload as { type: "followed"; data: { followeeId: string } }).data.followeeId,
      ).toBe(PEER_BOB)
    })

    it("throws when following the same user twice", async () => {
      await manager.follow(PEER_BOB)
      expect(manager.follow(PEER_BOB)).rejects.toThrow("Already following")
    })

    it("unfollow marks record as unfollowed", async () => {
      await manager.follow(PEER_BOB)
      await manager.unfollow(PEER_BOB)

      const following = await manager.getFollowing()
      expect(following.length).toBe(0)

      // But the record exists with status unfollowed
    })

    it("throws when unfollowing someone not followed", async () => {
      expect(manager.unfollow(PEER_BOB)).rejects.toThrow("Not currently following")
    })

    it("getFollowing returns only active follows", async () => {
      await manager.follow(PEER_BOB)
      await manager.follow(PEER_CAROL)
      await manager.unfollow(PEER_BOB)

      const following = await manager.getFollowing()
      expect(following.length).toBe(1)
      expect(following[0].followeeId).toBe(PEER_CAROL)
    })

    it("getFollowers returns follower records for a given user", async () => {
      await manager.follow(PEER_BOB)
      const followers = await manager.getFollowers(PEER_BOB)

      expect(followers.length).toBe(1)
      expect(followers[0].followerId).toBe(TEST_CONFIG.identityId)
      expect(followers[0].status).toBe("active")
    })
  })

  // ── Peer Subscription ──────────────────────────────────────────────────

  describe("peer subscription", () => {
    it("subscribes to a peer", async () => {
      await manager.subscribeToPeer(PEER_BOB)
      const peers = await manager.getSubscribedPeers()
      expect(peers).toContain(PEER_BOB)
    })

    it("prevents subscribing to self", async () => {
      expect(
        manager.subscribeToPeer(TEST_CONFIG.identityId),
      ).rejects.toThrow("Cannot subscribe to your own social core")
    })

    it("unsubscribes from a peer", async () => {
      await manager.subscribeToPeer(PEER_BOB)
      await manager.subscribeToPeer(PEER_CAROL)
      await manager.unsubscribeFromPeer(PEER_BOB)

      const peers = await manager.getSubscribedPeers()
      expect(peers).not.toContain(PEER_BOB)
      expect(peers).toContain(PEER_CAROL)
    })
  })

  // ── Feed Construction ──────────────────────────────────────────────────

  describe("feed construction", () => {
    it("returns local activities when no peers are subscribed", async () => {
      await manager.appendActivity({ type: "joined", data: {} })
      const feed = await manager.getFeed()
      expect(feed.length).toBe(1)
      expect(feed[0].activity.actorId).toBe(TEST_CONFIG.identityId)
    })

    it("includes activities from subscribed peers", async () => {
      await manager.subscribeToPeer(PEER_BOB)
      await manager.subscribeToPeer(PEER_CAROL)

      // Bob's activity ingested
      await manager.ingestPeerActivity(PEER_BOB, {
        activityId: "act-bob-1",
        actorId: PEER_BOB,
        timestamp: new Date().toISOString(),
        payload: { type: "joined", data: {} },
        signature: null,
      })

      // Carol's activity ingested
      await manager.ingestPeerActivity(PEER_CAROL, {
        activityId: "act-carol-1",
        actorId: PEER_CAROL,
        timestamp: new Date().toISOString(),
        payload: { type: "joined", data: {} },
        signature: null,
      })

      // Local activity
      await manager.appendActivity({ type: "joined", data: {} })

      const feed = await manager.getFeed()
      expect(feed.length).toBe(3)
    })

    it("includes profiles for each activity in the feed", async () => {
      await manager.subscribeToPeer(PEER_BOB)

      // Ingest Bob's profile
      await manager.ingestPeerProfile(PEER_BOB, {
        profileId: PEER_BOB,
        displayName: "Bob The Builder",
        bio: "I build things",
        avatarHash: null,
        website: "",
        joinedAt: new Date().toISOString(),
        profileVersion: 1,
      })

      // Bob's activity
      await manager.ingestPeerActivity(PEER_BOB, {
        activityId: "act-bob-1",
        actorId: PEER_BOB,
        timestamp: new Date().toISOString(),
        payload: { type: "joined", data: {} },
        signature: null,
      })

      const feed = await manager.getFeed()
      const bobItem = feed.find((f) => f.activity.actorId === PEER_BOB)
      expect(bobItem).toBeDefined()
      expect(bobItem!.profile.displayName).toBe("Bob The Builder")
    })

    it("respects limit and offset on feed", async () => {
      for (let i = 0; i < 10; i++) {
        await manager.appendActivity({ type: "joined", data: {} })
      }

      const feed = await manager.getFeed(3, 0)
      expect(feed.length).toBe(3)
    })

    it("returns feed sorted reverse chronologically", async () => {
      const a1 = await manager.appendActivity({ type: "joined", data: {} })
      await new Promise((r) => setTimeout(r, 5))
      const a2 = await manager.appendActivity({
        type: "codex_entry",
        data: { entryId: "e1", title: "Test", knowledgeClass: "research" },
      })

      const feed = await manager.getFeed()
      expect(feed[0].activity.activityId).toBe(a2.activityId)
      expect(feed[1].activity.activityId).toBe(a1.activityId)
    })
  })

  // ── Sync State ─────────────────────────────────────────────────────────

  describe("sync state", () => {
    it("returns default state after initialization", () => {
      const state = manager.getSyncState()
      expect(state.peerCount).toBe(0)
      expect(state.lastSyncAt).toBeNull()
      expect(state.isSyncing).toBe(false)
    })

    it("reflects updated sync state", () => {
      manager.updateSyncState({
        peerCount: 3,
        lastSyncAt: "2026-07-01T00:00:00.000Z",
        isSyncing: true,
      })

      const state = manager.getSyncState()
      expect(state.peerCount).toBe(3)
      expect(state.lastSyncAt).toBe("2026-07-01T00:00:00.000Z")
      expect(state.isSyncing).toBe(true)
    })

    it("partial update does not override unspecified fields", () => {
      manager.updateSyncState({ peerCount: 5 })

      const state = manager.getSyncState()
      expect(state.peerCount).toBe(5)
      expect(state.lastSyncAt).toBeNull() // unchanged
      expect(state.isSyncing).toBe(false) // unchanged
    })
  })

  // ── Integration: Full Flow ─────────────────────────────────────────────

  describe("integration: full social flow", () => {
    it("walks through profile → activity → follow → feed", async () => {
      // 1. Update profile
      await manager.updateProfile({
        displayName: "Alice In Chains",
        bio: "Full-stack researcher",
      })

      // 2. Append activities
      await manager.appendActivity({ type: "joined", data: {} })
      await manager.appendActivity({
        type: "accepted_proposal",
        data: { requestId: "r1", proposalId: "p1", title: "Research on P2P" },
      })

      // 3. Follow Bob and Carol
      await manager.follow(PEER_BOB)

      // 4. Subscribe to Bob
      await manager.subscribeToPeer(PEER_BOB)

      // 5. Ingest Bob's data
      await manager.ingestPeerProfile(PEER_BOB, {
        profileId: PEER_BOB,
        displayName: "Bob",
        bio: "Bob's bio",
        avatarHash: null,
        website: "",
        joinedAt: new Date().toISOString(),
        profileVersion: 1,
      })
      await manager.ingestPeerActivity(PEER_BOB, {
        activityId: "bob-act-1",
        actorId: PEER_BOB,
        timestamp: new Date().toISOString(),
        payload: { type: "joined", data: {} },
        signature: null,
      })

      // 6. Get feed — should include Alice's and Bob's activities
      const feed = await manager.getFeed()

      // Alice has 3 activities (profile_updated, joined, accepted_proposal)
      // Alice has 4 activities (profile_updated, joined, accepted_proposal, followed)
      // Bob has 1 activity = 5 total
      expect(feed.length).toBe(5)

      // Alice's profile is present
      const aliceItem = feed.find((f) => f.activity.actorId === TEST_CONFIG.identityId)
      expect(aliceItem).toBeDefined()
      expect(aliceItem!.profile.displayName).toBe("Alice In Chains")

      // Bob's profile is also present
      const bobItem = feed.find((f) => f.activity.actorId === PEER_BOB)
      expect(bobItem).toBeDefined()
      expect(bobItem!.profile.displayName).toBe("Bob")

      // Alice is following Bob
      const following = await manager.getFollowing()
      expect(following.length).toBe(1)
      expect(following[0].followeeId).toBe(PEER_BOB)
    })
  })
})
