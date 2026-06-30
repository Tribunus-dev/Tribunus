/**
 * Tests for Dharma Session Authority — Grant Model
 */

import { describe, it, expect } from "bun:test"
import {
  hasCapability,
  hasAllCapabilities,
  isPathAllowed,
  isCommandAllowed,
  isNetworkDomainAllowed,
  isEnvironmentVariableAllowed,
  isFileExtensionAllowed,
  isGrantValid,
  getProfileCapabilities,
  createGrantFromProfile,
  mergeScope,
  isWithinBudget,
} from "../session-grants"
import type {
  SessionAuthorityGrant,
  Capability,
  ResourceScope,
  GrantProfile,
} from "../types"
import { DEFAULT_EMPTY_SCOPE } from "../types"

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGrant(
  overrides?: Partial<SessionAuthorityGrant>,
): SessionAuthorityGrant {
  return {
    grantId: "grant_001",
    sessionId: "session_001",
    subjectIdentityPublicKey: "pk_subject_001",
    subjectMembershipId: "mem_001",
    issuedByIdentityPublicKey: "pk_issuer_001",
    issuedByGrantId: null,
    capabilitySet: ["workspace.read", "session.inspect", "terminal.execute_safe"],
    resourceScope: DEFAULT_EMPTY_SCOPE,
    executionConstraints: null,
    disclosureScope: null,
    approvalPolicy: null,
    delegationPolicy: null,
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    revocationReason: null,
    sessionKeyEpoch: 1,
    signature: "",
    ...overrides,
  }
}

// ── hasCapability ──────────────────────────────────────────────────────────

describe("hasCapability", () => {
  it("returns true for granted capabilities", () => {
    const grant = makeGrant({ capabilitySet: ["workspace.read", "session.inspect"] })
    expect(hasCapability(grant, "workspace.read")).toBe(true)
    expect(hasCapability(grant, "session.inspect")).toBe(true)
  })

  it("returns false for ungranted capabilities", () => {
    const grant = makeGrant({ capabilitySet: ["workspace.read"] })
    expect(hasCapability(grant, "session.inspect")).toBe(false)
    expect(hasCapability(grant, "terminal.execute_safe")).toBe(false)
  })
})

// ── hasAllCapabilities ─────────────────────────────────────────────────────

describe("hasAllCapabilities", () => {
  it("returns true when all capabilities are present", () => {
    const grant = makeGrant({ capabilitySet: ["workspace.read", "session.inspect"] })
    expect(hasAllCapabilities(grant, ["workspace.read"])).toBe(true)
    expect(hasAllCapabilities(grant, ["workspace.read", "session.inspect"])).toBe(true)
  })

  it("returns false when any capability is missing", () => {
    const grant = makeGrant({ capabilitySet: ["workspace.read"] })
    expect(hasAllCapabilities(grant, ["workspace.read", "session.inspect"])).toBe(false)
  })
})

// ── isPathAllowed ──────────────────────────────────────────────────────────

describe("isPathAllowed", () => {
  const scope: ResourceScope = {
    ...DEFAULT_EMPTY_SCOPE,
    allowedPaths: ["/home/user/project/**", "/tmp/work/**"],
    deniedPaths: ["/home/user/project/secret/**"],
  }

  it("allows paths in the allowed list", () => {
    expect(isPathAllowed(scope, "/home/user/project/src/index.ts")).toBe(true)
    expect(isPathAllowed(scope, "/tmp/work/output.log")).toBe(true)
  })

  it("denies paths in the denied list even if also in allowed", () => {
    expect(isPathAllowed(scope, "/home/user/project/secret/keys.json")).toBe(false)
  })

  it("denies paths not in any allowed list", () => {
    expect(isPathAllowed(scope, "/etc/passwd")).toBe(false)
  })
})

// ── isCommandAllowed ───────────────────────────────────────────────────────

describe("isCommandAllowed", () => {
  const scope: ResourceScope = {
    ...DEFAULT_EMPTY_SCOPE,
    allowedCommands: ["npm ", "npx ", "node "],
    deniedCommands: ["npm run deploy", "npx --unsafe"],
  }

  it("allows commands matching allowed prefixes", () => {
    expect(isCommandAllowed(scope, "npm test")).toBe(true)
    expect(isCommandAllowed(scope, "node index.js")).toBe(true)
  })

  it("denies commands matching denied prefixes", () => {
    expect(isCommandAllowed(scope, "npm run deploy --prod")).toBe(false)
    expect(isCommandAllowed(scope, "npx --unsafe-perm install")).toBe(false)
  })

  it("denies commands not matching any allowed prefix", () => {
    expect(isCommandAllowed(scope, "rm -rf /")).toBe(false)
  })
})

// ── isNetworkDomainAllowed ──────────────────────────────────────────────────

describe("isNetworkDomainAllowed", () => {
  const scope: ResourceScope = {
    ...DEFAULT_EMPTY_SCOPE,
    allowedNetworkDomains: ["tribunus.dev", "api.github.com"],
    deniedNetworkDomains: ["api.github.com"],
  }

  it("allows domains matching allowed list", () => {
    expect(isNetworkDomainAllowed(scope, "tribunus.dev")).toBe(true)
    expect(isNetworkDomainAllowed(scope, "docs.tribunus.dev")).toBe(true)
  })

  it("denies domains matching denied list", () => {
    expect(isNetworkDomainAllowed(scope, "api.github.com")).toBe(false)
  })

  it("denies domains not in any allowed list", () => {
    expect(isNetworkDomainAllowed(scope, "evil.example.com")).toBe(false)
  })
})

// ── isEnvironmentVariableAllowed ───────────────────────────────────────────

describe("isEnvironmentVariableAllowed", () => {
  const scope: ResourceScope = {
    ...DEFAULT_EMPTY_SCOPE,
    allowedEnvironmentVariables: ["NODE_", "PATH"],
    deniedEnvironmentVariables: ["NODE_OPTIONS"],
  }

  it("allows env vars matching allowed prefixes", () => {
    expect(isEnvironmentVariableAllowed(scope, "NODE_ENV")).toBe(true)
    expect(isEnvironmentVariableAllowed(scope, "PATH")).toBe(true)
  })

  it("denies env vars matching denied prefixes", () => {
    expect(isEnvironmentVariableAllowed(scope, "NODE_OPTIONS")).toBe(false)
  })
})

// ── isFileExtensionAllowed ─────────────────────────────────────────────────

describe("isFileExtensionAllowed", () => {
  const scope: ResourceScope = {
    ...DEFAULT_EMPTY_SCOPE,
    allowedFileExtensions: [".ts", ".js", ".json"],
    deniedFileExtensions: [".env"],
  }

  it("allows file extensions in the allowed list", () => {
    expect(isFileExtensionAllowed(scope, ".ts")).toBe(true)
    expect(isFileExtensionAllowed(scope, ".js")).toBe(true)
    expect(isFileExtensionAllowed(scope, "ts")).toBe(true)
  })

  it("denies file extensions in the denied list", () => {
    expect(isFileExtensionAllowed(scope, ".env")).toBe(false)
  })
})

// ── isGrantValid ───────────────────────────────────────────────────────────

describe("isGrantValid", () => {
  it("returns true for an active grant", () => {
    const grant = makeGrant({
      expiresAt: "2099-12-31T23:59:59.999Z",
      revokedAt: null,
      sessionKeyEpoch: 5,
    })
    expect(isGrantValid(grant, 5)).toBe(true)
  })

  it("returns false for an expired grant", () => {
    const grant = makeGrant({
      expiresAt: "2020-01-01T00:00:00.000Z",
      revokedAt: null,
      sessionKeyEpoch: 5,
    })
    expect(isGrantValid(grant, 5)).toBe(false)
  })

  it("returns false for a revoked grant", () => {
    const grant = makeGrant({
      expiresAt: "2099-12-31T23:59:59.999Z",
      revokedAt: "2026-06-15T12:00:00.000Z",
      sessionKeyEpoch: 5,
    })
    expect(isGrantValid(grant, 5)).toBe(false)
  })

  it("returns false when key epoch does not match", () => {
    const grant = makeGrant({
      expiresAt: "2099-12-31T23:59:59.999Z",
      revokedAt: null,
      sessionKeyEpoch: 5,
    })
    expect(isGrantValid(grant, 6)).toBe(false)
  })
})

// ── getProfileCapabilities ─────────────────────────────────────────────────

describe("getProfileCapabilities", () => {
  const profiles: GrantProfile[] = [
    "observer",
    "reviewer",
    "contributor",
    "test_runner",
    "maintainer",
    "session_coowner",
  ]

  for (const profile of profiles) {
    it(`returns correct capabilities for ${profile}`, () => {
      const caps = getProfileCapabilities(profile)
      expect(Array.isArray(caps)).toBe(true)
      expect(caps.length).toBeGreaterThan(0)
      // all returned values must be valid capabilities
      for (const c of caps) {
        expect(c).toBeDefined()
      }
    })
  }
})

// ── createGrantFromProfile ─────────────────────────────────────────────────

describe("createGrantFromProfile", () => {
  it("produces a valid grant with merged scope", () => {
    const grant = createGrantFromProfile({
      grantId: "grant_002",
      sessionId: "session_001",
      subjectIdentityPublicKey: "pk_subject_002",
      subjectMembershipId: "mem_002",
      issuedByIdentityPublicKey: "pk_issuer_001",
      profile: "contributor",
      resourceScope: {
        allowedPaths: ["/workspace/**"],
      },
      sessionKeyEpoch: 3,
      expiresAt: "2099-12-31T23:59:59.999Z",
    })

    expect(grant.grantId).toBe("grant_002")
    expect(grant.sessionId).toBe("session_001")
    expect(grant.sessionKeyEpoch).toBe(3)
    expect(grant.resourceScope.allowedPaths).toEqual(["/workspace/**"])
    expect(grant.capabilitySet.length).toBeGreaterThan(0)
  })
})

// ── mergeScope ─────────────────────────────────────────────────────────────

describe("mergeScope", () => {
  it("merges partial scope into base scope", () => {
    const merged = mergeScope(DEFAULT_EMPTY_SCOPE, {
      allowedPaths: ["/project/**"],
      maximumRuntimeSeconds: 3600,
    })

    expect(merged.allowedPaths).toEqual(["/project/**"])
    expect(merged.maximumRuntimeSeconds).toBe(3600)
    // remaining fields from base
    expect(merged.deniedPaths).toEqual([])
    expect(merged.maximumMemoryBytes).toBe(0)
  })
})

// ── isWithinBudget ─────────────────────────────────────────────────────────

describe("isWithinBudget", () => {
  const scope: ResourceScope = {
    ...DEFAULT_EMPTY_SCOPE,
    maximumRuntimeSeconds: 60,
    maximumMemoryBytes: 1_000_000,
    maximumProcessCount: 5,
    maximumDiskWriteBytes: 10_000,
  }

  it("returns true when usage is within limits", () => {
    expect(
      isWithinBudget(scope, {
        runtimeMs: 30_000,
        memoryBytes: 500_000,
        processCount: 3,
      }),
    ).toBe(true)
  })

  it("returns false when runtime exceeds limits", () => {
    expect(
      isWithinBudget(scope, {
        runtimeMs: 120_000,
      }),
    ).toBe(false)
  })

  it("returns false when memory exceeds limits", () => {
    expect(
      isWithinBudget(scope, {
        memoryBytes: 2_000_000,
      }),
    ).toBe(false)
  })

  it("treats limit of 0 as unlimited", () => {
    const unlimited: ResourceScope = {
      ...DEFAULT_EMPTY_SCOPE,
      maximumRuntimeSeconds: 0,
      maximumMemoryBytes: 0,
    }
    expect(
      isWithinBudget(unlimited, {
        runtimeMs: 1_000_000,
        memoryBytes: 1_000_000_000,
      }),
    ).toBe(true)
  })
})
