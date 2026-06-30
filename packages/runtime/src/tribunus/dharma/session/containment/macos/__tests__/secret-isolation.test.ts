/**
 * macOS Seatbelt — Secret Isolation Tests
 *
 * Tests the generateEnvironmentRules function for correct environment
 * variable isolation, ensuring sensitive credentials are denied and
 * sandbox paths are set.
 */

import { describe, it, expect } from "bun:test"
import { generateEnvironmentRules } from "../macos-seatbelt-profile"
import type { EnvironmentPolicy } from "../../containment-types"

// ── Test Helpers -------------------------------------------------------------

function makeEnvPolicy(overrides: Partial<EnvironmentPolicy> = {}): EnvironmentPolicy {
  return {
    allowedVariables: [],
    deniedVariables: [],
    staticValues: {},
    sandboxHome: "/tmp/sandbox-home",
    sandboxTemp: "/tmp/sandbox-temp",
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("generateEnvironmentRules", () => {
  it("denies SSH_AUTH_SOCK by default", () => {
    const policy = makeEnvPolicy({ deniedVariables: ["SSH_AUTH_SOCK"] })
    const rules = generateEnvironmentRules(policy)

    expect(rules).toContain("SSH_AUTH_SOCK")
    expect(rules).toContain("DENY_ENV=SSH_AUTH_SOCK")
  })

  it("denies AWS credential variables", () => {
    const policy = makeEnvPolicy({
      deniedVariables: [
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
      ],
    })
    const rules = generateEnvironmentRules(policy)

    expect(rules).toContain("DENY_ENV=AWS_ACCESS_KEY_ID")
    expect(rules).toContain("DENY_ENV=AWS_SECRET_ACCESS_KEY")
    expect(rules).toContain("DENY_ENV=AWS_SESSION_TOKEN")
  })

  it("denies GCP credential variables", () => {
    const policy = makeEnvPolicy({
      deniedVariables: [
        "GCP_PROJECT",
        "GOOGLE_APPLICATION_CREDENTIALS",
      ],
    })
    const rules = generateEnvironmentRules(policy)

    expect(rules).toContain("DENY_ENV=GCP_PROJECT")
    expect(rules).toContain("DENY_ENV=GOOGLE_APPLICATION_CREDENTIALS")
  })

  it("denies Azure credential variables", () => {
    const policy = makeEnvPolicy({
      deniedVariables: [
        "AZURE_CLIENT_ID",
        "AZURE_CLIENT_SECRET",
      ],
    })
    const rules = generateEnvironmentRules(policy)

    expect(rules).toContain("DENY_ENV=AZURE_CLIENT_ID")
    expect(rules).toContain("DENY_ENV=AZURE_CLIENT_SECRET")
  })

  it("denies API key variables", () => {
    const policy = makeEnvPolicy({
      deniedVariables: [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GITHUB_TOKEN",
        "NPM_TOKEN",
      ],
    })
    const rules = generateEnvironmentRules(policy)

    expect(rules).toContain("DENY_ENV=OPENAI_API_KEY")
    expect(rules).toContain("DENY_ENV=ANTHROPIC_API_KEY")
    expect(rules).toContain("DENY_ENV=GITHUB_TOKEN")
    expect(rules).toContain("DENY_ENV=NPM_TOKEN")
  })

  it("sets sanitized HOME", () => {
    const policy = makeEnvPolicy({ sandboxHome: "/tmp/sandbox-home" })
    const rules = generateEnvironmentRules(policy)

    expect(rules).toContain("SANDBOX_HOME=/tmp/sandbox-home")
  })

  it("sets sanitized TMP", () => {
    const policy = makeEnvPolicy({ sandboxTemp: "/tmp/sandbox-temp" })
    const rules = generateEnvironmentRules(policy)

    expect(rules).toContain("SANDBOX_TEMP=/tmp/sandbox-temp")
  })

  it("documents allowed variables", () => {
    const policy = makeEnvPolicy({
      allowedVariables: ["PATH", "LANG"],
    })
    const rules = generateEnvironmentRules(policy)

    expect(rules).toContain("ALLOW_ENV=PATH")
    expect(rules).toContain("ALLOW_ENV=LANG")
  })

  it("produces non-empty output for a full policy", () => {
    const policy = makeEnvPolicy({
      allowedVariables: ["PATH", "HOME"],
      deniedVariables: [
        "SSH_AUTH_SOCK",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "GITHUB_TOKEN",
      ],
      staticValues: { CUSTOM_VAR: "test" },
      sandboxHome: "/tmp/sandbox",
      sandboxTemp: "/tmp/sandbox-tmp",
    })
    const rules = generateEnvironmentRules(policy)

    expect(rules.length).toBeGreaterThan(0)
    expect(rules).toContain("SANDBOX_HOME=/tmp/sandbox")
    expect(rules).toContain("SANDBOX_TEMP=/tmp/sandbox-tmp")
    // All denied variables documented
    expect(rules).toContain("DENY_ENV=SSH_AUTH_SOCK")
    expect(rules).toContain("DENY_ENV=AWS_ACCESS_KEY_ID")
    expect(rules).toContain("DENY_ENV=AWS_SECRET_ACCESS_KEY")
    expect(rules).toContain("DENY_ENV=GITHUB_TOKEN")
    // Allowed variables documented
    expect(rules).toContain("ALLOW_ENV=PATH")
    expect(rules).toContain("ALLOW_ENV=HOME")
  })
})
