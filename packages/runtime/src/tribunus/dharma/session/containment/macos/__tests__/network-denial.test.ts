/**
 * macOS Seatbelt — Network Denial Tests
 *
 * Tests the generateNetworkRules function for correct SBPL rule generation
 * across all network policy modes.
 */

import { describe, it, expect } from "bun:test"
import { generateNetworkRules } from "../macos-seatbelt-profile"

// ── Tests ───────────────────────────────────────────────────────────────────

describe("generateNetworkRules", () => {
  it('generateNetworkRules with mode "none" denies all external network access', () => {
    const rules = generateNetworkRules("none")

    // Must deny all non-loopback network
    expect(rules).toContain("(deny network*")
    // Must still allow loopback
    expect(rules).toContain('(allow network* (local ip "127.0.0.1"))')
    expect(rules).toContain('(allow network* (local ip "::1"))')
  })

  it('generateNetworkRules with mode "loopback_only" denies external but allows loopback', () => {
    const rules = generateNetworkRules("loopback_only")

    // Should deny external network
    expect(rules).toContain("(deny network*")
    // Must allow loopback
    expect(rules).toContain('(allow network* (local ip "127.0.0.1"))')
    expect(rules).toContain('(allow network* (local ip "::1"))')
  })

  it('generateNetworkRules with mode "loopback_only" does not allow external domains', () => {
    const rules = generateNetworkRules("loopback_only")

    // Should not contain remote rules for external domains
    expect(rules).not.toContain("(allow network* (remote tcp")
    expect(rules).not.toContain("(allow network* (remote udp")
  })

  it('generateNetworkRules with mode "none" is complete (not just loopback)', () => {
    const rules = generateNetworkRules("none")

    // The profile must have at least one deny and one allow
    expect(rules.split("\n").filter(l => l.trim()).length).toBeGreaterThanOrEqual(2)
    // IPv4 loopback allowed
    expect(rules).toContain('127.0.0.1')
    // IPv6 loopback allowed
    expect(rules).toContain('::1')
  })

  it("generateNetworkRules with allowlisted mode denies all by default", () => {
    const rules = generateNetworkRules("allowlisted", [], [])

    expect(rules).toContain("(deny network*)")
    expect(rules).not.toContain("(allow network*")
  })

  it("generateNetworkRules with allowlisted mode and specific domains allows those domains", () => {
    const rules = generateNetworkRules("allowlisted", ["example.com", "api.example.org"], [])

    expect(rules).toContain("(deny network*)")
    expect(rules).toContain('(allow network* (remote tcp (domain "example.com")))')
    expect(rules).toContain('(allow network* (remote tcp (domain "api.example.org")))')
  })

  it("generateNetworkRules with allowlisted mode and specific ports allows those ports", () => {
    const rules = generateNetworkRules("allowlisted", [], [443, 8080])

    expect(rules).toContain("(deny network*)")
    expect(rules).toContain("(allow network* (remote tcp (local port 443)))")
    expect(rules).toContain("(allow network* (remote udp (local port 443)))")
    expect(rules).toContain("(allow network* (remote tcp (local port 8080)))")
    expect(rules).toContain("(allow network* (remote udp (local port 8080)))")
  })

  it("generateNetworkRules with empty mode string produces deny-all", () => {
    // Unknown/empty mode should default to deny all with no explicit allow
    const rules = generateNetworkRules("", [], [])

    expect(rules).toContain("(deny network*)")
    expect(rules).not.toContain("(allow network*")
  })
})
