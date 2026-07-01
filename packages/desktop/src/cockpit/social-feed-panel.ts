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
  };

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

    .post-composer {
      display: flex;
      gap: var(--spacing-sm, 8px);
      padding: var(--spacing-md, 16px);
      border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
      align-items: flex-start;
    }

    .post-input {
      flex: 1;
      background: var(--color-surface-raised, rgba(255, 255, 255, 0.04));
      border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--radius-sm, 4px);
      color: var(--color-text, #e0e0e0);
      font-family: var(--font-sans, system-ui, sans-serif);
      font-size: var(--font-size-sm, 13px);
      padding: var(--spacing-sm, 8px);
      resize: vertical;
      min-height: 36px;
    }

    .post-submit-btn {
      background: var(--color-accent, #4a9eff);
      color: #fff;
      border: none;
      border-radius: var(--radius-sm, 4px);
      padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
      font-size: var(--font-size-sm, 13px);
      cursor: pointer;
      white-space: nowrap;
    }

    .post-submit-btn:hover {
      opacity: 0.9;
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

  /** Whether more pages may be available after the current page. */
  private _hasMore = true

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
    if (this._loading || !this._hasMore) return
    this._loadPage(this._page + 1)
  }

  private async _loadPage(page: number): Promise<void> {
    this._loading = true
    this._page = page
    try {
      const items = await window.api.socialGetFeed({
        identityId: "local",
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      this._feed = page === 0 ? items : [...this._feed, ...items]
      if (items.length < PAGE_SIZE) {
        this._hasMore = false
      }
    } catch (e: unknown) {
      this._error = e instanceof Error ? e.message : "Failed to load feed"
    } finally {
      this._loading = false
      this.requestUpdate()
    }
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

  private async _handleSubmitPost(): Promise<void> {
    const textarea = this.shadowRoot?.querySelector('.post-input') as HTMLTextAreaElement | null
    if (!textarea || !textarea.value.trim()) return
    try {
      const result = await window.api.socialCreatePost({
        identityId: "local",
        content: textarea.value.trim(),
      })
      if (result.ok && result.value?.ok) {
        textarea.value = ''
        this._feed = []
        this._page = 0
        this._hasMore = true
        this._loadPage(0)
      }
    } catch (e: unknown) {
      this._error = e instanceof Error ? e.message : "Failed to create post"
    }
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
        <div class="post-composer">
          <textarea class="post-input" placeholder="Share something..."></textarea>
          <button class="post-submit-btn" @click=${this._handleSubmitPost}>Post</button>
        </div>
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
