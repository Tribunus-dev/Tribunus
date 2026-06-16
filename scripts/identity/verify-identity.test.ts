import { expect, test } from "bun:test";
import { entryMatchesOccurrence, pathMatches, patternMatches } from "./verify-identity.ts";

test("wildcard scope matching", () => {
  expect(entryMatchesOccurrence(
    { path: "*", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "some/file.ts", matched: "opencode", contextHash: "", category: "cat" }
  )).toBe(true);

  expect(entryMatchesOccurrence(
    { path: "*", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "some/file.ts", matched: "different-pattern", contextHash: "", category: "cat" }
  )).toBe(false);

  expect(entryMatchesOccurrence(
    { path: "packages/foo/**", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "packages/foo/src/index.ts", matched: "opencode", contextHash: "", category: "cat" }
  )).toBe(true);

  expect(entryMatchesOccurrence(
    { path: "packages/foo/**", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "packages/bar/src/index.ts", matched: "opencode", contextHash: "", category: "cat" }
  )).toBe(false);

  expect(entryMatchesOccurrence(
    { path: "*", pattern: "opencode", classification: "UPSTREAM_ATTRIBUTION_PERMANENT", subsystem: "all", reason: "reason", permanent: true, replacementIdentity: "tribunus" },
    { file: "some/file.ts", matched: "tribunus-legacy", contextHash: "", category: "cat" }
  )).toBe(false);
});
