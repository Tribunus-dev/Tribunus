/**
 * Codex — Dharma Social Network Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createProfile,
  updateProfile,
  createActivity,
  verifyActivitySignature,
  follow,
  unfollow,
  getActiveFollows,
  getActiveFollowers,
  isFollowing,
  createEndorsement,
  getEndorsementsFor,
  getEndorsementsBy,
  getEndorsementCount,
  block,
  isBlocked,
  getBlockedBy,
  unblock,
  buildFeed,
  computeSocialScore,
  isVerifiedIdentity,
  createAcceptedProposalActivity,
  createEarnedDharmaActivity,
  createCodexEntryActivity,
  createFollowedActivity,
  createEndorsedActivity,
  createJoinedActivity,
  addVerifiedLink,
  markLinkVerified,
  removeLink,
  getVerifiedLinks,
  getLinksByPlatform,
  createConversation,
  deriveSharedConversationId,
  sendDmMessage,
  deriveDmEncryptionKey,
  createVerificationChallenge,
  completeVerification,
  generateVerificationProofInstructions,
  extractHashtags,
  createPost,
  editPost,
  getPostsByAuthor,
  getPostsByHashtag,
  createComment,
  getCommentsForPost,
  getThreadedComments,
  getConversationMessages,
  computeTrends,
  getTrendingTopics,
  buildFilteredFeed,
  sfwScreenPost,
  sfwCheckContent,
  likePost,
  unlikePost,
  getLikesForPost,
  getLikeCount,
  sharePost,
  unsharePost,
  getSharesForPost,
  getShareCount,
  createCuratedList,
  addToList,
  removeFromList,
  filterPostsByLists,
  createFeedDefinition,
  subscribeToFeed,
  unsubscribeFromFeed,
  getFeedsWithSubscriber,
  applyFeedToPosts,
} from "../codex-social"
import type { PostMedia } from "../codex-social"

function sleepSort<T extends { timestamp: string }>(item: T, msDelay: number): T {
  const orig = Date.now
  const fake = () => orig() + msDelay
  // The item already has a timestamp; we can just create a helper that
  // creates items with adjusted timestamps for sorting tests
  return { ...item, timestamp: new Date(new Date(item.timestamp).getTime() + msDelay).toISOString() }
}

// ── Profile ──────────────────────────────────────────────────────────────

describe("createProfile", () => {
  test("creates profile with required fields", () => {
    const p = createProfile("alice-digest", "Alice")
    expect(p.profileId).toBe("alice-digest")
    expect(p.displayName).toBe("Alice")
    expect(p.bio).toBe("")
    expect(p.avatarHash).toBeNull()
    expect(p.website).toBe("")
    expect(p.profileVersion).toBe(1)
    expect(p.joinedAt).toBeTruthy()
  })
  test("creates profile with all fields", () => {
    const p = createProfile("bob-digest", "Bob", "Bio text", "abc123", "https://bob.dev")
    expect(p.displayName).toBe("Bob")
    expect(p.bio).toBe("Bio text")
    expect(p.avatarHash).toBe("abc123")
    expect(p.website).toBe("https://bob.dev")
  })
  test("trims whitespace", () => {
    const p = createProfile("c-digest", "  Charlie  ", "  bio  ")
    expect(p.displayName).toBe("Charlie")
    expect(p.bio).toBe("bio")
  })
})

describe("updateProfile", () => {
  test("update displayName", () => {
    const p = createProfile("id", "Alice")
    const u = updateProfile(p, { displayName: "Alice v2" })
    expect(u.displayName).toBe("Alice v2")
    expect(u.profileVersion).toBe(2)
  })
  test("update bio", () => {
    const p = createProfile("id", "Alice")
    const u = updateProfile(p, { bio: "new bio" })
    expect(u.bio).toBe("new bio")
    expect(u.profileVersion).toBe(2)
  })
  test("update avatarHash to null", () => {
    const p = createProfile("id", "Alice", "", "hash1")
    const u = updateProfile(p, { avatarHash: null })
    expect(u.avatarHash).toBeNull()
  })
  test("multiple updates", () => {
    const u = updateProfile(updateProfile(createProfile("id", "A"), { bio: "b" }), { website: "w" })
    expect(u.profileVersion).toBe(3)
    expect(u.displayName).toBe("A")
    expect(u.bio).toBe("b")
    expect(u.website).toBe("w")
  })
})

// ── Activity ─────────────────────────────────────────────────────────────

describe("createActivity", () => {
  test("creates activity without signature", () => {
    const a = createActivity("alice", { type: "joined", data: {} })
    expect(a.activityId).toBeTruthy()
    expect(a.actorId).toBe("alice")
    expect(a.payload.type).toBe("joined")
    expect(a.signature).toBeNull()
  })

  test("applies signature when signFn provided", () => {
    const a = createActivity("alice", { type: "joined", data: {} }, (json) => `sig:${json.length}`)
    expect(a.signature).toContain("sig:")
  })

  test("verifyActivitySignature returns true for valid signature", () => {
    const a = createActivity("alice", { type: "joined", data: {} }, (json) => `sig-${json}`)
    expect(verifyActivitySignature(a, (json, sig) => sig === `sig-${json}`)).toBe(true)
  })

  test("verifyActivitySignature returns false for missing signature", () => {
    const a = createActivity("alice", { type: "joined", data: {} })
    expect(verifyActivitySignature(a, () => true)).toBe(false)
  })

  test("creates various activity types", () => {
    const accepted = createAcceptedProposalActivity("a", "r1", "p1", "Fix crash")
    expect(accepted.payload.type).toBe("accepted_proposal")

    const dharma = createEarnedDharmaActivity("a", 1, "res1", "bug fix")
    expect(dharma.payload.type).toBe("earned_dharma")

    const entry = createCodexEntryActivity("a", "e1", "Pattern", "failure_mode")
    expect(entry.payload.type).toBe("codex_entry")

    const followed = createFollowedActivity("a", "b")
    expect(followed.payload.type).toBe("followed")

    const endorsed = createEndorsedActivity("a", "b", "c1", "great work")
    expect(endorsed.payload.type).toBe("endorsed")

    const joined = createJoinedActivity("a")
    expect(joined.payload.type).toBe("joined")
  })

  test("signature excludes signature field from canonical", () => {
    const signed: string[] = []
    createActivity("alice", { type: "endorsed", data: { toId: "bob", contributionId: "c1", message: "thanks" } }, (json) => {
      signed.push(json)
      return "sig"
    })
    expect(signed[0]).not.toContain("signature")
    expect(signed[0]).toContain("alice")
    expect(signed[0]).toContain("endorsed")
  })
})

// ── Follow ───────────────────────────────────────────────────────────────

describe("follow", () => {
  test("creates follow record", () => {
    const f = follow("alice", "bob")
    expect(f.followerId).toBe("alice")
    expect(f.followeeId).toBe("bob")
    expect(f.status).toBe("active")
  })

  test("throws on self-follow", () => {
    expect(() => follow("alice", "alice")).toThrow("Cannot follow yourself")
  })
})

describe("unfollow", () => {
  test("marks follow as unfollowed", () => {
    const f = follow("alice", "bob")
    const updated = unfollow([f], "alice", "bob")
    expect(updated[0].status).toBe("unfollowed")
  })
  test("does not affect other follows", () => {
    const f1 = follow("alice", "bob")
    const f2 = follow("alice", "charlie")
    const updated = unfollow([f1, f2], "alice", "bob")
    const bobFollow = updated.find((r) => r.followeeId === "bob")
    const charlieFollow = updated.find((r) => r.followeeId === "charlie")
    expect(bobFollow!.status).toBe("unfollowed")
    expect(charlieFollow!.status).toBe("active")
  })
})

describe("getActiveFollows", () => {
  test("returns active follows for a user", () => {
    const records = [follow("alice", "bob"), follow("alice", "charlie"), follow("bob", "alice")]
    expect(getActiveFollows(records, "alice")).toHaveLength(2)
    expect(getActiveFollows(records, "bob")).toHaveLength(1)
  })
  test("excludes unfollowed", () => {
    const records = [follow("alice", "bob"), unfollow([follow("alice", "charlie")], "alice", "charlie")].flat()
    expect(getActiveFollows(records, "alice")).toHaveLength(1)
  })
})

describe("isFollowing", () => {
  test("returns true when following", () => {
    expect(isFollowing([follow("alice", "bob")], "alice", "bob")).toBe(true)
  })
  test("returns false when not following", () => {
    expect(isFollowing([follow("alice", "bob")], "alice", "charlie")).toBe(false)
  })
  test("returns false after unfollow", () => {
    const records = unfollow([follow("alice", "bob")], "alice", "bob")
    expect(isFollowing(records, "alice", "bob")).toBe(false)
  })
})

// ── Endorsement ──────────────────────────────────────────────────────────

describe("createEndorsement", () => {
  test("creates endorsement with all fields", () => {
    const e = createEndorsement("alice", "bob", "c1", "fixed my bug")
    expect(e.fromId).toBe("alice")
    expect(e.toId).toBe("bob")
    expect(e.forContributionId).toBe("c1")
    expect(e.message).toBe("fixed my bug")
    expect(e.endorsementId).toBeTruthy()
  })
  test("creates endorsement without message", () => {
    const e = createEndorsement("alice", "bob", "c1")
    expect(e.message).toBe("")
  })
})

describe("getEndorsementsFor", () => {
  test("returns endorsements for a user", () => {
    const es = [createEndorsement("alice", "bob", "c1"), createEndorsement("charlie", "bob", "c2"), createEndorsement("alice", "charlie", "c3")]
    expect(getEndorsementsFor("bob", es)).toHaveLength(2)
  })
})

describe("getEndorsementCount", () => {
  test("counts endorsements", () => {
    const es = [createEndorsement("alice", "bob", "c1"), createEndorsement("charlie", "bob", "c2")]
    expect(getEndorsementCount("bob", es)).toBe(2)
    expect(getEndorsementCount("alice", es)).toBe(0)
  })
})

// ── Block ────────────────────────────────────────────────────────────────

describe("block", () => {
  test("blocks a user", () => {
    const b = block("alice", "bob", "spam")
    expect(b.blockerId).toBe("alice")
    expect(b.blockedId).toBe("bob")
    expect(b.reason).toBe("spam")
  })
  test("block without reason", () => {
    expect(block("alice", "bob").reason).toBe("")
  })
})

describe("isBlocked", () => {
  test("returns true when blocked", () => {
    expect(isBlocked("alice", "bob", [block("alice", "bob")])).toBe(true)
  })
  test("returns false when not blocked", () => {
    expect(isBlocked("alice", "bob", [block("alice", "charlie")])).toBe(false)
  })
})

describe("unblock", () => {
  test("removes block entry", () => {
    const blocks = [block("alice", "bob"), block("alice", "charlie")]
    const result = unblock("alice", "bob", blocks)
    expect(result).toHaveLength(1)
    expect(isBlocked("alice", "bob", result)).toBe(false)
  })
})

// ── Feed ─────────────────────────────────────────────────────────────────

describe("buildFeed", () => {
  test("builds feed sorted by timestamp descending", () => {
    const profile = createProfile("alice", "Alice")
    const profiles = new Map([["alice", profile]])
    const activities = [
      createActivity("alice", { type: "joined", data: {} }),
      createActivity("alice", { type: "joined", data: {} }),
    ]
    const feed = buildFeed(activities, profiles)
    expect(feed).toHaveLength(2)
    expect(feed[0].profile.displayName).toBe("Alice")
  })

  test("respects limit", () => {
    const profiles = new Map()
    const activities = Array.from({ length: 10 }, () => createActivity("a", { type: "joined", data: {} }))
    expect(buildFeed(activities, profiles, 3)).toHaveLength(3)
  })

  test("respects offset", () => {
    const profiles = new Map()
    const activities = Array.from({ length: 10 }, () => createActivity("a", { type: "joined", data: {} }))
    expect(buildFeed(activities, profiles, 10, 5)).toHaveLength(5)
  })

  test("handles unknown profiles with fallback display name", () => {
    const activity = createActivity("unknown-key", { type: "joined", data: {} })
    const feed = buildFeed([activity], new Map())
    expect(feed[0].profile.displayName).toBe("unknown-key")
    expect(feed[0].profile.profileVersion).toBe(0)
  })
})

// ── Dharma Score ─────────────────────────────────────────────────────────

describe("computeSocialScore", () => {
  test("computes score with all metrics", () => {
    const endorsements = [createEndorsement("charlie", "alice", "c1"), createEndorsement("dave", "alice", "c2")]
    const follows = [follow("alice", "bob"), follow("alice", "charlie"), follow("dave", "alice")]
    const score = computeSocialScore("alice", 3, endorsements, follows, { proposalsAccepted: 5, codexEntries: 2 })
    expect(score.dharmaEarned).toBe(3)
    expect(score.proposalsAccepted).toBe(5)
    expect(score.codexEntriesCredited).toBe(2)
    expect(score.endorsementsReceived).toBe(2)
    expect(score.followers).toBe(1)
    expect(score.following).toBe(2)
  })

  test("zero score for new user", () => {
    const score = computeSocialScore("new-user", 0, [], [], { proposalsAccepted: 0, codexEntries: 0 })
    expect(score.dharmaEarned).toBe(0)
    expect(score.proposalsAccepted).toBe(0)
    expect(score.endorsementsReceived).toBe(0)
    expect(score.followers).toBe(0)
  })
})

describe("isVerifiedIdentity", () => {
  test("verified if dharma earned", () => {
    expect(isVerifiedIdentity(computeSocialScore("a", 1, [], [], { proposalsAccepted: 0, codexEntries: 0 }))).toBe(true)
  })
  test("verified if proposal accepted", () => {
    expect(isVerifiedIdentity(computeSocialScore("a", 0, [], [], { proposalsAccepted: 1, codexEntries: 0 }))).toBe(true)
  })
  test("not verified for zero score", () => {
    expect(isVerifiedIdentity(computeSocialScore("a", 0, [], [], { proposalsAccepted: 0, codexEntries: 0 }))).toBe(false)
  })
})

// ── Verified Links ────────────────────────────────────────────────────────

describe("addVerifiedLink", () => {
  test("creates unverified link", () => {
    const l = addVerifiedLink("github", "https://github.com/alice")
    expect(l.platform).toBe("github")
    expect(l.url).toBe("https://github.com/alice")
    expect(l.verified).toBe(false)
  })
})

describe("markLinkVerified", () => {
  test("marks link as verified", () => {
    const l = markLinkVerified(addVerifiedLink("website", "https://alice.dev"))
    expect(l.verified).toBe(true)
    expect(l.verifiedAt).toBeTruthy()
  })
})

describe("removeLink", () => {
  test("removes link by id", () => {
    const l1 = addVerifiedLink("github", "https://github.com/alice")
    const l2 = addVerifiedLink("website", "https://alice.dev")
    expect(removeLink([l1, l2], l1.linkId)).toHaveLength(1)
  })
})

describe("getVerifiedLinks", () => {
  test("filters verified links only", () => {
    const l1 = markLinkVerified(addVerifiedLink("github", "https://github.com/alice"))
    const l2 = addVerifiedLink("website", "https://alice.dev")
    const result = getVerifiedLinks([l1, l2])
    expect(result).toHaveLength(1)
    expect(result[0].platform).toBe("github")
  })
})

describe("getLinksByPlatform", () => {
  test("filters by platform", () => {
    const links = [addVerifiedLink("github", "https://github.com/alice"), addVerifiedLink("linkedin", "https://linkedin.com/in/alice")]
    expect(getLinksByPlatform(links, "github")).toHaveLength(1)
    expect(getLinksByPlatform(links, "linkedin")).toHaveLength(1)
    expect(getLinksByPlatform(links, "twitter")).toHaveLength(0)
  })
})

// ── Direct Messages ───────────────────────────────────────────────────────

describe("createConversation", () => {
  test("creates conversation between two participants", () => {
    const c = createConversation("alice", "bob")
    expect(c.participants).toContain("alice")
    expect(c.participants).toContain("bob")
    expect(c.messageCount).toBe(0)
  })
  test("throws for self-conversation", () => {
    expect(() => createConversation("alice", "alice")).toThrow()
  })
  test("sorts participants deterministically", () => {
    const c1 = createConversation("alice", "bob")
    const c2 = createConversation("bob", "alice")
    expect(c1.participants).toEqual(c2.participants)
  })
})

describe("sendDmMessage", () => {
  test("sends plaintext message", () => {
    const c = createConversation("alice", "bob")
    const { message, updatedConversation } = sendDmMessage(c, "alice", "Hello Bob")
    expect(message.content).toBe("Hello Bob")
    expect(message.encrypted).toBe(false)
    expect(updatedConversation.messageCount).toBe(1)
  })
  test("throws if sender not in conversation", () => {
    const c = createConversation("alice", "bob")
    expect(() => sendDmMessage(c, "charlie", "hi")).toThrow()
  })
  test("encrypts message when encrypt function provided", () => {
    const c = createConversation("alice", "bob")
    const { message } = sendDmMessage(c, "alice", "secret", (txt) => ({ ciphertext: "enc:" + txt, keyId: "k1" }))
    expect(message.encrypted).toBe(true)
    expect(message.content).toBe("enc:secret")
    expect(message.signature).toContain("enc:k1")
  })
})

describe("getConversationMessages", () => {
  test("returns messages sorted by timestamp descending", () => {
    const c = createConversation("alice", "bob")
    const m1 = { ...sendDmMessage(c, "alice", "first").message, timestamp: "2024-01-01T00:00:00.000Z" }
    const m2 = { ...sendDmMessage(c, "bob", "second").message, timestamp: "2024-01-02T00:00:00.000Z" }
    const messages = getConversationMessages([m1, m2], c.conversationId)
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe("second")  // newest first
  })
})

describe("deriveSharedConversationId", () => {
  test("produces same id from either order", () => {
    expect(deriveSharedConversationId("alice", "bob")).toBe(deriveSharedConversationId("bob", "alice"))
  })
})

describe("deriveDmEncryptionKey", () => {
  test("produces same key from either order", () => {
    const salt = "test-salt-do-not-use"
    const k1 = deriveDmEncryptionKey("alice", "bob", salt)
    const k2 = deriveDmEncryptionKey("bob", "alice", salt)
    expect(k1.derivedKey).toBe(k2.derivedKey)
  })
})

// ── Identity Verification ─────────────────────────────────────────────────

describe("createVerificationChallenge", () => {
  test("creates challenge with expiry", () => {
    const v = createVerificationChallenge("alice", "gist", "https://gist.github.com/alice/verify")
    expect(v.challenge).toBeTruthy()
    expect(v.method).toBe("gist")
    expect(v.verifiedAt).toBeNull()
    expect(v.expiresAt).toBeTruthy()
  })
})

describe("completeVerification", () => {
  test("completes when proof contains challenge", () => {
    const v = createVerificationChallenge("alice", "meta_tag", "https://alice.dev")
    const result = completeVerification("alice", "meta_tag", `meta name="dharma-verify" content="${v.challenge}"`)
    expect(result.verifiedAt).toBeTruthy()
  })
  test("throws when proof doesn't contain challenge", () => {
    createVerificationChallenge("bob", "gist", "url")
    expect(() => completeVerification("bob", "gist", "wrong-token")).toThrow()
  })
})

describe("generateVerificationProofInstructions", () => {
  test("generates instructions for gist", () => {
    const v = createVerificationChallenge("alice", "gist", "url")
    expect(generateVerificationProofInstructions(v)).toContain("Create a secret Gist")
  })
  test("generates instructions for social_post", () => {
    const v = createVerificationChallenge("alice", "social_post", "url")
    expect(generateVerificationProofInstructions(v)).toContain("Post this on your social profile")
  })
  test("generates instructions for meta_tag", () => {
    const v = createVerificationChallenge("alice", "meta_tag", "url")
    expect(generateVerificationProofInstructions(v)).toContain("meta name")
  })
  test("generates instructions for file_upload", () => {
    const v = createVerificationChallenge("alice", "file_upload", "url")
    expect(generateVerificationProofInstructions(v)).toContain("Upload a file")
  })
  test("generates instructions for dns_txt", () => {
    const v = createVerificationChallenge("alice", "dns_txt", "url")
    expect(generateVerificationProofInstructions(v)).toContain("TXT record")
  })
})

// ── Posts ────────────────────────────────────────────────────────────────

describe("extractHashtags", () => {
  test("extracts hashtags from content", () => {
    expect(extractHashtags("Hello #world this is #test")).toEqual(["world", "test"])
  })
  test("lowercases hashtags", () => {
    expect(extractHashtags("#Hello #WORLD")).toEqual(["hello", "world"])
  })
  test("deduplicates", () => {
    expect(extractHashtags("#test #test")).toEqual(["test"])
  })
  test("returns empty for no hashtags", () => {
    expect(extractHashtags("no tags here")).toEqual([])
  })
})

describe("createPost", () => {
  test("creates public post", () => {
    const p = createPost("alice", "Hello world #intro")
    expect(p.authorId).toBe("alice")
    expect(p.content).toBe("Hello world #intro")
    expect(p.hashtags).toContain("intro")
    expect(p.visibility).toBe("public")
    expect(p.media).toEqual([])
  })
  test("applies signature", () => {
    const p = createPost("alice", "hello", [], "public", (c) => `sig:${c.length}`)
    expect(p.signature).toContain("sig:")
  })
  test("creates followers-only post", () => {
    const p = createPost("alice", "private", [], "followers")
    expect(p.visibility).toBe("followers")
  })
})

describe("editPost", () => {
  test("updates content and recalculates hashtags", () => {
    const p = createPost("alice", "Hello #world")
    const e = editPost(p, { content: "Updated #hello" })
    expect(e.content).toBe("Updated #hello")
    expect(e.hashtags).toContain("hello")
    expect(e.hashtags).not.toContain("world")
    expect(e.editedAt).toBeTruthy()
  })
  test("update visibility", () => {
    const p = createPost("alice", "hello")
    expect(editPost(p, { visibility: "followers" }).visibility).toBe("followers")
  })
})

describe("getPostsByAuthor", () => {
  test("returns posts by author sorted newest first", () => {
    const posts = [createPost("alice", "first"), createPost("bob", "bob post"), sleepSort(createPost("alice", "second"), 1)]
    const result = getPostsByAuthor(posts, "alice")
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("second")
  })
})

describe("getPostsByHashtag", () => {
  test("returns posts with matching hashtag", () => {
    const posts = [createPost("a", "#codex post"), createPost("b", "#dharma post")]
    expect(getPostsByHashtag(posts, "codex")).toHaveLength(1)
  })
})

// ── Comments ─────────────────────────────────────────────────────────────

describe("createComment", () => {
  test("creates top-level comment", () => {
    const c = createComment("post-1", "alice", "Nice post!")
    expect(c.postId).toBe("post-1")
    expect(c.authorId).toBe("alice")
    expect(c.parentCommentId).toBeNull()
  })
  test("creates reply to comment", () => {
    const c = createComment("post-1", "alice", "Reply", "parent-1")
    expect(c.parentCommentId).toBe("parent-1")
  })
  test("applies signature", () => {
    const c = createComment("p1", "a", "text", null, (j) => `sig:${j.length}`)
    expect(c.signature).toContain("sig:")
  })
})

describe("getCommentsForPost", () => {
  test("returns comments for a post chronological", () => {
    const c1 = createComment("post-1", "alice", "first")
    const c2 = createComment("post-1", "bob", "second")
    const c3 = createComment("post-2", "alice", "other")
    const result = getCommentsForPost([c1, c2, c3], "post-1")
    expect(result).toHaveLength(2)
  })
})

describe("getThreadedComments", () => {
  test("returns root comments with replies nested", () => {
    const root = createComment("p1", "alice", "root")
    const reply = createComment("p1", "bob", "reply", root.commentId)
    const result = getThreadedComments([root, reply], "p1")
    expect(result).toHaveLength(2)
    expect(result[0].commentId).toBe(root.commentId)
    expect(result[1].commentId).toBe(reply.commentId)
  })
})

// ── Trends ───────────────────────────────────────────────────────────────

describe("computeTrends", () => {
  test("computes trends from posts within window", () => {
    const posts = [createPost("a", "#tech post"), createPost("b", "#tech another"), createPost("c", "#art post")]
    const trends = computeTrends(posts, 86400000)
    expect(trends).toHaveLength(2)
    const tech = trends.find((t) => t.topic === "tech")
    expect(tech!.postCount).toBe(2)
    expect(tech!.uniqueAuthors).toBe(2)
    const art = trends.find((t) => t.topic === "art")
    expect(art!.postCount).toBe(1)
  })
})

describe("getTrendingTopics", () => {
  test("returns top N topics", () => {
    const posts = Array.from({ length: 10 }, (_, i) => createPost("a", `#topic${i} post`))
    expect(getTrendingTopics(posts, 3)).toHaveLength(3)
  })
})

// ── Feed Filtering ───────────────────────────────────────────────────────

describe("buildFilteredFeed", () => {
  test("returns all posts chronological by default", () => {
    const posts = [createPost("a", "first"), createPost("b", "second")]
    const feed = buildFilteredFeed(posts)
    expect(feed).toHaveLength(2)
  })
  test("filters by authors", () => {
    const posts = [createPost("alice", "hello"), createPost("bob", "world")]
    expect(buildFilteredFeed(posts, { authors: ["alice"] })).toHaveLength(1)
  })
  test("filters by topics", () => {
    const posts = [createPost("a", "#tech post"), createPost("b", "#art post")]
    expect(buildFilteredFeed(posts, { topics: ["tech"] })).toHaveLength(1)
  })
  test("filters by sinceTimestamp", () => {
    // Create posts with explicit timestamp ordering
    const old = { ...createPost("a", "old"), timestamp: "2020-01-01T00:00:00.000Z" }
    const now = createPost("a", "new")
    expect(buildFilteredFeed([old, now], { sinceTimestamp: now.timestamp })).toHaveLength(1)
  })
})

// ── SFW Screening ────────────────────────────────────────────────────────

describe("sfwScreenPost", () => {
  test("passes clean content", () => {
    const result = sfwScreenPost("Hello world")
    expect(result.verdict).toBe("pass")
  })

  test("passes news discussion freely", () => {
    expect(sfwScreenPost("mass shooting in Chicago yesterday").verdict).toBe("pass")
    expect(sfwScreenPost("school shooting drill at my kid's school").verdict).toBe("pass")
    expect(sfwScreenPost("article about the beheading incident").verdict).toBe("pass")
    expect(sfwScreenPost("porn regulation debate in congress").verdict).toBe("pass")
    expect(sfwScreenPost("nsfw content detection paper").verdict).toBe("pass")
    expect(sfwScreenPost("drug policy reform discussion").verdict).toBe("pass")
  })

  test("fails hate speech attacks", () => {
    expect(sfwScreenPost("that person is a nigger").verdict).toBe("fail_text")
    expect(sfwScreenPost("you faggot").verdict).toBe("fail_text")
  })

  test("passes hate speech quoted in news context", () => {
    expect(sfwScreenPost("news article reported the man used the n-word").verdict).toBe("pass")
  })

  test("sfwCheckContent returns boolean", () => {
    expect(sfwCheckContent("clean content")).toBe(true)
    expect(sfwCheckContent("that person is a nigger")).toBe(false)
  })
})

// ── Likes ────────────────────────────────────────────────────────────────

describe("likePost", () => {
  test("creates a like", () => {
    const l = likePost("alice", "post-1")
    expect(l.userId).toBe("alice")
    expect(l.postId).toBe("post-1")
    expect(l.likeId).toBeTruthy()
  })
})

describe("unlikePost", () => {
  test("removes like", () => {
    const likes = [likePost("alice", "p1"), likePost("bob", "p1")]
    expect(unlikePost(likes, "alice", "p1")).toHaveLength(1)
  })
})

describe("getLikesForPost", () => {
  test("returns likes for post", () => {
    const likes = [likePost("a", "p1"), likePost("b", "p1"), likePost("a", "p2")]
    expect(getLikesForPost(likes, "p1")).toHaveLength(2)
  })
})

describe("getLikeCount", () => {
  test("counts likes for post", () => {
    const likes = [likePost("a", "p1"), likePost("b", "p1")]
    expect(getLikeCount(likes, "p1")).toBe(2)
    expect(getLikeCount(likes, "p2")).toBe(0)
  })
})

// ── Shares ───────────────────────────────────────────────────────────────

describe("sharePost", () => {
  test("shares a post with optional message", () => {
    const s = sharePost("alice", "post-1", "great fix")
    expect(s.userId).toBe("alice")
    expect(s.postId).toBe("post-1")
    expect(s.message).toBe("great fix")
  })
  test("shares without message", () => {
    const s = sharePost("alice", "post-1")
    expect(s.message).toBe("")
  })
})

describe("unsharePost", () => {
  test("removes share", () => {
    const shares = [sharePost("a", "p1"), sharePost("b", "p1")]
    expect(unsharePost(shares, "a", "p1")).toHaveLength(1)
  })
})

describe("getSharesForPost", () => {
  test("returns shares for post", () => {
    const shares = [sharePost("a", "p1"), sharePost("b", "p1")]
    expect(getSharesForPost(shares, "p1")).toHaveLength(2)
  })
})

describe("getShareCount", () => {
  test("counts shares", () => {
    const shares = [sharePost("a", "p1"), sharePost("b", "p1")]
    expect(getShareCount(shares, "p1")).toBe(2)
  })
})

// ── Curated Lists ────────────────────────────────────────────────────────

describe("createCuratedList", () => {
  test("creates empty list", () => {
    const l = createCuratedList("alice", "ML Engineers")
    expect(l.creatorId).toBe("alice")
    expect(l.name).toBe("ML Engineers")
    expect(l.memberIds).toEqual([])
  })
})

describe("addToList / removeFromList", () => {
  test("adds and removes members", () => {
    let l = createCuratedList("alice", "Devs")
    l = addToList(l, "bob")
    expect(l.memberIds).toContain("bob")
    l = addToList(l, "charlie")
    expect(l.memberIds).toHaveLength(2)
    l = removeFromList(l, "bob")
    expect(l.memberIds).toHaveLength(1)
    expect(l.memberIds).toContain("charlie")
  })
  test("addToList is idempotent", () => {
    let l = addToList(createCuratedList("a", "name"), "bob")
    l = addToList(l, "bob")
    expect(l.memberIds).toHaveLength(1)
  })
})

describe("filterPostsByLists", () => {
  test("returns only posts from list members", () => {
    let list = createCuratedList("alice", "Trusted")
    list = addToList(list, "bob")
    list = addToList(list, "charlie")
    const posts = [createPost("alice", "post by list owner"), createPost("bob", "post by member"), createPost("eve", "post by non-member")]
    const filtered = filterPostsByLists(posts, [list])
    expect(filtered).toHaveLength(1)  // only bob is in the list
    expect(filtered[0].authorId).toBe("bob")
  })
  test("includes list owner's posts when owner is in the list", () => {
    let list = createCuratedList("alice", "Team")
    list = addToList(list, "alice")  // owner adds themselves
    list = addToList(list, "bob")
    const posts = [createPost("alice", "owner post"), createPost("bob", "member post")]
    expect(filterPostsByLists(posts, [list])).toHaveLength(2)
  })
  test("returns empty for empty lists", () => {
    const posts = [createPost("a", "post")]
    expect(filterPostsByLists(posts, [createCuratedList("a", "empty")])).toHaveLength(0)
  })
})

// ── Custom Feeds (Bluesky-style) ─────────────────────────────────────────

describe("createFeedDefinition", () => {
  test("creates feed with filter", () => {
    const feed = createFeedDefinition("alice", "ML Papers", { topics: ["ml", "deep-learning"], algorithm: "chronological" })
    expect(feed.name).toBe("ML Papers")
    expect(feed.filter.topics).toContain("ml")
    expect(feed.filter.algorithm).toBe("chronological")
    expect(feed.subscribedByIds).toEqual([])
  })
})

describe("subscribeToFeed / unsubscribeFromFeed", () => {
  test("subscribe and unsubscribe", () => {
    let feed = createFeedDefinition("alice", "My Feed", {})
    feed = subscribeToFeed(feed, "bob")
    expect(feed.subscribedByIds).toContain("bob")
    feed = subscribeToFeed(feed, "charlie")
    expect(feed.subscribedByIds).toHaveLength(2)
    feed = unsubscribeFromFeed(feed, "bob")
    expect(feed.subscribedByIds).toHaveLength(1)
    expect(feed.subscribedByIds).toContain("charlie")
  })
  test("subscribe is idempotent", () => {
    let feed = subscribeToFeed(createFeedDefinition("a", "F", {}), "bob")
    feed = subscribeToFeed(feed, "bob")
    expect(feed.subscribedByIds).toHaveLength(1)
  })
})

describe("getFeedsWithSubscriber", () => {
  test("returns feeds a user is subscribed to", () => {
    const feeds = [subscribeToFeed(createFeedDefinition("a", "F1", {}), "bob"), createFeedDefinition("a", "F2", {})]
    expect(getFeedsWithSubscriber(feeds, "bob")).toHaveLength(1)
  })
})

describe("applyFeedToPosts", () => {
  test("applies feed filter to posts", () => {
    const feed = createFeedDefinition("alice", "Tech Feed", { topics: ["tech"] })
    const posts = [createPost("a", "#tech post"), createPost("b", "#art post")]
    expect(applyFeedToPosts(feed, posts)).toHaveLength(1)
  })
})
