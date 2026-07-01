/**
 * SocialNetworkPanel — shows connected peers, replication status, and local identity info.
 *
 * Loads data from IPC through the preload bridge. Extends Panel base class
 * for header/toolbar/content slot patterns.
 *
 * Uses static `properties` instead of decorators for compat with the project's
 * TypeScript config (experimental decorators).
 */

import { html, css, type TemplateResult } from "lit"
import { Panel } from "./panel"
import type { ElectronAPI } from "../preload/types"
import type { SocialProfile, DharmaSocialScore, FollowRecord } from "@tribunus/runtime/tribunus/dharma/codex/codex-social"

/* ── Types ──────────────────────────────────────────────── */

export interface PeerInfo {
  peerId: string
  displayName: string
  connectionStatus: "offline" | "syncing" | "connected"
}

export interface LocalIdentity {
  identityId: string
  displayName: string
  joinedAt: string
}

export type ReplicationStatus = "offline" | "syncing" | "connected"

/* ── SocialNetworkPanel ─────────────────────────────────── */

export class SocialNetworkPanel extends Panel {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: var(--font-sans, system-ui, sans-serif);
      font-size: var(--font-size-sm, 13px);
      color: var(--color-text, #e0e0e0);
    }

    .section {
      padding: var(--spacing-md, 16px);
      border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
    }

    .section:last-child {
      border-bottom: none;
    }

    .section-title {
      font-size: var(--font-size-xs, 11px);
      font-weight: var(--font-weight-semibold, 600);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
      margin: 0 0 var(--spacing-sm, 8px) 0;
    }

    /* ── Replication Status ────────────────────────────── */

    .replication-bar {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm, 8px);
      padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
      border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot--offline {
      background: #ef4444;
    }

    .status-dot--syncing {
      background: #eab308;
    }

    .status-dot--connected {
      background: #22c55e;
    }

    .status-label {
      font-size: var(--font-size-sm, 13px);
      font-weight: var(--font-weight-semibold, 600);
    }

    /* ── Peer List ─────────────────────────────────────── */

    .peer-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs, 4px);
    }

    .peer-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-sm, 8px) var(--spacing-md, 12px);
      background: var(--color-surface-raised, rgba(255, 255, 255, 0.04));
      border: 1px solid var(--color-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--radius-sm, 4px);
    }

    .peer-name {
      font-size: var(--font-size-sm, 13px);
      font-weight: var(--font-weight-semibold, 600);
    }

    .peer-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--font-size-xs, 11px);
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
    }

    .empty-peers {
      color: var(--color-text-muted, rgba(255, 255, 255, 0.4));
      font-style: italic;
      font-size: var(--font-size-xs, 11px);
    }

    /* ── Action Row ────────────────────────────────────── */

    .action-row {
      padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
      border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs, 4px);
      padding: 6px 12px;
      border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
      border-radius: var(--radius-sm, 4px);
      background: var(--color-surface-raised, rgba(255, 255, 255, 0.04));
      color: var(--color-text, #e0e0e0);
      font-size: var(--font-size-sm, 13px);
      font-family: var(--font-sans, system-ui, sans-serif);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn:hover {
      background: var(--color-hover, rgba(255, 255, 255, 0.08));
      border-color: var(--color-accent, #4a9eff);
    }

    .btn:active {
      background: var(--color-active, rgba(255, 255, 255, 0.12));
    }

    /* ── Local Identity ────────────────────────────────── */

    .identity-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--spacing-xs, 4px) var(--spacing-md, 12px);
      font-size: var(--font-size-sm, 13px);
    }

    .identity-label {
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
      white-space: nowrap;
    }

    .identity-value {
      color: var(--color-text, #e0e0e0);
      word-break: break-all;
    }

    .identity-value--truncated {
      font-family: var(--font-mono, "SF Mono", "Cascadia Code", monospace);
      font-size: var(--font-size-xs, 11px);
    }
  `

  static override properties = {
    ...Panel.properties,
    peers: { type: Array },
    replicationStatus: { type: String },
    _dharmaScore: { type: Number },
    _followerCount: { type: Number },
    _followingCount: { type: Number },
    _identityId: { type: String },
    _displayName: { type: String },
    _joinedAt: { type: String },
    _error: { type: String },
    _isDiscovering: { type: Boolean },
  }

  title = "Network"

  peers: PeerInfo[] = []
  replicationStatus: ReplicationStatus = "offline"

  /* ── IPC-driven state ────────────────────────────────── */

  private _dharmaScore = 0
  private _followerCount = 0
  private _followingCount = 0
  private _identityId = ""
  private _displayName = "Local Identity"
  private _joinedAt = ""
  private _error: string | null = null
  private _isDiscovering = false

  override async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this._loadNetworkData()
  }

  /* ── Data Loading ────────────────────────────────────── */

  private async _loadNetworkData(): Promise<void> {
    try {
      const api = window.api as unknown as ElectronAPI

      // Load score for dharma/follower/following counts
      const score = await api.socialGetScore({ identityId: "local" })
      if (score) {
        this._dharmaScore = score.dharmaEarned
        this._followerCount = score.followers
        this._followingCount = score.following
      }

      // Load profile for identity display info
      const profile = await api.socialGetProfile({ identityId: "local" })
      if (profile) {
        this._identityId = profile.profileId
        this._displayName = profile.displayName
        this._joinedAt = profile.joinedAt
      }

      // Load following list for peers
      const following = await api.socialGetFollowing({ identityId: "local" })
      this.peers = following.map((record: FollowRecord) => ({
        peerId: record.followeeId,
        displayName: record.followeeId.slice(0, 12),
        connectionStatus: "offline" as const,
      }))

      this.replicationStatus = "connected"
    } catch (e: unknown) {
      this._error = e instanceof Error ? e.message : String(e)
      this.replicationStatus = "offline"
    }
    this.requestUpdate()
  }

  /* ── Event Handlers ──────────────────────────────────── */

  private async _onDiscoverPeers(): Promise<void> {
    this._isDiscovering = true
    // Stub: in production this would trigger Hyperswarm peer discovery
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 1000)
    await promise
    this._isDiscovering = false
    this.requestUpdate()
  }

  /* ── Render ──────────────────────────────────────────── */

  override render(): TemplateResult {
    const peerStatusLabel = (s: PeerInfo["connectionStatus"]) =>
      s === "connected" ? "Connected" : s === "syncing" ? "Syncing" : "Offline"
    const repLabel =
      this.replicationStatus === "offline"
        ? "Offline"
        : this.replicationStatus === "syncing"
          ? "Syncing..."
          : "Connected"

    const fmtDate = (iso: string): string => {
      try {
        return new Date(iso).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      } catch {
        return iso
      }
    }

    const truncId = (id: string) =>
      id.length <= 16 ? id : `${id.slice(0, 16)}...`

    return html`
      <!-- Replication Status -->
      <div class="replication-bar">
        <span class="status-dot status-dot--${this.replicationStatus}"></span>
        <span class="status-label">${repLabel}</span>
      </div>

      <!-- Discover Peers Button -->
      <div class="action-row">
        <button class="btn" @click=${this._onDiscoverPeers} ?disabled=${this._isDiscovering}>
          ${this._isDiscovering ? "Discovering..." : "Discover Peers"}
        </button>
      </div>

      <!-- Peer List -->
      <div class="section">
        <h3 class="section-title">Connected Peers</h3>
        ${this.peers.length > 0
          ? html`
            <div class="peer-list">
              ${this.peers.map(
                (peer) => html`
                  <div class="peer-item">
                    <span class="peer-name">${peer.displayName}</span>
                    <span class="peer-status">
                      <span class="status-dot status-dot--${peer.connectionStatus}"></span>
                      ${peerStatusLabel(peer.connectionStatus)}
                    </span>
                  </div>
                `,
              )}
            </div>
          `
          : html`<div class="empty-peers">No peers discovered yet</div>`}
      </div>

      <!-- Local Identity -->
      <div class="section">
        <h3 class="section-title">Local Identity</h3>
        <div class="identity-grid">
          <span class="identity-label">Identity</span>
          <span class="identity-value identity-value--truncated">${truncId(this._identityId)}</span>

          <span class="identity-label">Name</span>
          <span class="identity-value">${this._displayName}</span>

          <span class="identity-label">Joined</span>
          <span class="identity-value">${fmtDate(this._joinedAt)}</span>

          <span class="identity-label">Dharma</span>
          <span class="identity-value">${this._dharmaScore}</span>
        </div>
      </div>

      ${this._error ? html`<div class="section" style="color: #ef4444; font-size: var(--font-size-xs, 11px);">${this._error}</div>` : ""}
    `
  }
}

customElements.define("cockpit-social-network-panel", SocialNetworkPanel)

export default SocialNetworkPanel
