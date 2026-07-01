/**
 * SocialNetworkPanel — shows connected peers, replication status, and local identity info.
 *
 * Placeholder implementation with hardcoded sample data. Extends Panel base class
 * for header/toolbar/content slot patterns.
 *
 * Uses static `properties` instead of decorators for compat with the project's
 * TypeScript config (experimental decorators).
 */

import { LitElement, html, css, type TemplateResult } from "lit"
import { Panel } from "./panel"

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
  }

  title = "Network"

  peers: PeerInfo[] = []
  replicationStatus: ReplicationStatus = "offline"

  /* ── Sample Data (hardcoded placeholder) ─────────────── */

  private readonly _localIdentity: LocalIdentity = {
    identityId: "did:key:z6Mkp9ZkM1kZpR9xHtNqQ3wLvK5JcFn7YmGpBs2DvX4rT8aW",
    displayName: "Local Identity",
    joinedAt: "2025-11-15T10:30:00Z",
  }

  private readonly _samplePeers: PeerInfo[] = [
    { peerId: "peer-1", displayName: "Alice", connectionStatus: "connected" },
    { peerId: "peer-2", displayName: "Bob", connectionStatus: "syncing" },
    { peerId: "peer-3", displayName: "Charlie", connectionStatus: "offline" },
  ]

  override connectedCallback(): void {
    super.connectedCallback()
    this.peers = this._samplePeers
    this.replicationStatus = "connected"
    this.requestUpdate()
  }

  /* ── Event Handlers ──────────────────────────────────── */

  private _onDiscoverPeers(): void {
    this.dispatchEvent(
      new CustomEvent("discover-peers", {
        bubbles: true,
        composed: true,
      }),
    )
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
        <button class="btn" @click=${this._onDiscoverPeers}>
          Discover Peers
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
          <span class="identity-value identity-value--truncated">${truncId(this._localIdentity.identityId)}</span>

          <span class="identity-label">Name</span>
          <span class="identity-value">${this._localIdentity.displayName}</span>

          <span class="identity-label">Joined</span>
          <span class="identity-value">${fmtDate(this._localIdentity.joinedAt)}</span>
        </div>
      </div>
    `
  }
}

customElements.define("cockpit-social-network-panel", SocialNetworkPanel)

export default SocialNetworkPanel
