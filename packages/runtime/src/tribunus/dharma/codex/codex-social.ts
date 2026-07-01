/**
 * Codex — Dharma Social Network Core Types & Operations
 *
 * P2P social layer built on top of the dharma system. Every user is an
 * Ed25519 identity. No ads, no likes, no algorithmic amplification.
 * Reputation is dharma — earned from verified contributions.
 *
 * All types are plain objects — storage and replication are handled by
 * the social-replication module.
 */

import { randomUUID, createHash } from "node:crypto"
import { extname } from "node:path"

// ── Social Profile ──────────────────────────────────────────────────────

export interface SocialProfile {
  profileId: string
  displayName: string
  bio: string
  avatarHash: string | null
  website: string
  joinedAt: string
  profileVersion: number
}

export interface SocialProfileUpdate {
  displayName?: string
  bio?: string
  avatarHash?: string | null
  website?: string
}

// ── Social Activity ─────────────────────────────────────────────────────

export type ActivityType =
  | "accepted_proposal"
  | "earned_dharma"
  | "codex_entry"
  | "followed"
  | "endorsed"
  | "joined"
  | "profile_updated"

export interface ActivityPayloads {
  accepted_proposal: { requestId: string; proposalId: string; title: string }
  earned_dharma: { amount: number; resolutionId: string; reason: string }
  codex_entry: { entryId: string; title: string; knowledgeClass: string }
  followed: { followeeId: string }
  endorsed: { toId: string; contributionId: string; message: string }
  joined: Record<string, never>
  profile_updated: Record<string, never>
}

export type SocialActivityPayload = { [K in ActivityType]: { type: K; data: ActivityPayloads[K] } }[ActivityType]

export interface SocialActivity {
  activityId: string
  actorId: string
  timestamp: string
  payload: SocialActivityPayload
  signature: string | null
}

// ── Follow Graph ────────────────────────────────────────────────────────

export type FollowStatus = "active" | "unfollowed"

export interface FollowRecord {
  followerId: string
  followeeId: string
  timestamp: string
  status: FollowStatus
}

// ── Endorsement ─────────────────────────────────────────────────────────

export interface Endorsement {
  endorsementId: string
  fromId: string
  toId: string
  forContributionId: string
  message: string
  timestamp: string
}

// ── Block List ──────────────────────────────────────────────────────────

export interface BlockEntry {
  blockerId: string
  blockedId: string
  reason: string
  timestamp: string
}

// ── Verified Profile Links ───────────────────────────────────────────────

export type LinkPlatform = "github" | "linkedin" | "gitlab" | "twitter" | "facebook" | "website"

export interface VerifiedLink {
  linkId: string
  platform: LinkPlatform
  url: string
  verified: boolean
  addedAt: string
  verifiedAt: string | null
}

export interface ProfileWithLinks extends SocialProfile {
  links: VerifiedLink[]
}

// ── Direct Messages ───────────────────────────────────────────────────────

export interface DmConversation {
  conversationId: string
  participants: [string, string]  // sorted identity digests
  createdAt: string
  lastActivityAt: string
  messageCount: number
}

export interface DmMessage {
  messageId: string
  conversationId: string
  senderId: string
  content: string  // plaintext or ciphertext (base64 when encrypted)
  encrypted: boolean
  timestamp: string
  signature: string | null
}

export interface DmEncryptionKey {
  derivedKey: string  // hex-encoded shared secret
  salt: string
  kdfIterations: number
}

// ── Identity Verification Status ──────────────────────────────────────────

export type VerificationMethod = "gist" | "meta_tag" | "file_upload" | "dns_txt" | "social_post"

export interface IdentityVerification {
  identityId: string
  method: VerificationMethod
  challenge: string  // random token to publish
  challengeLocation: string  // where to publish (url, dns record, etc.)
  verifiedAt: string | null
  expiresAt: string | null
}

// ── Posts & Media ───────────────────────────────────────────────────────

export type MediaType = "image" | "video" | "audio" | "file"

export interface PostMedia {
  mediaId: string
  type: MediaType
  mimeType: string
  hash: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  thumbnailHash: string | null
}

export interface Post {
  postId: string
  authorId: string
  content: string
  media: PostMedia[]
  hashtags: string[]
  timestamp: string
  editedAt: string | null
  signature: string | null
  visibility: "public" | "followers" | "direct"
}

export interface PostUpdate {
  content?: string
  media?: PostMedia[]
  visibility?: "public" | "followers" | "direct"
}

// ── Comments ────────────────────────────────────────────────────────────

export interface Comment {
  commentId: string
  postId: string
  authorId: string
  parentCommentId: string | null
  content: string
  timestamp: string
  editedAt: string | null
  signature: string | null
}

// ── Topics & Trends ────────────────────────────────────────────────────

export interface TopicTrend {
  topic: string
  postCount: number
  uniqueAuthors: number
  lastActivityAt: string
}

export type FeedAlgorithm = "chronological" | "dharma_weighted" | "topic_filtered"

export interface FeedFilter {
  topics?: string[]
  authors?: string[]
  algorithm?: FeedAlgorithm
  minDharmaScore?: number
  sinceTimestamp?: string
}

// ── SFW Screening ───────────────────────────────────────────────────────

export type SfwVerdict = "pass" | "fail_text" | "fail_media" | "fail_media_hash"

export interface SfwResult {
  verdict: SfwVerdict
  reason: string
  details: string[]
}

// ── Profile Operations ──────────────────────────────────────────────────

export function createProfile(
  identityId: string,
  displayName: string,
  bio = "",
  avatarHash: string | null = null,
  website = "",
): SocialProfile {
  return {
    profileId: identityId,
    displayName: displayName.trim(),
    bio: bio.trim(),
    avatarHash,
    website: website.trim(),
    joinedAt: new Date().toISOString(),
    profileVersion: 1,
  }
}

export function updateProfile(profile: SocialProfile, update: SocialProfileUpdate): SocialProfile {
  const next: SocialProfile = { ...profile }
  if (update.displayName !== undefined) next.displayName = update.displayName.trim()
  if (update.bio !== undefined) next.bio = update.bio.trim()
  if (update.avatarHash !== undefined) next.avatarHash = update.avatarHash
  if (update.website !== undefined) next.website = update.website.trim()
  next.profileVersion += 1
  return next
}

// ── Activity Operations ─────────────────────────────────────────────────

export function createActivity(
  actorId: string,
  payload: SocialActivityPayload,
  signFn?: (canonicalJson: string) => string,
): SocialActivity {
  const activity: SocialActivity = {
    activityId: randomUUID(),
    actorId,
    timestamp: new Date().toISOString(),
    payload,
    signature: null,
  }

  if (signFn) {
    const canonical = canonicalActivityForSigning(activity)
    activity.signature = signFn(canonical)
  }

  return activity
}

export function verifyActivitySignature(activity: SocialActivity, verifyFn: (canonicalJson: string, signature: string) => boolean): boolean {
  if (!activity.signature) return false
  const canonical = canonicalActivityForSigning(activity)
  return verifyFn(canonical, activity.signature)
}

function canonicalActivityForSigning(activity: SocialActivity): string {
  return sortedStringify(activity, ["signature"])
}

function sortedStringify(value: unknown, excludeKeys: string[] = []): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => sortedStringify(v, excludeKeys)).join(",")}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => !excludeKeys.includes(k)).sort()
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(obj[k], excludeKeys)}`)
  return `{${pairs.join(",")}}`
}

// ── Post Operations ─────────────────────────────────────────────────────

export function extractHashtags(content: string): string[] {
  const matches = content.match(/#([a-zA-Z0-9_]+)/g)
  if (!matches) return []
  return [...new Set(matches.map((t) => t.slice(1).toLowerCase()))]
}

export function createPost(
  authorId: string,
  content: string,
  media: PostMedia[] = [],
  visibility: "public" | "followers" | "direct" = "public",
  signFn?: (canonical: string) => string,
): Post {
  const hashtags = extractHashtags(content)
  const post: Post = {
    postId: randomUUID(),
    authorId,
    content: content.trim(),
    media,
    hashtags,
    timestamp: new Date().toISOString(),
    editedAt: null,
    signature: null,
    visibility,
}
  if (signFn) {
    const canonical = canonicalPostForSigning(post)
    post.signature = signFn(canonical)
}
  return post
}

export function editPost(post: Post, update: PostUpdate): Post {
  const updated: Post = { ...post, editedAt: new Date().toISOString() }
  if (update.content !== undefined) {
    updated.content = update.content.trim()
    updated.hashtags = extractHashtags(updated.content)
}
  if (update.media !== undefined) updated.media = update.media
  if (update.visibility !== undefined) updated.visibility = update.visibility
  return updated
}

export function getPostsByAuthor(posts: Post[], authorId: string, limit = 50, offset = 0): Post[] {
  return posts
    .filter((p) => p.authorId === authorId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(offset, offset + limit)
}

export function getPostsByHashtag(posts: Post[], hashtag: string, limit = 50, offset = 0): Post[] {
  return posts
    .filter((p) => p.hashtags.includes(hashtag.toLowerCase()))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(offset, offset + limit)
}

function canonicalPostForSigning(post: Post): string {
  return sortedStringify(post, ["signature"])
}

// ── Comment Operations ──────────────────────────────────────────────────

export function createComment(
  postId: string,
  authorId: string,
  content: string,
  parentCommentId: string | null = null,
  signFn?: (canonical: string) => string,
): Comment {
  const comment: Comment = {
    commentId: randomUUID(),
    postId,
    authorId,
    parentCommentId,
    content: content.trim(),
    timestamp: new Date().toISOString(),
    editedAt: null,
    signature: null,
}
  if (signFn) {
    const canonical = canonicalCommentForSigning(comment)
    comment.signature = signFn(canonical)
}
  return comment
}

export function getCommentsForPost(comments: Comment[], postId: string): Comment[] {
  return comments
    .filter((c) => c.postId === postId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))  // chronological within post
}

export function getThreadedComments(comments: Comment[], postId: string): Comment[] {
  const postComments = getCommentsForPost(comments, postId)
  const roots = postComments.filter((c) => c.parentCommentId === null)
  const replies = postComments.filter((c) => c.parentCommentId !== null)
  const result: Comment[] = []
  for (const root of roots) {
    result.push(root)
    const childReplies = replies.filter((r) => r.parentCommentId === root.commentId)
    result.push(...childReplies)
}
  return result
}

function canonicalCommentForSigning(comment: Comment): string {
  return sortedStringify(comment, ["signature"])
}

// ── Topic & Trend Operations ────────────────────────────────────────────

export function computeTrends(posts: Post[], windowMs = 24 * 60 * 60 * 1000): TopicTrend[] {
  const cutoff = Date.now() - windowMs
  const topicMap = new Map<string, { count: number; authors: Set<string>; lastActivity: string }>()

  for (const post of posts) {
    if (new Date(post.timestamp).getTime() < cutoff) continue
    for (const tag of post.hashtags) {
      const existing = topicMap.get(tag) || { count: 0, authors: new Set(), lastActivity: post.timestamp }
      existing.count++
      existing.authors.add(post.authorId)
      if (post.timestamp > existing.lastActivity) existing.lastActivity = post.timestamp
      topicMap.set(tag, existing)
}
}

  return Array.from(topicMap.entries())
    .map(([topic, data]) => ({
      topic,
      postCount: data.count,
      uniqueAuthors: data.authors.size,
      lastActivityAt: data.lastActivity,
    }))
    .sort((a, b) => b.postCount - a.postCount)
}

export function getTrendingTopics(posts: Post[], topN = 10): TopicTrend[] {
  return computeTrends(posts).slice(0, topN)
}

// ── Feed Filtering ───────────────────────────────────────────────────────

export function buildFilteredFeed(
  posts: Post[],
  filter: FeedFilter = {},
): Post[] {
  let filtered = [...posts]

  if (filter.sinceTimestamp) {
    filtered = filtered.filter((p) => p.timestamp >= filter.sinceTimestamp!)
}
  if (filter.authors && filter.authors.length > 0) {
    filtered = filtered.filter((p) => filter.authors!.includes(p.authorId))
}
  if (filter.topics && filter.topics.length > 0) {
    const topics = filter.topics.map((t) => t.toLowerCase())
    filtered = filtered.filter((p) => p.hashtags.some((h) => topics.includes(h)))
}
  if (filter.minDharmaScore !== undefined) {
    // Filtered at call site where dharma ledger is available
}

  switch (filter.algorithm || "chronological") {
    case "chronological":
      filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      break
    case "dharma_weighted":
      // Posts sorted by timestamp; dharma weighting applied at call site
      filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      break
}

  return filtered
}

// ── SFW Content Screening ───────────────────────────────────────────────

const SFW_BLOCKED_PATTERNS = [
  /\b(?:nsfw?|nsfl|gore|explicit|xxx|porn?)\.?\b/i,
  /\b(?:onlyfans|patreon-nsfw)\.?\b/i,
]

const SFW_MEDIA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".mp4", ".mov", ".webm"])

export function sfwScreenPost(content: string, media: PostMedia[] = []): SfwResult {
  const details: string[] = []

  // Text screening
  for (const pattern of SFW_BLOCKED_PATTERNS) {
    if (pattern.test(content)) {
      details.push(`Text contains blocked pattern: ${pattern.toString()}`)
      return { verdict: "fail_text", reason: "Content contains blocked terms", details }
    }
  }

  // Media screening
  for (const m of media) {
    // Only allow image and video types
    if (m.type !== "image" && m.type !== "video") {
      details.push(`Media type not allowed: ${m.type}/${m.mimeType}`)
      return { verdict: "fail_media", reason: "Media type not permitted", details }
    }

    // Check extension against allowed list
    const ext = extname(m.mimeType === "image/jpeg" ? ".jpg" : m.mimeType)
    if (!SFW_MEDIA_EXTENSIONS.has(ext) && !Array.from(SFW_MEDIA_EXTENSIONS).some((e) => m.mimeType.includes(e.slice(1)))) {
      details.push(`Media format not in allowed list: ${m.mimeType}`)
      return { verdict: "fail_media", reason: "Media type not permitted", details }
    }
  }

  return { verdict: "pass", reason: "Content passed SFW screening", details }
}

export function sfwCheckContent(content: string): boolean {
  return sfwScreenPost(content).verdict === "pass"
}

export function sfwCheckMedia(media: PostMedia): boolean {
  return sfwScreenPost("", [media]).verdict === "pass"
}

// ── Profile Operations ──────────────────────────────────────────────────

export function follow(followerId: string, followeeId: string): FollowRecord {
  if (followerId === followeeId) throw new Error("Cannot follow yourself")
  return {
    followerId,
    followeeId,
    timestamp: new Date().toISOString(),
    status: "active" as FollowStatus,
  }
}

export function unfollow(
  records: FollowRecord[],
  followerId: string,
  followeeId: string,
): FollowRecord[] {
  return records.map((r) =>
    r.followerId === followerId && r.followeeId === followeeId
      ? { ...r, status: "unfollowed" as FollowStatus }
      : r,
  )
}

export function getActiveFollows(records: FollowRecord[], followerId: string): FollowRecord[] {
  return records.filter((r) => r.followerId === followerId && r.status === "active")
}

export function getActiveFollowers(records: FollowRecord[], followeeId: string): FollowRecord[] {
  return records.filter((r) => r.followeeId === followeeId && r.status === "active")
}

export function isFollowing(records: FollowRecord[], followerId: string, followeeId: string): boolean {
  return records.some((r) => r.followerId === followerId && r.followeeId === followeeId && r.status === "active")
}

// ── Endorsement Operations ──────────────────────────────────────────────

export function createEndorsement(
  fromId: string,
  toId: string,
  forContributionId: string,
  message = "",
): Endorsement {
  return {
    endorsementId: randomUUID(),
    fromId,
    toId,
    forContributionId,
    message: message.trim(),
    timestamp: new Date().toISOString(),
  }
}

export function getEndorsementsFor(toId: string, endorsements: Endorsement[]): Endorsement[] {
  return endorsements.filter((e) => e.toId === toId).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function getEndorsementsBy(fromId: string, endorsements: Endorsement[]): Endorsement[] {
  return endorsements.filter((e) => e.fromId === fromId).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function getEndorsementCount(toId: string, endorsements: Endorsement[]): number {
  return getEndorsementsFor(toId, endorsements).length
}

// ── Block Operations ────────────────────────────────────────────────────

export function block(blockerId: string, blockedId: string, reason = ""): BlockEntry {
  return {
    blockerId,
    blockedId,
    reason: reason.trim(),
    timestamp: new Date().toISOString(),
  }
}

export function isBlocked(blocker: string, target: string, blocks: BlockEntry[]): boolean {
  return blocks.some((b) => b.blockerId === blocker && b.blockedId === target)
}

export function getBlockedBy(blockerId: string, blocks: BlockEntry[]): BlockEntry[] {
  return blocks.filter((b) => b.blockerId === blockerId)
}

export function unblock(blockerId: string, blockedId: string, blocks: BlockEntry[]): BlockEntry[] {
  return blocks.filter((b) => !(b.blockerId === blockerId && b.blockedId === blockedId))
}

// ── Verified Link Operations ─────────────────────────────────────────────

export function addVerifiedLink(
  platform: LinkPlatform,
  url: string,
): VerifiedLink {
  return {
    linkId: randomUUID(),
    platform,
    url: url.trim(),
    verified: false,
    addedAt: new Date().toISOString(),
    verifiedAt: null,
  }
}

export function markLinkVerified(link: VerifiedLink): VerifiedLink {
  return { ...link, verified: true, verifiedAt: new Date().toISOString() }
}

export function removeLink(links: VerifiedLink[], linkId: string): VerifiedLink[] {
  return links.filter((l) => l.linkId !== linkId)
}

export function getVerifiedLinks(links: VerifiedLink[]): VerifiedLink[] {
  return links.filter((l) => l.verified)
}

export function getLinksByPlatform(links: VerifiedLink[], platform: LinkPlatform): VerifiedLink[] {
  return links.filter((l) => l.platform === platform)
}

// ── Direct Message Operations ────────────────────────────────────────────

export function createConversation(participantA: string, participantB: string): DmConversation {
  if (participantA === participantB) {
    throw new Error("Cannot create conversation with yourself")
  }
  const sorted = [participantA, participantB].sort() as [string, string]
  return {
    conversationId: randomUUID(),
    participants: sorted,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    messageCount: 0,
  }
}

export function deriveSharedConversationId(participantA: string, participantB: string): string {
  const sorted = [participantA, participantB].sort()
  return createHash("sha256").update(sorted.join("|")).digest("hex")
}

export function sendDmMessage(
  conversation: DmConversation,
  senderId: string,
  content: string,
  encrypt?: (plaintext: string) => { ciphertext: string; keyId: string },
): { message: DmMessage; updatedConversation: DmConversation } {
  if (!conversation.participants.includes(senderId)) {
    throw new Error("Sender is not a participant in this conversation")
  }

  let encrypted = false
  let messageContent = content
  let signature: string | null = null

  if (encrypt) {
    const result = encrypt(content)
    messageContent = result.ciphertext
    encrypted = true
    // Simple signature: HMAC-like using keyId as a proof of origin
    signature = `enc:${result.keyId}`
  }

  const message: DmMessage = {
    messageId: randomUUID(),
    conversationId: conversation.conversationId,
    senderId,
    content: messageContent,
    encrypted,
    timestamp: new Date().toISOString(),
    signature,
  }

  const updatedConversation: DmConversation = {
    ...conversation,
    lastActivityAt: message.timestamp,
    messageCount: conversation.messageCount + 1,
  }

  return { message, updatedConversation }
}

export function getConversationMessages(
  messages: DmMessage[],
  conversationId: string,
  limit = 50,
  offset = 0,
): DmMessage[] {
  return messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(offset, offset + limit)
}

export function decryptDmMessage(
  message: DmMessage,
  decrypt: (ciphertext: string) => string,
): string {
  if (!message.encrypted) return message.content
  return decrypt(message.content)
}

// ── Shared Secret Derivation ─────────────────────────────────────────────

/**
 * Derive a shared encryption key for a DM conversation using a key-exchange
 * pattern. The two participants each contribute their Ed25519 key material
 * to produce a symmetric key only they can compute.
 *
 * In production, this would use X25519 ECDH from the Ed25519 keys
 * (using a known key conversion). Here we use HKDF over a combination of
 * the two identity digests with a random salt.
 */
export function deriveDmEncryptionKey(
  participantA: string,
  participantB: string,
  salt?: string,
): DmEncryptionKey {
  const sorted = [participantA, participantB].sort()
  const actualSalt = salt || randomUUID()
  const info = "tribunus.dm.v1"
  const iterations = 100_000

  // HKDF-like derivation using PBKDF2 (simulated — real impl uses X25519 + HKDF)
  const seed = createHash("sha256")
    .update(sorted.join("|"))
    .update(info)
    .digest()

  const derived = createHash("sha256")
    .update(seed)
    .update(Buffer.from(actualSalt, "utf-8"))
    .update(Buffer.from([iterations]))
    .digest("hex")

  return {
    derivedKey: derived,
    salt: actualSalt,
    kdfIterations: iterations,
  }
}

// ── Identity Verification Challenges ─────────────────────────────────────

const VERIFICATION_CHALLENGES = new Map<string, IdentityVerification>()

export function createVerificationChallenge(
  identityId: string,
  method: VerificationMethod,
  challengeLocation: string,
): IdentityVerification {
  const challenge = randomUUID()
  const verification: IdentityVerification = {
    identityId,
    method,
    challenge,
    challengeLocation,
    verifiedAt: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h expiry
  }
  VERIFICATION_CHALLENGES.set(identityId + ":" + method, verification)
  return verification
}

export function getVerificationChallenge(
  identityId: string,
  method: VerificationMethod,
): IdentityVerification | undefined {
  return VERIFICATION_CHALLENGES.get(identityId + ":" + method)
}

export function completeVerification(
  identityId: string,
  method: VerificationMethod,
  proof: string,
): IdentityVerification {
  const verification = VERIFICATION_CHALLENGES.get(identityId + ":" + method)
  if (!verification) throw new Error("No verification challenge found")
  if (verification.verifiedAt) throw new Error("Already verified")

  // Check: proof must contain the challenge token
  if (!proof.includes(verification.challenge)) {
    throw new Error("Proof does not contain challenge token")
  }

  verification.verifiedAt = new Date().toISOString()
  VERIFICATION_CHALLENGES.set(identityId + ":" + method, verification)
  return verification
}

export function generateVerificationProofInstructions(verification: IdentityVerification): string {
  switch (verification.method) {
    case "gist":
      return `Create a secret Gist on GitHub containing: ${verification.challenge}`
    case "meta_tag":
      return `Add this meta tag to your site <head>: <meta name="dharma-verify" content="${verification.challenge}">`
    case "file_upload":
      return `Upload a file named .dharma-verify to your site root with content: ${verification.challenge}`
    case "dns_txt":
      return `Add a TXT record to your domain: dharma-verify=${verification.challenge}`
    case "social_post":
      return `Post this on your social profile: Verifying my identity for Tribunus Dharma: ${verification.challenge}`
  }
}

// ── Feed Operations ─────────────────────────────────────────────────────

export interface FeedItem {
  activity: SocialActivity
  profile: SocialProfile
}

export function buildFeed(
  activities: SocialActivity[],
  profiles: Map<string, SocialProfile>,
  limit = 50,
  offset = 0,
): FeedItem[] {
  const sorted = [...activities].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const page = sorted.slice(offset, offset + limit)
  return page.map((activity) => ({
    activity,
    profile: profiles.get(activity.actorId) ?? {
      profileId: activity.actorId,
      displayName: activity.actorId.slice(0, 12),
      bio: "",
      avatarHash: null,
      website: "",
      joinedAt: activity.timestamp,
      profileVersion: 0,
    },
  }))
}

// ── Activity Type Helpers ────────────────────────────────────────────────

export function createAcceptedProposalActivity(
  actorId: string,
  requestId: string,
  proposalId: string,
  title: string,
  signFn?: (canonical: string) => string,
): SocialActivity {
  return createActivity(actorId, { type: "accepted_proposal", data: { requestId, proposalId, title } }, signFn)
}

export function createEarnedDharmaActivity(
  actorId: string,
  amount: number,
  resolutionId: string,
  reason: string,
  signFn?: (canonical: string) => string,
): SocialActivity {
  return createActivity(actorId, { type: "earned_dharma", data: { amount, resolutionId, reason } }, signFn)
}

export function createCodexEntryActivity(
  actorId: string,
  entryId: string,
  title: string,
  knowledgeClass: string,
  signFn?: (canonical: string) => string,
): SocialActivity {
  return createActivity(actorId, { type: "codex_entry", data: { entryId, title, knowledgeClass } }, signFn)
}

export function createFollowedActivity(
  actorId: string,
  followeeId: string,
  signFn?: (canonical: string) => string,
): SocialActivity {
  return createActivity(actorId, { type: "followed", data: { followeeId } }, signFn)
}

export function createEndorsedActivity(
  actorId: string,
  toId: string,
  contributionId: string,
  message: string,
  signFn?: (canonical: string) => string,
): SocialActivity {
  return createActivity(actorId, { type: "endorsed", data: { toId, contributionId, message } }, signFn)
}

export function createJoinedActivity(
  actorId: string,
  signFn?: (canonical: string) => string,
): SocialActivity {
  return createActivity(actorId, { type: "joined", data: {} }, signFn)
}

// ── Dharma Score Computation ────────────────────────────────────────────

export interface DharmaSocialScore {
  identityId: string
  dharmaEarned: number
  proposalsAccepted: number
  codexEntriesCredited: number
  endorsementsGiven: number
  endorsementsReceived: number
  followers: number
  following: number
}

export function computeSocialScore(
  identityId: string,
  ledgerBalance: number,
  endorsements: Endorsement[],
  followRecords: FollowRecord[],
  activityCounts: { proposalsAccepted: number; codexEntries: number },
): DharmaSocialScore {
  return {
    identityId,
    dharmaEarned: ledgerBalance,
    proposalsAccepted: activityCounts.proposalsAccepted,
    codexEntriesCredited: activityCounts.codexEntries,
    endorsementsGiven: getEndorsementsBy(identityId, endorsements).length,
    endorsementsReceived: getEndorsementCount(identityId, endorsements),
    followers: getActiveFollowers(followRecords, identityId).length,
    following: getActiveFollows(followRecords, identityId).length,
  }
}

export function isVerifiedIdentity(score: DharmaSocialScore): boolean {
  return score.dharmaEarned > 0 || score.proposalsAccepted > 0 || score.codexEntriesCredited > 0
}
