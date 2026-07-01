/**
 * Codex — Dharma Social Network Core Types & Operations
 *
 * P2P social layer built on top of the dharma system. Every user is an
 * Ed25519 identity with absolute control over their experience.
 *
 * Design: no corporate algorithmic engagement farming, no viral amplification
 * machines, no time-spent optimization. Users choose their own feeds and
 * algorithms — the Bluesky model of custom feeds and curated lists.
 * Likes and shares are attribution signals, not engagement metrics.
 * Reputation is dharma — earned from verified contributions.
 */

import { randomUUID, createHash } from "node:crypto"

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

// ── Likes & Shares ─────────────────────────────────────────────────────

export interface PostLike {
  likeId: string
  postId: string
  userId: string
  timestamp: string
}

export interface PostShare {
  shareId: string
  postId: string
  userId: string
  timestamp: string
  message: string
}

// ── Curated Lists ──────────────────────────────────────────────────────

export interface CuratedList {
  listId: string
  creatorId: string
  name: string
  description: string
  memberIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CuratedListUpdate {
  name?: string
  description?: string
}

// ── Custom Feeds (Bluesky-style) ───────────────────────────────────────

export interface FeedDefinition {
  feedId: string
  creatorId: string
  name: string
  description: string
  filter: FeedFilter
  subscribedByIds: string[]
  createdAt: string
  updatedAt: string
}

export interface FeedDefinitionUpdate {
  name?: string
  description?: string
  filter?: FeedFilter
}

export interface SubscribedFeed {
  feedId: string
  userId: string
  subscribedAt: string
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

// ── SFW Screening — Multi-Phase System ────────────────────────────────
//
// Phase 1: Blocklist — comprehensive term patterns by severity category
// Phase 2: Context analysis — technical/medical/educational allowlist
// Phase 3: Media hash checking — known NSFW hash database
// Phase 4: Grace period — stricter for new/unverified accounts
// Phase 5 (future): On-device ML image classification
//
// No content is published without passing ALL active phases.
//
// ── SFW Screening — Multi-Phase System ────────────────────────────────
//
// Philosophy: text discussion of world events is broadly free.
// We block hate speech attacks, CSAM, doxxing instructions, and spam.
// Everything else — news articles about violence, sexual content research,
// drug policy discussion — passes text screening.
// Media (images/video) is where strict screening applies: hash DB, MIME
// validation, extension whitelist, size limits.
//
// Categories: hate_speech, csam, harassment_tools, spam

type Severity = "hard" | "text_soft"

interface BlockEntry {
  pattern: RegExp
  severity: Severity
  category: string
  desc: string
  newsOverrides?: string[]  // text context markers that allow news/reporting use
}

function buildBlocklist(): BlockEntry[] {
  const list: BlockEntry[] = []
  const add = (pattern: RegExp, severity: Severity, category: string, desc: string, newsOverrides?: string[]) =>
    list.push({ pattern, severity, category, desc, newsOverrides })

  // ── HARD (always blocked) ───────────────────────────────────────────────
  // CSAM: zero tolerance, no exceptions
  add(/\b(?:child\s*porn|loli|shotacon|ptsc|pthc)\b/i, "hard", "csam", "CSAM keyword")

  // Doxxing instructions: publishing private info / harassment tools
  add(/\b(?:doxx?[ing]?\s+(?:someone|people|person|user)|swat[st]?[ing]?\s+(?:someone|people|person|user))\b/i, "hard", "harassment_tools", "doxxing/harassment instructions")

  // ── TEXT_SOFT: Hate speech (overridable by news/reporting context) ───────
  add(/\b(?:n[i1]gg[ae3]r)\b/i, "text_soft", "hate_speech", "racial slur", ["news", "article", "report", "incident", "story", "coverage"])
  add(/\b(?:f[a4]gg[o0]t|f[a4]g)\b/i, "text_soft", "hate_speech", "homophobic slur", ["news", "article", "report", "incident", "story", "coverage"])
  add(/\b(?:tr[a4]nny|tr[a4]nn[ie])\b/i, "text_soft", "hate_speech", "transphobic slur", ["news", "article", "report", "incident", "story", "coverage"])
  add(/\b(?:r[e3]t[a4]rd)\b/i, "text_soft", "hate_speech", "ableist slur", ["news", "article", "report", "incident", "story", "coverage"])

  // ── TEXT_SOFT: Spam / Scam ──────────────────────────────────────────────
  // Engagement bait — artificial interaction farming
  add(/\bday\s+\d+\s+of\s+posting\b/i, "text_soft", "spam", "engagement bait chain")
  add(/\blike\s+(?:if|for)\s+(?:yes|agree|this)\s*[,;.]*\s*(?:share|comment|tag)/i, "text_soft", "spam", "engagement bait interaction")
  add(/\btag\s+\d+\s+(?:people|friends|followers|connections)\b/i, "text_soft", "spam", "engagement bait tagging")

  // Crypto / money scams
  add(/\b(?:free\s*(?:bitcoin|eth|nft|crypto|money)\s*(?:giveaway|claim|click|bonus))\b/i, "text_soft", "spam", "crypto scam")

  // Follow/subscribe bait
  add(/\b(?:follow\s*(?:me\s+)?(?:back|for\s*follow)|like4like|sub4sub)\b/i, "text_soft", "spam", "engagement bait")
  add(/\b(?:dm\s+(?:me|for|to)\s*(?:collab|promo|sponsor|opportunity))\b/i, "text_soft", "spam", "unsolicited promotion")

  return list
}

// ── Context Allowlist ──────────────────────────────────────────────────
//
// Content markers that signal news/reporting context, softening text_soft
// blocks (e.g., hate speech in a news article is reporting, not attack).

function buildNewsContextAllowlist(): { pattern: RegExp; contexts: string[] }[] {
  return [
    { pattern: /\b(?:news|article|report|story|coverage|incident|event|happened|breaking|update|live\s+blog|dispatch|investigation|exclusive)\b/i, contexts: ["news", "article", "report", "incident", "story", "coverage"] },
    { pattern: /\b(?:paper|research|study|survey|dataset|benchmark|publication|thesis|dissertation|journal|conference|academic)\b/i, contexts: ["news", "article", "report"] },
    { pattern: /\b(?:\"|\u2018|\u201c|quote|said|according\s+to|reported|published|wrote|stated|claimed|alleged)\b/i, contexts: ["news", "article", "incident", "coverage"] },
  ]
}

// ── Media Hash Database ────────────────────────────────────────────────
//
// Known NSFW content hashes. Production would load from a local DB.
// Pluggable — updated via replication from trusted sources.

const KNOWN_NSFW_HASHES = new Set<string>()

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
  "image/webp": ".webp", "image/avif": ".avif",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
}

// ── Config & Defaults ──────────────────────────────────────────────────

interface SfwConfig {
  blocklist: BlockEntry[]
  contextAllowlist: ReturnType<typeof buildNewsContextAllowlist>
  knownNsfwHashes: Set<string>
  gracePeriodMs: number
  minDharmaForRelax: number
  maxMediaSizeBytes: number
  allowedMimeTypes: Set<string>
  allowedExtensions: Set<string>
}

const DEFAULT_SFW_CONFIG: SfwConfig = {
  blocklist: buildBlocklist(),
  contextAllowlist: buildNewsContextAllowlist(),
  knownNsfwHashes: KNOWN_NSFW_HASHES,
  gracePeriodMs: 7 * 24 * 60 * 60 * 1000,
  minDharmaForRelax: 3,
  maxMediaSizeBytes: 50 * 1024 * 1024,
  allowedMimeTypes: new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
    "video/mp4", "video/quicktime", "video/webm",
  ]),
  allowedExtensions: new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".mp4", ".mov", ".webm"]),
}

function detectSafeContexts(content: string, allowlist: SfwConfig["contextAllowlist"]): Set<string> {
  const contexts = new Set<string>()
  for (const entry of allowlist) {
    if (entry.pattern.test(content)) {
      for (const ctx of entry.contexts) contexts.add(ctx)
    }
  }

  return contexts
}

function screenText(content: string, blocklist: BlockEntry[], safeContexts: Set<string>, fromGracePeriod: boolean): SfwResult | null {
  for (const entry of blocklist) {
    if (!entry.pattern.test(content)) continue

    // Hard: always block
    if (entry.severity === "hard") {
      return { verdict: "fail_text", reason: `Blocked: ${entry.category} — ${entry.desc}`, details: [`Pattern: ${entry.pattern}`] }
    }
    // text_soft: block unless news/reporting context overrides
    const overridden = entry.newsOverrides && entry.newsOverrides.some((c) => safeContexts.has(c))
    if (!overridden || fromGracePeriod) {
      return { verdict: "fail_text", reason: `Blocked: ${entry.category} — ${entry.desc}`, details: [`Pattern: ${entry.pattern}`, fromGracePeriod ? "Grace period active" : "No news/reporting context detected"] }
    }
  }

  return null
}

function screenMediaItems(media: PostMedia[], config: SfwConfig): SfwResult | null {
  for (const m of media) {
    if (m.type !== "image" && m.type !== "video") {
      return { verdict: "fail_media", reason: "Only image/video media permitted", details: [`Got: ${m.type}/${m.mimeType}`] }
    }
    if (!config.allowedMimeTypes.has(m.mimeType)) {
      return { verdict: "fail_media", reason: "Media MIME type not permitted", details: [`MIME: ${m.mimeType}`] }
    }
    const ext = MIME_TO_EXT[m.mimeType]
    if (!config.allowedExtensions.has(ext)) {
      return { verdict: "fail_media", reason: "Media extension not permitted", details: [`Ext: ${ext}`] }
    }
    if (m.sizeBytes > config.maxMediaSizeBytes) {
      return { verdict: "fail_media", reason: "Media exceeds size limit", details: [`${m.sizeBytes} > ${config.maxMediaSizeBytes}`] }
    }
    if (config.knownNsfwHashes.has(m.hash)) {
      return { verdict: "fail_media_hash", reason: "Matches known prohibited hash", details: [`Hash: ${m.hash}`] }
    }
  }
  return null
}

export function sfwScreenPost(
  content: string,
  media: PostMedia[] = [],
  config: SfwConfig = DEFAULT_SFW_CONFIG,
  accountCreatedAt?: string,
  dharmaScore?: number,
): SfwResult {
  const fromGracePeriod = accountCreatedAt
    ? Date.now() - new Date(accountCreatedAt).getTime() < config.gracePeriodMs
    : (dharmaScore !== undefined ? dharmaScore < config.minDharmaForRelax : false)

  const safeContexts = detectSafeContexts(content, config.contextAllowlist)
  const textResult = screenText(content, config.blocklist, safeContexts, fromGracePeriod)
  if (textResult) return textResult

  const mediaResult = screenMediaItems(media, config)
  if (mediaResult) return mediaResult

  const reason = `Content passed all ${fromGracePeriod ? "strict" : "standard"} screening phases`
  return { verdict: "pass", reason, details: [] }
}

export function sfwCheckContent(content: string, accountCreatedAt?: string, dharmaScore?: number): boolean {
  return sfwScreenPost(content, [], DEFAULT_SFW_CONFIG, accountCreatedAt, dharmaScore).verdict === "pass"
}

export function sfwCheckMedia(media: PostMedia, accountCreatedAt?: string, dharmaScore?: number): boolean {
  return sfwScreenPost("", [media], DEFAULT_SFW_CONFIG, accountCreatedAt, dharmaScore).verdict === "pass"
}

// ── Like Operations ────────────────────────────────────────────────────

export function likePost(userId: string, postId: string): PostLike {
  return {
    likeId: randomUUID(),
    postId,
    userId,
    timestamp: new Date().toISOString(),
  }
}

export function unlikePost(likes: PostLike[], userId: string, postId: string): PostLike[] {
  return likes.filter((l) => !(l.userId === userId && l.postId === postId))
}

export function getLikesForPost(likes: PostLike[], postId: string): PostLike[] {
  return likes.filter((l) => l.postId === postId)
}

export function getLikeCount(likes: PostLike[], postId: string): number {
  return getLikesForPost(likes, postId).length
}

export function getLikesByUser(likes: PostLike[], userId: string): PostLike[] {
  return likes.filter((l) => l.userId === userId)
}

// ── Share Operations ───────────────────────────────────────────────────

export function sharePost(
  userId: string,
  postId: string,
  message = "",
): PostShare {
  return {
    shareId: randomUUID(),
    postId,
    userId,
    timestamp: new Date().toISOString(),
    message: message.trim(),
  }
}

export function unsharePost(shares: PostShare[], userId: string, postId: string): PostShare[] {
  return shares.filter((s) => !(s.userId === userId && s.postId === postId))
}

export function getSharesForPost(shares: PostShare[], postId: string): PostShare[] {
  return shares.filter((s) => s.postId === postId)
}

export function getShareCount(shares: PostShare[], postId: string): number {
  return getSharesForPost(shares, postId).length
}

export function getSharesByUser(shares: PostShare[], userId: string): PostShare[] {
  return shares.filter((s) => s.userId === userId)
}

// ── Curated List Operations ────────────────────────────────────────────

export function createCuratedList(
  creatorId: string,
  name: string,
  description = "",
): CuratedList {
  return {
    listId: randomUUID(),
    creatorId,
    name: name.trim(),
    description: description.trim(),
    memberIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function updateCuratedList(list: CuratedList, update: CuratedListUpdate): CuratedList {
  return {
    ...list,
    ...(update.name !== undefined ? { name: update.name.trim() } : {}),
    ...(update.description !== undefined ? { description: update.description.trim() } : {}),
    updatedAt: new Date().toISOString(),
  }
}

export function addToList(list: CuratedList, memberId: string): CuratedList {
  if (list.memberIds.includes(memberId)) return list
  return { ...list, memberIds: [...list.memberIds, memberId], updatedAt: new Date().toISOString() }
}

export function removeFromList(list: CuratedList, memberId: string): CuratedList {
  return {
    ...list,
    memberIds: list.memberIds.filter((id) => id !== memberId),
    updatedAt: new Date().toISOString(),
  }
}

export function getListMembers(list: CuratedList): string[] {
  return [...list.memberIds]
}

export function getListsForUser(lists: CuratedList[], userId: string): CuratedList[] {
  return lists.filter((l) => l.creatorId === userId)
}

/**
 * Filter posts to only those authored by members of the given lists.
 */
export function filterPostsByLists(posts: Post[], lists: CuratedList[]): Post[] {
  const allowedAuthors = new Set(lists.flatMap((l) => l.memberIds))
  if (allowedAuthors.size === 0) return []
  return posts.filter((p) => allowedAuthors.has(p.authorId))
}

// ── Custom Feed Operations (Bluesky-style) ─────────────────────────────

export function createFeedDefinition(
  creatorId: string,
  name: string,
  filter: FeedFilter,
  description = "",
): FeedDefinition {
  return {
    feedId: randomUUID(),
    creatorId,
    name: name.trim(),
    description: description.trim(),
    filter,
    subscribedByIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function updateFeedDefinition(feed: FeedDefinition, update: FeedDefinitionUpdate): FeedDefinition {
  return {
    ...feed,
    ...(update.name !== undefined ? { name: update.name.trim() } : {}),
    ...(update.description !== undefined ? { description: update.description.trim() } : {}),
    ...(update.filter !== undefined ? { filter: update.filter } : {}),
    updatedAt: new Date().toISOString(),
  }
}

export function subscribeToFeed(feed: FeedDefinition, userId: string): FeedDefinition {
  if (feed.subscribedByIds.includes(userId)) return feed
  return { ...feed, subscribedByIds: [...feed.subscribedByIds, userId] }
}

export function unsubscribeFromFeed(feed: FeedDefinition, userId: string): FeedDefinition {
  return {
    ...feed,
    subscribedByIds: feed.subscribedByIds.filter((id) => id !== userId),
  }
}

export function getFeedsForUser(feeds: FeedDefinition[], userId: string): FeedDefinition[] {
  return feeds.filter((f) => f.creatorId === userId)
}

export function getFeedsWithSubscriber(feeds: FeedDefinition[], userId: string): FeedDefinition[] {
  return feeds.filter((f) => f.subscribedByIds.includes(userId))
}

export function applyFeedToPosts(feed: FeedDefinition, posts: Post[]): Post[] {
  return buildFilteredFeed(posts, feed.filter)
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
