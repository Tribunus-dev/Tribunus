import { expect, test } from "bun:test";
import { entryMatchesOccurrence, pathMatches, patternMatches } from "./verify-identity.ts";

test("wildcard scope matching", () => {
  // path: "*" plus matching pattern authorizes an occurrence
  expect(entryMatchesOccurrence(
    { path: "*", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "some/file.ts", matched: "opencode", contextHash: "", category: "cat" }
  )).toBe(true);

  // path: "*" plus non-matching pattern does not authorize an occurrence
  expect(entryMatchesOccurrence(
    { path: "*", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "some/file.ts", matched: "different-pattern", contextHash: "", category: "cat" }
  )).toBe(false);

  // scoped path like packages/foo/** authorizes only files under that prefix
  expect(entryMatchesOccurrence(
    { path: "packages/foo/**", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "packages/foo/src/index.ts", matched: "opencode", contextHash: "", category: "cat" }
  )).toBe(true);

  expect(entryMatchesOccurrence(
    { path: "packages/foo/**", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "packages/bar/src/index.ts", matched: "opencode", contextHash: "", category: "cat" }
  )).toBe(false);

  // unrelated new identity strings still fail
  expect(entryMatchesOccurrence(
    { path: "*", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "some/file.ts", matched: "tribunus-legacy", contextHash: "", category: "cat" }
  )).toBe(false);
});
