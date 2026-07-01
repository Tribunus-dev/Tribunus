/**
 * SocialFeedPanel — aggregated social feed from followed peers.
 *
 * Displays a scrollable list of FeedItems with profile avatars, activity
 * type icons, descriptions, and timestamps. Uses IntersectionObserver for
 * infinite scroll pagination.
 *
 * Extends Panel base with the cockpit header/toolbar/content slot system.
 * Uses static properties and styles for compat with project TS config.
 */

import { html, css, type TemplateResult } from "lit"
import { Panel } from "./panel"
import type {
  FeedItem,
  SocialProfile,
  SocialActivity,
  ActivityType,
} from "@tribunus/runtime/tribunus/dharma/codex/codex-social"

/* ── Activity type icon/emoji map ─────────────────────────── */

const ACTIVITY_ICONS: Record<ActivityType, string> = {
  accepted_proposal: "\u2713",
  earned_dharma: "\u2666",
  codex_entry: "\uD83D\uDCCB",
  followed: "\u2192",
  endorsed: "\uD83D\uDC4D",
  joined: "+",
  profile_updated: "\u270E",
}

/* ── Sample data helpers ──────────────────────────────────── */

function sampleProfile(id: string, name: string, bio = ""): SocialProfile {
  return {
    profileId: id,
    displayName: name,
    bio,
    avatarHash: null,
    website: "",
    joinedAt: new Date(Date.now() - 86400000 * Math.floor(Math.random() * 365)).toISOString(),
    profileVersion: 1,
  }
}

function sampleActivity(
  actorId: string,
  payload: SocialActivity["payload"],
  minutesAgo: number,
): SocialActivity {
  return {
    activityId: `act-${Math.random().toString(36).slice(2, 10)}`,
    actorId,
    timestamp: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    payload,
    signature: null,
  }
}

function sampleFeedItem(profile: SocialProfile, payload: SocialActivity["payload"], minutesAgo: number): FeedItem {
  return {
    activity: sampleActivity(profile.profileId, payload, minutesAgo),
    profile,
  }
}

const SAMPLE_PROFILES: SocialProfile[] = [
  sampleProfile("did:trib:alice", "Alice Chen", "Building decentralized systems"),
  sampleProfile("did:trib:bob", "Bob Martinez", "Quantum computing researcher"),
  sampleProfile("did:trib:carol", "Carol Williams", "Open source contributor"),
  sampleProfile("did:trib:dave", "Dave Kim", "Protocol engineer"),
  sampleProfile("did:trib:eve", "Eve Johnson", "Knowledge graph curator"),
  sampleProfile("did:trib:frank", "Frank Ortega", "Dharma advocate"),
]

const ALL_SAMPLE_ITEMS: FeedItem[] = [
  sampleFeedItem(SAMPLE_PROFILES[0], { type: "accepted_proposal", data: { requestId: "r1", proposalId: "p1", title: "Enhanced reputation scoring" } }, 5),
  sampleFeedItem(SAMPLE_PROFILES[1], { type: "earned_dharma", data: { amount: 42, resolutionId: "res1", reason: "Code review contributions" } }, 12),
  sampleFeedItem(SAMPLE_PROFILES[2], { type: "codex_entry", data: { entryId: "e1", title: "Zero-knowledge proofs in consensus", knowledgeClass: "research" } }, 30),
  sampleFeedItem(SAMPLE_PROFILES[3], { type: "followed", data: { followeeId: "did:trib:carol" } }, 45),
  sampleFeedItem(SAMPLE_PROFILES[4], { type: "endorsed", data: { toId: "did:trib:alice", contributionId: "c1", message: "Excellent protocol design work" } }, 90),
  sampleFeedItem(SAMPLE_PROFILES[5], { type: "joined", data: {} }, 120),
  sampleFeedItem(SAMPLE_PROFILES[0], { type: "profile_updated", data: {} }, 150),
  sampleFeedItem(SAMPLE_PROFILES[1], { type: "accepted_proposal", data: { requestId: "r2", proposalId: "p2", title: "P2P identity verification" } }, 200),
  sampleFeedItem(SAMPLE_PROFILES[2], { type: "earned_dharma", data: { amount: 128, resolutionId: "res2", reason: "Research publication" } }, 300),
  sampleFeedItem(SAMPLE_PROFILES[3], { type: "codex_entry", data: { entryId: "e2", title: "Byzantine fault tolerance survey", knowledgeClass: "literature" } }, 360),
  sampleFeedItem(SAMPLE_PROFILES[4], { type: "followed", data: { followeeId: "did:trib:bob" } }, 420),
  sampleFeedItem(SAMPLE_PROFILES[5], { type: "endorsed", data: { toId: "did:trib:dave", contributionId: "c2", message: "Solid engineering work" } }, 500),
]

const PAGE_SIZE = 5

/* ── Feed Item card template ─────────────────────────────── */

function feedItemCard(item: FeedItem): TemplateResult {
  const { activity, profile } = item
  const { displayName, profileId } = profile
  const initial = displayName.charAt(0).toUpperCase()
  const icon = ACTIVITY_ICONS[activity.payload.type] ?? "?"
  const description = describeActivity(activity)
  const time = new Date(activity.timestamp).toLocaleString()

  return html`
    <div class="feed-card">
      <div class="feed-card-avatar">${initial}</div>
      <div class="feed-card-body">
        <div class="feed-card-header">
          <span class="feed-card-name">${displayName}</span>
          <span class="feed-card-type-icon">${icon}</span>
        </div>
        <div class="feed-card-description">${description}</div>
        <div class="feed-card-time">${time}</div>
      </div>
    </div>
  `
}

function describeActivity(activity: SocialActivity): string {
  const p = activity.payload
  switch (p.type) {
    case "accepted_proposal":
      return `Accepted proposal: ${p.data.title}`
    case "earned_dharma":
      return `Earned ${p.data.amount} dharma`
    case "codex_entry":
      return `Added ${p.data.knowledgeClass}: ${p.data.title}`
    case "followed":
      return `Followed ${p.data.followeeId}`
    case "endorsed":
      return `Endorsed contribution ${p.data.contributionId}`
    case "joined":
      return "Joined the network"
    case "profile_updated":
      return "Updated profile"
  }
}

/* ── SocialFeedPanel ─────────────────────────────────────── */

export class SocialFeedPanel extends Panel {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      position: relative;
      background: var(--color-surface, #1a1a2e);
      border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--radius-md, 8px);
      overflow: hidden;
      font-family: var(--font-sans, system-ui, sans-serif);
      font-size: var(--font-size-sm, 13px);
      color: var(--color-text, #e0e0e0);
    }

    :host(.panel-collapsed) .panel-body,
    :host(.panel-collapsed) .panel-toolbar {
      display: none;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
      background: var(--color-surface-raised, rgba(255, 255, 255, 0.04));
      border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
      user-select: none;
      cursor: default;
    }

    .panel-title {
      font-size: var(--font-size-md, 14px);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text, #e0e0e0);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .panel-header-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs, 4px);
    }

    .panel-header-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
      border-radius: var(--radius-sm, 4px);
      cursor: pointer;
      font-size: var(--font-size-xs, 11px);
      transition: background 0.15s, color 0.15s;
    }

    .panel-header-btn:hover {
      background: var(--color-hover, rgba(255, 255, 255, 0.08));
      color: var(--color-text, #e0e0e0);
    }

    .panel-toolbar {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs, 4px);
      padding: var(--spacing-xs, 4px) var(--spacing-md, 16px);
      background: var(--color-surface, #1a1a2e);
      border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.06));
    }

    .panel-body {
      flex: 1;
      overflow: auto;
      padding: var(--spacing-md, 16px);
      min-height: 0;
    }

    .feed-scroll-container {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-md, 16px);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm, 8px);
      align-content: start;
    }

    .feed-card {
      display: flex;
      gap: var(--spacing-md, 16px);
      padding: var(--spacing-md, 16px);
      background: var(--color-surface-raised, rgba(255, 255, 255, 0.04));
      border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--radius-md, 8px);
      transition: border-color 0.15s;
      font-family: var(--font-sans, system-ui, sans-serif);
      color: var(--color-text, #e0e0e0);
    }

    .feed-card:hover {
      border-color: var(--color-accent, #4a9eff);
    }

    .feed-card-avatar {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--color-accent, #4a9eff);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-md, 14px);
      font-weight: var(--font-weight-semibold, 600);
      user-select: none;
    }

    .feed-card-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .feed-card-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm, 8px);
    }

    .feed-card-name {
      font-size: var(--font-size-md, 14px);
      font-weight: var(--font-weight-semibold, 600);
    }

    .feed-card-type-icon {
      font-size: var(--font-size-md, 14px);
      line-height: 1;
    }

    .feed-card-description {
      font-size: var(--font-size-sm, 13px);
      color: var(--color-text-secondary, rgba(255, 255, 255, 0.7));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .feed-card-time {
      font-size: var(--font-size-xs, 11px);
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
    }

    .feed-loading {
      text-align: center;
      padding: var(--spacing-md, 16px);
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
      font-size: var(--font-size-xs, 11px);
    }

    .feed-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--color-text-muted, rgba(255, 255, 255, 0.4));
      gap: var(--spacing-sm, 8px);
    }

    .feed-empty-icon {
      font-size: 32px;
      opacity: 0.3;
    }

    .feed-empty-text {
      font-size: var(--font-size-md, 14px);
    }

    .feed-sentinel {
      height: 1px;
    }

    .feed-error {
      text-align: center;
      padding: var(--spacing-md, 16px);
      color: var(--color-error, #ea5455);
      font-size: var(--font-size-sm, 13px);
    }
  `

  static override properties = {
    ...Panel.properties,
    _feed: { state: true },
    _page: { state: true },
    _loading: { state: true },
    _error: { state: true },
  }

  /** Panel title shown in header. */
  override title = "Social Feed"

  /** Currently loaded feed items. */
  _feed: FeedItem[] = []

  /** Current page counter for pagination. */
  _page = 0

  /** Whether a load operation is in progress. */
  _loading = false

  /** Error message if load fails. */
  _error = ""

  /** IntersectionObserver for infinite scroll. */
  private _observer: IntersectionObserver | null = null

  /** Sentinel element reference for intersection detection. */
  private _sentinelRef: HTMLDivElement | null = null

  /** Total available items (from sample data). */
  private _totalItems = ALL_SAMPLE_ITEMS.length

  override connectedCallback(): void {
    super.connectedCallback()
    this._page = 0
    this._feed = []
    this._loadPage(0)
    this._setupObserver()
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    this._teardownObserver()
  }

  override updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties)
    // Reconnect observer after render updates
    if (changedProperties.has("_feed") || changedProperties.has("_loading")) {
      this._teardownObserver()
      this._setupObserver()
    }
  }

  /** Load the next page of feed items. */
  loadMore(): void {
    if (this._loading) return
    const nextPage = this._page + 1
    if (nextPage * PAGE_SIZE >= this._totalItems) return
    this._loadPage(nextPage)
  }

  private _loadPage(page: number): void {
    this._loading = true
    this._page = page
    const start = page * PAGE_SIZE
    const end = Math.min(start + PAGE_SIZE, this._totalItems)
    const pageItems = ALL_SAMPLE_ITEMS.slice(start, end)

    // Defer to simulate async loading
    setTimeout(() => {
      this._feed = [...this._feed, ...pageItems]
      this._loading = false
      this.requestUpdate()
    }, 200)
  }

  private _setupObserver(): void {
    if (this._observer) return
    // Wait for render to produce the sentinel
    requestAnimationFrame(() => {
      if (this._observer) return
      const sentinel = this.shadowRoot?.querySelector<HTMLDivElement>(".feed-sentinel")
      if (!sentinel) {
        // Re-try on next frame if not yet rendered
        requestAnimationFrame(() => this._setupObserver())
        return
      }
      this._sentinelRef = sentinel
      this._observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            this.loadMore()
          }
        },
        { root: this.shadowRoot?.querySelector(".feed-scroll-container"), rootMargin: "200px" },
      )
      this._observer.observe(sentinel)
    })
  }

  private _teardownObserver(): void {
    this._observer?.disconnect()
    this._observer = null
    this._sentinelRef = null
  }

  /** Toggle panel collapsed state (re-implemented from Panel base). */
  private _toggleCollapsed(): void {
    this.collapsed = !this.collapsed
    this.classList.toggle("panel-collapsed", this.collapsed)
    this.dispatchEvent(new CustomEvent("panel-toggle", {
      detail: { collapsed: this.collapsed },
      bubbles: true,
    }))
  }

  override render(): TemplateResult {
    const hasItems = this._feed.length > 0

    return html`
      <div class="panel-header">
        <span class="panel-title">${this.title}</span>
        <div class="panel-header-actions" part="panel-actions">
          <slot name="toolbar-header"></slot>
          <button
            class="panel-header-btn"
            @click=${this._toggleCollapsed}
            title=${this.collapsed ? "Expand" : "Collapse"}
            part="collapse-btn"
          >
            ${this.collapsed ? "\u25B6" : "\u25BC"}
          </button>
        </div>
      </div>

      <div class="panel-toolbar" part="toolbar">
        <slot name="toolbar"></slot>
      </div>

      <div class="panel-body" part="body">
        ${this._error
          ? html`<div class="feed-error">${this._error}</div>`
          : hasItems
            ? html`
                <div class="feed-scroll-container" part="feed-scroll">
                  ${this._feed.map(feedItemCard)}
                  <div class="feed-sentinel"></div>
                  ${this._loading
                    ? html`<div class="feed-loading">Loading more...</div>`
                    : ""}
                </div>
              `
            : this._loading
              ? html`<div class="feed-loading">Loading feed...</div>`
              : html`
                  <div class="feed-empty">
                    <div class="feed-empty-icon">○</div>
                    <div class="feed-empty-text">No feed items yet</div>
                  </div>
                `}
      </div>
    `
  }
}

customElements.define("cockpit-social-feed-panel", SocialFeedPanel)

export default SocialFeedPanel
