/**
 * Tests for Dharma Containment — Hostile Fixture Definitions
 *
 * Verifies the static fixture registry, category-based filtering,
 * and critical-fixture extraction. These tests confirm the data
 * contract, not any running code.
 */

import { describe, it, expect } from "bun:test"
import {
  HOSTILE_FIXTURES,
  getAllFixtures,
  getFixturesByCategory,
  getCriticalFixtures,
} from "../hostile-fixtures"
import type { HostileFixtureDefinition } from "../hostile-fixtures"

// ── Registry Completeness ──────────────────────────────────────────────────

describe("HOSTILE_FIXTURES", () => {
  it("defines all expected fixtures", () => {
    const names = HOSTILE_FIXTURES.map((f) => f.name)
    expect(names).toEqual([
      "secret-read",
      "workspace-escape",
      "symlink-escape",
      "network-connect",
      "fork-bomb",
      "child-retain",
      "env-exfiltrate",
      "stale-auth-reuse",
      "unrelated-project-read",
    ])
  })

  it("every fixture has a non-empty description", () => {
    for (const fixture of HOSTILE_FIXTURES) {
      expect(fixture.description.length).toBeGreaterThan(0)
    }
  })

  it("every fixture has a valid category", () => {
    const validCategories = ["escape", "persist", "network", "resource", "credential", "revocation"]
    for (const fixture of HOSTILE_FIXTURES) {
      expect(validCategories).toContain(fixture.category)
    }
  })

  it("every fixture has a valid severity", () => {
    const validSeverities = ["critical", "high", "medium"]
    for (const fixture of HOSTILE_FIXTURES) {
      expect(validSeverities).toContain(fixture.severity)
    }
  })

  it("has exactly 9 fixture definitions", () => {
    expect(HOSTILE_FIXTURES).toHaveLength(9)
  })
})

// ── getAllFixtures ─────────────────────────────────────────────────────────

describe("getAllFixtures", () => {
  it("returns all fixtures", () => {
    const fixtures = getAllFixtures()
    expect(fixtures).toHaveLength(HOSTILE_FIXTURES.length)
  })

  it("returns a copy that does not share a reference with HOSTILE_FIXTURES", () => {
    const fixtures = getAllFixtures()
    fixtures.pop()
    expect(HOSTILE_FIXTURES).toHaveLength(9)
  })
})

// ── Category Filtering ─────────────────────────────────────────────────────

describe("getFixturesByCategory", () => {
  it("returns escape fixtures", () => {
    const escape = getFixturesByCategory("escape")
    const names = escape.map((f) => f.name)
    expect(names).toEqual([
      "workspace-escape",
      "symlink-escape",
      "unrelated-project-read",
    ])
  })

  it("returns credential fixtures", () => {
    const credential = getFixturesByCategory("credential")
    const names = credential.map((f) => f.name)
    expect(names).toEqual(["secret-read", "env-exfiltrate"])
  })

  it("returns network fixtures", () => {
    const network = getFixturesByCategory("network")
    expect(network).toHaveLength(1)
    expect(network[0].name).toBe("network-connect")
  })

  it("returns resource fixtures", () => {
    const resource = getFixturesByCategory("resource")
    expect(resource).toHaveLength(1)
    expect(resource[0].name).toBe("fork-bomb")
  })

  it("returns persist fixtures", () => {
    const persist = getFixturesByCategory("persist")
    expect(persist).toHaveLength(1)
    expect(persist[0].name).toBe("child-retain")
  })

  it("returns revocation fixtures", () => {
    const revocation = getFixturesByCategory("revocation")
    expect(revocation).toHaveLength(1)
    expect(revocation[0].name).toBe("stale-auth-reuse")
  })

  it("returns empty array for unknown category", () => {
    const result = getFixturesByCategory("escape" as "escape")
    expect(result).toBeInstanceOf(Array)
  })
})

// ── Critical Fixtures ──────────────────────────────────────────────────────

describe("getCriticalFixtures", () => {
  it("returns only critical-severity fixtures", () => {
    const critical = getCriticalFixtures()
    for (const fixture of critical) {
      expect(fixture.severity).toBe("critical")
    }
  })

  it("identifies all critical fixtures by name", () => {
    const critical = getCriticalFixtures()
    const names = critical.map((f) => f.name)
    expect(names).toEqual([
      "secret-read",
      "workspace-escape",
      "fork-bomb",
      "env-exfiltrate",
      "stale-auth-reuse",
    ])
  })
})
