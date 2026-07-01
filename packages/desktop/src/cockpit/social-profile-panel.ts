/**
 * SocialProfilePanel — displays and edits a dharma social profile.
 *
 * Shows identity info, dharma score, endorsements, follower/following counts,
 * and a "Verified Contributor" badge when the identity has contributions.
 * Edit mode toggles with Save/Cancel for profile fields.
 *
 * Uses static `properties` instead of decorators for compat with the project's
 * TypeScript config (experimental decorators).
 */
import { Panel } from "./panel"
import { LitElement, html, css, type TemplateResult } from "lit"
import type { SocialProfile, DharmaSocialScore } from "@tribunus/runtime/tribunus/dharma/codex/codex-social"

/* ── Sample Data ────────────────────────────────────────── */

const SAMPLE_PROFILE: SocialProfile = {
  profileId: "identity-0x1a2b",
  displayName: "Dharma Builder",
  bio: "Building decentralized governance and reputation systems. Contributor to multiple codex proposals.",
  avatarHash: "",
  website: "https://dharma.example.com",
  joinedAt: "2025-03-15T10:30:00Z",
  profileVersion: 2,
}

const SAMPLE_SCORE: DharmaSocialScore = {
  identityId: "identity-0x1a2b",
  dharmaEarned: 1240,
  proposalsAccepted: 3,
  codexEntriesCredited: 5,
  endorsementsReceived: 34,
  followers: 89,
  following: 42,
  endorsementsGiven: 15,
}

/* ── Component ──────────────────────────────────────────── */

export class SocialProfilePanel extends Panel {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: var(--font-sans, system-ui, sans-serif);
      font-size: var(--font-size-sm, 13px);
      color: var(--color-text, #e0e0e0);
    }

    .profile-body {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-md, 16px);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md, 16px);
    }

    /* ── Profile header ────────────────────────────────── */

    .profile-header {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-md, 16px);
    }

    .avatar {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--color-accent, #4a9eff);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-weight: var(--font-weight-semibold, 600);
      color: #fff;
      flex-shrink: 0;
      overflow: hidden;
    }

    .profile-info {
      flex: 1;
      min-width: 0;
    }

    .display-name {
      font-size: var(--font-size-md, 14px);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text, #e0e0e0);
      margin: 0 0 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .joined-date {
      font-size: var(--font-size-xs, 11px);
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
    }

    /* ── Verified badge ────────────────────────────────── */

    .verified-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: var(--font-size-xs, 11px);
      font-weight: var(--font-weight-semibold, 600);
      background: rgba(40, 199, 111, 0.15);
      color: #28c76f;
      border: 1px solid rgba(40, 199, 111, 0.3);
    }

    .verified-badge::before {
      content: "";
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #28c76f;
    }

    /* ── Score section ─────────────────────────────────── */

    .score-row {
      display: flex;
      gap: var(--spacing-sm, 8px);
      flex-wrap: wrap;
    }

    .score-card {
      flex: 1;
      min-width: 120px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-md, 16px);
      background: var(--color-surface-raised, rgba(255, 255, 255, 0.04));
      border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--radius-md, 8px);
      gap: 4px;
    }

    .score-card--prominent {
      background: linear-gradient(135deg, rgba(74, 158, 255, 0.12), rgba(40, 199, 111, 0.08));
      border-color: var(--color-accent, #4a9eff);
      position: relative;
      overflow: hidden;
    }

    .score-card--prominent::before {
      content: "";
      position: absolute;
      top: -20px;
      right: -20px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(74, 158, 255, 0.15), transparent);
      pointer-events: none;
    }

    .score-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--color-accent, #4a9eff);
      line-height: 1;
    }

    .score-label {
      font-size: var(--font-size-xs, 11px);
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .score-rank {
      font-size: var(--font-size-xs, 11px);
      color: var(--color-text-muted, rgba(255, 255, 255, 0.4));
    }

    .stat-value {
      font-size: 18px;
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text, #e0e0e0);
      line-height: 1;
    }

    .stat-value--endorsements {
      color: #28c76f;
    }

    /* ── Bio / website (view) ──────────────────────────── */

    .bio-text {
      font-size: var(--font-size-sm, 13px);
      color: var(--color-text, #e0e0e0);
      line-height: 1.5;
      margin: 0;
    }

    .website-link {
      font-size: var(--font-size-sm, 13px);
      color: var(--color-accent, #4a9eff);
      text-decoration: none;
    }

    .website-link:hover {
      text-decoration: underline;
    }

    .profile-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm, 8px);
    }

    .section-heading {
      font-size: var(--font-size-xs, 11px);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0;
    }

    /* ── Edit form ─────────────────────────────────────── */

    .edit-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .edit-label {
      font-size: var(--font-size-xs, 11px);
      color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .edit-input {
      background: var(--color-surface-raised, rgba(255, 255, 255, 0.04));
      border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
      border-radius: var(--radius-sm, 4px);
      color: var(--color-text, #e0e0e0);
      padding: 8px 10px;
      font-size: var(--font-size-sm, 13px);
      font-family: var(--font-sans, system-ui, sans-serif);
      outline: none;
      transition: border-color 0.15s;
    }

    .edit-input:focus {
      border-color: var(--color-accent, #4a9eff);
    }

    .edit-input::placeholder {
      color: var(--color-text-muted, rgba(255, 255, 255, 0.3));
    }

    .edit-textarea {
      resize: vertical;
      min-height: 60px;
    }

    /* ── Action buttons ────────────────────────────────── */

    .actions {
      display: flex;
      gap: var(--spacing-sm, 8px);
      margin-top: var(--spacing-sm, 8px);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 16px;
      border-radius: var(--radius-sm, 4px);
      font-size: var(--font-size-sm, 13px);
      font-family: var(--font-sans, system-ui, sans-serif);
      font-weight: var(--font-weight-semibold, 600);
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }

    .btn-primary {
      background: var(--color-accent, #4a9eff);
      color: #fff;
    }

    .btn-primary:hover {
      background: #3a8eef;
    }

    .btn-secondary {
      background: transparent;
      border-color: var(--color-border, rgba(255, 255, 255, 0.12));
      color: var(--color-text, #e0e0e0);
    }

    .btn-secondary:hover {
      background: var(--color-hover, rgba(255, 255, 255, 0.08));
    }

    .btn-edit {
      background: transparent;
      border-color: var(--color-accent, #4a9eff);
      color: var(--color-accent, #4a9eff);
    }

    .btn-edit:hover {
      background: rgba(74, 158, 255, 0.1);
    }
  `

  static override properties = {
    ...Panel.properties,
    profile: { type: Object },
    editing: { type: Boolean },
  }

  override title = "Social Profile"
  profile: SocialProfile = SAMPLE_PROFILE
  score: DharmaSocialScore = SAMPLE_SCORE
  editing = false

  /* ── Edit draft buffers ──────────────────────────────── */

  private _editDisplayName = ""
  private _editBio = ""
  private _editWebsite = ""

  /* ── Lifecycle ───────────────────────────────────────── */

  override connectedCallback(): void {
    super.connectedCallback()
    this._syncEditBuffers()
  }

  /* ── Edit handlers ───────────────────────────────────── */

  private _startEditing(): void {
    this._syncEditBuffers()
    this.editing = true
  }

  private _cancelEditing(): void {
    this.editing = false
  }

  private _formatDate(iso: string): string {
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

  private _saveEditing(): void {
    this.profile = {
      ...this.profile,
      displayName: this._editDisplayName,
      bio: this._editBio,
      website: this._editWebsite,
    }
    this.editing = false
  }

  private _syncEditBuffers(): void {
    this._editDisplayName = this.profile.displayName
    this._editBio = this.profile.bio ?? ""
    this._editWebsite = this.profile.website ?? ""
  }

  private _onDisplayNameInput(e: Event): void {
    this._editDisplayName = (e.target as HTMLInputElement).value
  }

  private _onBioInput(e: Event): void {
    this._editBio = (e.target as HTMLTextAreaElement).value
  }

  private _onWebsiteInput(e: Event): void {
    this._editWebsite = (e.target as HTMLInputElement).value
  }

  private _verified(): boolean {
    const s = this.score
    return s.dharmaEarned > 0 || s.proposalsAccepted > 0 || s.codexEntriesCredited > 0
  }

  /* ── Render ──────────────────────────────────────────── */

  override render(): TemplateResult {
    const { profile: p, score: s, editing } = this
    const verified = this._verified()
    const initials = p.displayName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()

    return html`
      <div class="profile-body">
        <!-- Profile header -->
        <div class="profile-header">
          <div class="avatar">${initials}</div>
          <div class="profile-info">
            ${editing
              ? html`
                  <div class="edit-field">
                    <label class="edit-label" for="edit-name">Display Name</label>
                    <input
                      id="edit-name"
                      class="edit-input"
                      .value=${this._editDisplayName}
                      @input=${this._onDisplayNameInput}
                      placeholder="Your display name"
                    />
                  </div>
                `
              : html`
                  <h2 class="display-name">${p.displayName}</h2>
                  <span class="joined-date">Joined ${this._formatDate(p.joinedAt)}</span>
                `
            }
            ${verified && !editing ? html`<div class="verified-badge">Verified Contributor</div>` : ""}
          </div>
        </div>

        <!-- Score row -->
        <div class="score-row">
          <div class="score-card score-card--prominent">
            <span class="score-value">${s.dharmaEarned}</span>
            <span class="score-label">Dharma Earned</span>
          </div>
          <div class="score-card">
            <span class="stat-value stat-value--endorsements">${s.endorsementsReceived + s.endorsementsGiven}</span>
            <span class="score-label">Endorsements</span>
          </div>
          <div class="score-card">
            <span class="stat-value">${s.followers}</span>
            <span class="score-label">Followers</span>
          </div>
          <div class="score-card">
            <span class="stat-value">${s.following}</span>
            <span class="score-label">Following</span>
          </div>
        </div>

        <!-- Bio -->
        <div class="profile-section">
          <h3 class="section-heading">Bio</h3>
          ${editing
            ? html`
                <div class="edit-field">
                  <textarea
                    class="edit-input edit-textarea"
                    .value=${this._editBio}
                    @input=${this._onBioInput}
                    placeholder="Tell us about yourself"
                  ></textarea>
                </div>
              `
            : p.bio
              ? html`<p class="bio-text">${p.bio}</p>`
              : html`<p class="bio-text" style="color: var(--color-text-muted, rgba(255,255,255,0.4))">No bio yet.</p>`}
        </div>

        <!-- Website -->
        <div class="profile-section">
          <h3 class="section-heading">Website</h3>
          ${editing
            ? html`
                <div class="edit-field">
                  <input
                    class="edit-input"
                    .value=${this._editWebsite}
                    @input=${this._onWebsiteInput}
                    placeholder="https://"
                  />
                </div>
              `
            : p.website ? html`<a class="website-link" href=${p.website} target="_blank" rel="noopener">${p.website}</a>` : html`<span style="color: var(--color-text-muted, rgba(255,255,255,0.4))">No website set.</span>`}
        </div>

        <!-- Actions -->
        <div class="actions">
          ${editing
            ? html`
                <button class="btn btn-primary" @click=${this._saveEditing}>Save</button>
                <button class="btn btn-secondary" @click=${this._cancelEditing}>Cancel</button>
              `
            : html`
                <button class="btn btn-edit" @click=${this._startEditing}>Edit Profile</button>
              `}
        </div>
      </div>
    `
  }
}

customElements.define("cockpit-social-profile-panel", SocialProfilePanel)

export default SocialProfilePanel
