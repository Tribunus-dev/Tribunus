/**
 * Dharma Multi-Peer — Canonical Outcome Chaining Tests
 */

import { describe, test, expect } from "bun:test";
import type { CanonicalSessionOutcome } from "../multi-peer-types";
import {
  createFirstOutcome,
  createNextOutcome,
  getOutcomeChain,
  verifyOutcomeChain,
} from "../multi-peer-outcome";

// ── createFirstOutcome ──────────────────────────────────────────────────────

describe("createFirstOutcome", () => {
  const baseConfig = {
    sessionId: "session-1",
    acceptedResultId: "result-1",
    acceptedBy: "acceptor-1",
    sourceBasisDigest: "source-digest-1",
    canonicalOutcomeDigest: "outcome-digest-1",
  };

  test("creates first outcome with null parent", () => {
    const outcome = createFirstOutcome(baseConfig);

    expect(outcome.outcomeId).toBeTruthy();
    expect(typeof outcome.outcomeId).toBe("string");
    expect(outcome.sessionId).toBe("session-1");
    expect(outcome.acceptedResultId).toBe("result-1");
    expect(outcome.acceptedByIdentityPublicKey).toBe("acceptor-1");
    expect(outcome.sourceBasisDigest).toBe("source-digest-1");
    expect(outcome.canonicalOutcomeDigest).toBe("outcome-digest-1");
    expect(outcome.parentOutcomeDigest).toBeNull();
    expect(outcome.verificationStatus).toBe("verified");
    expect(outcome.acceptanceReason).toBeNull();
    expect(outcome.changedPathDigests).toEqual([]);
    expect(outcome.signature).toBe("");
  });

  test("accepts optional changedPathDigests", () => {
    const paths = ["path-a", "path-b"];
    const outcome = createFirstOutcome({
      ...baseConfig,
      changedPathDigests: paths,
    });
    expect(outcome.changedPathDigests).toEqual(paths);
  });
});

// ── createNextOutcome ────────────────────────────────────────────────────────

describe("createNextOutcome", () => {
  const first = createFirstOutcome({
    sessionId: "session-1",
    acceptedResultId: "result-1",
    acceptedBy: "acceptor-1",
    sourceBasisDigest: "source-digest-1",
    canonicalOutcomeDigest: "outcome-digest-1",
    changedPathDigests: ["path-a"],
  });

  const nextConfig = {
    acceptedResultId: "result-2",
    acceptedBy: "acceptor-1",
    canonicalOutcomeDigest: "outcome-digest-2",
  };

  test("chains to previous outcome via parentOutcomeDigest", () => {
    const next = createNextOutcome(first, nextConfig);

    expect(next.sessionId).toBe(first.sessionId);
    expect(next.acceptedResultId).toBe("result-2");
    expect(next.parentOutcomeDigest).toBe(first.canonicalOutcomeDigest);
    expect(next.sourceBasisDigest).toBe(first.sourceBasisDigest);
    expect(next.verificationStatus).toBe("verified");
  });

  test("accepts optional changedPathDigests", () => {
    const paths = ["path-c"];
    const next = createNextOutcome(first, { ...nextConfig, changedPathDigests: paths });
    expect(next.changedPathDigests).toEqual(paths);
  });

  test("throws if previous outcome has empty canonicalOutcomeDigest", () => {
    const corrupt: CanonicalSessionOutcome = {
      ...first,
      canonicalOutcomeDigest: "",
    };
    expect(() => createNextOutcome(corrupt, nextConfig)).toThrow(
      /no canonicalOutcomeDigest/i,
    );
  });
});

// ── getOutcomeChain ──────────────────────────────────────────────────────────

describe("getOutcomeChain", () => {
  test("returns empty array for empty input", () => {
    expect(getOutcomeChain([])).toEqual([]);
  });

  test("orders outcomes from first to last", () => {
    const first = createFirstOutcome({
      sessionId: "session-1",
      acceptedResultId: "result-1",
      acceptedBy: "acceptor-1",
      sourceBasisDigest: "source-1",
      canonicalOutcomeDigest: "digest-1",
      changedPathDigests: ["/a"],
    });
    const second = createNextOutcome(first, {
      acceptedResultId: "result-2",
      acceptedBy: "acceptor-1",
      canonicalOutcomeDigest: "digest-2",
      changedPathDigests: ["/b"],
    });
    const third = createNextOutcome(second, {
      acceptedResultId: "result-3",
      acceptedBy: "acceptor-1",
      canonicalOutcomeDigest: "digest-3",
      changedPathDigests: ["/c"],
    });

    // Input in reverse order
    const chain = getOutcomeChain([third, first, second]);
    expect(chain.length).toBe(3);
    expect(chain[0].canonicalOutcomeDigest).toBe("digest-1");
    expect(chain[1].canonicalOutcomeDigest).toBe("digest-2");
    expect(chain[2].canonicalOutcomeDigest).toBe("digest-3");
  });

  test("returns empty when no head (null parent) found", () => {
    // All outcomes have a parent but no head
    const orphan1: CanonicalSessionOutcome = {
      outcomeId: "o1",
      sessionId: "s1",
      acceptedResultId: "r1",
      acceptedByIdentityPublicKey: "a1",
      parentOutcomeDigest: "nonexistent",
      sourceBasisDigest: "s1",
      canonicalOutcomeDigest: "d1",
      changedPathDigests: [],
      verificationStatus: "verified",
      acceptanceReason: null,
      acceptedAt: new Date().toISOString(),
      signature: "",
    };
    expect(getOutcomeChain([orphan1])).toEqual([]);
  });
});

// ── verifyOutcomeChain ───────────────────────────────────────────────────────

describe("verifyOutcomeChain", () => {
  test("rejects empty chain", () => {
    const result = verifyOutcomeChain([]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });

  test("rejects chain where first outcome has a parent", () => {
    const bad: CanonicalSessionOutcome = {
      outcomeId: "o1",
      sessionId: "s1",
      acceptedResultId: "r1",
      acceptedByIdentityPublicKey: "a1",
      parentOutcomeDigest: "some-parent",
      sourceBasisDigest: "s1",
      canonicalOutcomeDigest: "d1",
      changedPathDigests: [],
      verificationStatus: "verified",
      acceptanceReason: null,
      acceptedAt: new Date().toISOString(),
      signature: "",
    };
    const result = verifyOutcomeChain([bad]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/null parent/i);
  });

  test("rejects chain with mismatched session IDs", () => {
    const first = createFirstOutcome({
      sessionId: "session-1",
      acceptedResultId: "r1",
      acceptedBy: "a1",
      sourceBasisDigest: "s1",
      canonicalOutcomeDigest: "d1",
    });
    const second = createNextOutcome(first, {
      acceptedResultId: "r2",
      acceptedBy: "a1",
      canonicalOutcomeDigest: "d2",
    });
    const badSecond: CanonicalSessionOutcome = {
      ...second,
      sessionId: "session-other",
    };

    const result = verifyOutcomeChain([first, badSecond]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatched session/i);
  });

  test("rejects chain with broken parent links", () => {
    const first = createFirstOutcome({
      sessionId: "session-1",
      acceptedResultId: "r1",
      acceptedBy: "a1",
      sourceBasisDigest: "s1",
      canonicalOutcomeDigest: "d1",
    });
    const badLink: CanonicalSessionOutcome = {
      ...createNextOutcome(first, {
        acceptedResultId: "r2",
        acceptedBy: "a1",
        canonicalOutcomeDigest: "d2",
      }),
      parentOutcomeDigest: "wrong-digest",
    };

    const result = verifyOutcomeChain([first, badLink]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/parentOutcomeDigest/i);
  });

  test("accepts valid chain", () => {
    const first = createFirstOutcome({
      sessionId: "session-1",
      acceptedResultId: "r1",
      acceptedBy: "a1",
      sourceBasisDigest: "s1",
      canonicalOutcomeDigest: "d1",
    });
    const second = createNextOutcome(first, {
      acceptedResultId: "r2",
      acceptedBy: "a1",
      canonicalOutcomeDigest: "d2",
    });
    const third = createNextOutcome(second, {
      acceptedResultId: "r3",
      acceptedBy: "a1",
      canonicalOutcomeDigest: "d3",
    });

    const result = verifyOutcomeChain([first, second, third]);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
  });
});
