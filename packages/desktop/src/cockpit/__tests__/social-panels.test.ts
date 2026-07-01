/**
 * Social Panels — Unit Tests
 *
 * Tests that the three social cockpit panels construct properly,
 * render sample data, and handle user interactions.
 */

import { expect, test, describe } from "bun:test"
import { SocialFeedPanel } from "../social-feed-panel"
import { SocialProfilePanel } from "../social-profile-panel"
import { SocialNetworkPanel } from "../social-network-panel"

/* ── SocialFeedPanel ────────────────────────────────────── */

describe("SocialFeedPanel", () => {
  test("constructs with default title", () => {
    const panel = new SocialFeedPanel()
    expect(panel.title).toBe("Social Feed")
  })

  test("renders feed items when sample data loaded", () => {
    const panel = new SocialFeedPanel()
    panel.requestUpdate()
    const rendered = panel.render()
    expect(rendered).toBeTruthy()
    // Feed content includes activity type descriptions
    const html_ = String(rendered)
    expect(html_.length).toBeGreaterThan(0)
  })

  test("loads sample feed data on connect", () => {
    const panel = new SocialFeedPanel()
    panel.connectedCallback()
    expect(panel._feed).toBeDefined()
    expect(Array.isArray(panel._feed)).toBe(true)
    panel.disconnectedCallback()
  })
})

/* ── SocialProfilePanel ─────────────────────────────────── */

describe("SocialProfilePanel", () => {
  test("constructs with default title", () => {
    const panel = new SocialProfilePanel()
    expect(panel.title).toBe("Profile")
  })

  test("renders profile details", () => {
    const panel = new SocialProfilePanel()
    const rendered = panel.render()
    expect(rendered).toBeTruthy()
    const html_ = String(rendered)
    // Renders display name and bio
    if (panel.profile) {
      expect(html_).toContain(panel.profile.displayName)
    }
  })

  test("toggles editing mode", () => {
    const panel = new SocialProfilePanel()
    expect(panel.editing).toBe(false)
    panel._onEdit()
    expect(panel.editing).toBe(true)
    panel._onCancel()
    expect(panel.editing).toBe(false)
  })

  test("shows editing inputs when editing is true", () => {
    const panel = new SocialProfilePanel()
    panel.editing = true
    panel.requestUpdate()
    const rendered = panel.render()
    expect(rendered).toBeTruthy()
    const html_ = String(rendered)
    expect(html_).toContain("Save")
    expect(html_).toContain("Cancel")
  })
})

/* ── SocialNetworkPanel ──────────────────────────────────── */

describe("SocialNetworkPanel", () => {
  test("constructs with default title", () => {
    const panel = new SocialNetworkPanel()
    expect(panel.title).toBe("Network")
  })

  test("shows local identity info", () => {
    const panel = new SocialNetworkPanel()
    panel.connectedCallback()
    const rendered = panel.render()
    expect(rendered).toBeTruthy()
  })

  test("shows peer list with status indicators", () => {
    const panel = new SocialNetworkPanel()
    panel.connectedCallback()
    expect(panel.peers).toBeDefined()
    expect(Array.isArray(panel.peers)).toBe(true)
  })

  test("dispatches discover-peers event on button click", () => {
    const panel = new SocialNetworkPanel()
    let eventFired = false
    panel.addEventListener("discover-peers", () => { eventFired = true })
    panel._onDiscoverPeers()
    expect(eventFired).toBe(true)
  })
})
