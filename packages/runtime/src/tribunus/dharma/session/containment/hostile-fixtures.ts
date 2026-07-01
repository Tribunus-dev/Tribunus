/**
 * Dharma OS-Enforced Sandbox — Hostile Fixture Definitions
 *
 * Defines all hostile fixture definitions as static data used by the
 * containment capability report builder. These describe the adversarial
 * scenarios that release containment must block before a workload can
 * be considered safely contained.
 *
 * Fixtures are NOT executable code — they describe the scenarios that
 * real platform-specific sandbox backends should exercise.
 */

// ── Fixture Category & Severity ----------------------------------------------

export type FixtureCategory =
  | "escape"
  | "persist"
  | "network"
  | "resource"
  | "credential"
  | "revocation"

export type FixtureSeverity = "critical" | "high" | "medium"

// ── Fixture Definition -------------------------------------------------------

export interface HostileFixtureDefinition {
  name: string
  description: string
  category: FixtureCategory
  severity: FixtureSeverity
}

// ── Fixture Registry ---------------------------------------------------------

export const HOSTILE_FIXTURES: HostileFixtureDefinition[] = [
  {
    name: "secret-read",
    description:
      "attempt to read host SSH keys and environment secrets",
    category: "credential",
    severity: "critical",
  },
  {
    name: "workspace-escape",
    description:
      "attempt to traverse out of workspace directory via ../",
    category: "escape",
    severity: "critical",
  },
  {
    name: "symlink-escape",
    description:
      "attempt to read host files through a symlink in workspace",
    category: "escape",
    severity: "high",
  },
  {
    name: "network-connect",
    description:
      "attempt to open an outbound TCP connection to a non-allowlisted host",
    category: "network",
    severity: "high",
  },
  {
    name: "fork-bomb",
    description:
      "attempt to exhaust process table via recursive fork",
    category: "resource",
    severity: "critical",
  },
  {
    name: "child-retain",
    description:
      "attempt to retain a child process after parent exits",
    category: "persist",
    severity: "high",
  },
  {
    name: "env-exfiltrate",
    description:
      "attempt to read and exfiltrate environment variables containing secrets",
    category: "credential",
    severity: "critical",
  },
  {
    name: "stale-auth-reuse",
    description:
      "attempt to use a revoked session authorization",
    category: "revocation",
    severity: "critical",
  },
  {
    name: "unrelated-project-read",
    description:
      "attempt to read files from an unrelated project directory",
    category: "escape",
    severity: "high",
  },
]

// ── Query Helpers ------------------------------------------------------------

/**
 * Returns every hostile fixture definition registered in HOSTILE_FIXTURES.
 */
export function getAllFixtures(): HostileFixtureDefinition[] {
  return [...HOSTILE_FIXTURES]
}

/**
 * Returns the subset of fixtures whose category matches the given category
 * string (case-sensitive). Use the FixtureCategory union values.
 */
export function getFixturesByCategory(
  category: FixtureCategory & string,
): HostileFixtureDefinition[] {
  return HOSTILE_FIXTURES.filter((f) => f.category === category)
}

/**
 * Returns only the fixtures marked with severity "critical".
 */
export function getCriticalFixtures(): HostileFixtureDefinition[] {
  return HOSTILE_FIXTURES.filter((f) => f.severity === "critical")
}
