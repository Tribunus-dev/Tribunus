/**
 * Codex — Mutual-Aid Debug System Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createDebugRequest,
  createDebugProposal,
  checkNovelty,
  computeWordJaccard,
  computeScopeOverlap,
  createDebugStore,
  addRequest,
  addProposal,
  getProposalsByRequest,
  getNovelProposals,
  acceptProposal,
  rejectAsDuplicate,
} from "../codex-mutual-aid"
import type { DebugProposal, CodexClaim } from "../codex-mutual-aid"

const makeClaim = (statement: string): CodexClaim => ({
  claimId: `c-${Math.random().toString(36).slice(2, 8)}`,
  statement,
  claimType: "fact",
  supportRefs: [],
  scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
  confidence: 0.8,
})

describe("checkNovelty", () => {
  test("novel proposal with no overlap passes", () => {
    const existing = [
      { ...createDebugProposal("req-1", "Use Metal buffer binding", "proposal", "alice"),
        codexPatternIds: ["pattern-buffer-bind"],
        claims: [makeClaim("Buffer must be bound before dispatch on Metal")],
        evidenceRefs: [{ receiptDigest: "r1", contributionId: "c1", artifactDigest: "a1", description: "e1" }],
        scope: { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: [], contextNotes: [] },
      },
    ]

    const novel = {
      ...createDebugProposal("req-1", "Use Vulkan timeline semaphores", "proposal", "bob"),
      codexPatternIds: ["pattern-timeline-semaphore"],
      claims: [makeClaim("Timeline semaphores synchronize queue submissions on Vulkan")],
      evidenceRefs: [{ receiptDigest: "r99", contributionId: "c99", artifactDigest: "a99", description: "different" }],
      scope: { hardwareTargets: ["rtx4090"], softwareVersions: ["Linux 6.8"], modelFamilies: [], contextNotes: [] },
    }

    const result = checkNovelty(novel, existing)
    expect(result.verdict).toBe("novel")
    expect(result.similarProposalId).toBeNull()
  })

  test("same Codex pattern is duplicate", () => {
    const existing = [
      { ...createDebugProposal("req-1", "Fix Metal buffer binding", "proposal", "alice"),
        codexPatternIds: ["pattern-buffer-bind"],
        claims: [], evidenceRefs: [],
        scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
      },
    ]

    const duplicate = {
      ...createDebugProposal("req-1", "Bind Metal buffers before dispatch", "proposal", "bob"),
      codexPatternIds: ["pattern-buffer-bind"],
      claims: [], evidenceRefs: [],
      scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
    }

    const result = checkNovelty(duplicate, existing)
    expect(result.verdict).toBe("duplicate_pattern")
  })

  test("shared evidence is duplicate", () => {
    const existing = [
      { ...createDebugProposal("req-1", "Fix crash", "proposal", "alice"),
        codexPatternIds: [],
        claims: [], evidenceRefs: [{ receiptDigest: "r1", contributionId: "c1", artifactDigest: "a1", description: "log" }],
        scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
      },
    ]

    const duplicate = {
      ...createDebugProposal("req-1", "Also fix crash", "proposal", "bob"),
      codexPatternIds: [],
      claims: [], evidenceRefs: [{ receiptDigest: "r1", contributionId: "c1", artifactDigest: "a1", description: "log" }],
      scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
    }

    const result = checkNovelty(duplicate, existing)
    expect(result.verdict).toBe("duplicate_evidence")
  })

  test("high claim overlap is duplicate", () => {
    const existing = [
      { ...createDebugProposal("req-1", "Fix", "proposal", "alice"),
        codexPatternIds: [],
        claims: [makeClaim("The Metal buffer must be bound to the encoder before any dispatch call is made to the GPU")],
        evidenceRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
      },
    ]

    const duplicate = {
      ...createDebugProposal("req-1", "Same fix", "proposal", "bob"),
      codexPatternIds: [],
      claims: [makeClaim("A Metal buffer must be bound to the encoder before any GPU dispatch calls are made")],
      evidenceRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] },
    }

    const result = checkNovelty(duplicate, existing)
    expect(result.verdict).toBe("duplicate_claim")
  })

  test("different scope with same claim is NOT duplicate", () => {
    const existing = [
      { ...createDebugProposal("req-1", "Fix", "proposal", "alice"),
        codexPatternIds: [],
        claims: [makeClaim("Buffer must be bound before dispatch on Metal")],
        evidenceRefs: [],
        scope: { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: ["gemma"], contextNotes: [] },
      },
    ]

    const different = {
      ...createDebugProposal("req-1", "Different scope", "proposal", "bob"),
      codexPatternIds: [],
      claims: [makeClaim("Buffer must be bound before dispatch on CUDNN")],
      evidenceRefs: [],
      scope: { hardwareTargets: ["h100"], softwareVersions: ["CUDA 12"], modelFamilies: ["llama"], contextNotes: [] },
    }

    const result = checkNovelty(different, existing)
    expect(result.verdict).toBe("novel")  // Different scope → novel
  })
})

describe("computeWordJaccard", () => {
  test("identical text has overlap of 1", () => {
    const t = "buffer must be bound before dispatch"
    expect(computeWordJaccard(t, t)).toBe(1)
  })

  test("completely different text has 0 overlap", () => {
    expect(computeWordJaccard("buffer must be bound", "vulkan timeline semaphore synchronization")).toBe(0)
  })

  test("similar wording has overlap", () => {
    const a = "the metal buffer must be bound before dispatch"
    const b = "a metal buffer should be bound before dispatch calls"
    const score = computeWordJaccard(a, b)
    expect(score).toBeGreaterThan(0.3)
    expect(score).toBeLessThan(0.9)
  })

  test("empty strings return 0", () => {
    expect(computeWordJaccard("", "")).toBe(0)
  })
})

describe("computeScopeOverlap", () => {
  test("identical scope has high overlap", () => {
    const scope = { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: [], contextNotes: [] }
    expect(computeScopeOverlap(scope, scope)).toBeGreaterThan(0.8)
  })

  test("completely different scope has low overlap", () => {
    const a = { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: [], contextNotes: [] }
    const b = { hardwareTargets: ["h100"], softwareVersions: ["Linux"], modelFamilies: [], contextNotes: [] }
    expect(computeScopeOverlap(a, b)).toBe(0)
  })

  test("empty scopes return 0", () => {
    const empty = { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }
    expect(computeScopeOverlap(empty, empty)).toBe(0)  // All unspecified
  })
})

describe("addProposal with novelty check", () => {
  test("novel proposal is added", () => {
    const store = createDebugStore()
    const req = createDebugRequest("Crash on Metal", "GPU crash", "session-1", "alice", "critical", "crash")
    const s1 = addRequest(store, req)

    const prop = createDebugProposal(req.requestId, "Fix buffer binding", "Use setBuffer before dispatch", "bob")
    const result = addProposal(s1, prop, true)

    expect(result.noveltyResult.verdict).toBe("novel")
    expect(getNovelProposals(result.store, req.requestId)).toHaveLength(1)
  })

  test("duplicate proposal is rejected", () => {
    const store = createDebugStore()
    const req = createDebugRequest("Crash on Metal", "GPU crash", "session-1", "alice", "critical", "crash")
    const s1 = addRequest(store, req)

    const prop1 = createDebugProposal(req.requestId, "Fix buffer binding", "Use setBuffer before dispatch", "bob")
    const r1 = addProposal(s1, { ...prop1, codexPatternIds: ["pattern-buffer-bind"] }, true)

    // Same Codex pattern
    const prop2 = { ...createDebugProposal(req.requestId, "Also fix buffer", "Similar approach", "charlie"),
      codexPatternIds: ["pattern-buffer-bind"] }

    const r2 = addProposal(r1.store, prop2, true)

    expect(r2.noveltyResult.verdict).toBe("duplicate_pattern")
    expect(getNovelProposals(r2.store, req.requestId)).toHaveLength(1)  // Only the first one
    expect(getProposalsByRequest(r2.store, req.requestId)).toHaveLength(2)  // Both stored, but one rejected
  })
})

describe("proposal lifecycle", () => {
  test("accept proposal changes status", () => {
    const prop = createDebugProposal("req-1", "Fix", "desc", "alice")
    const accepted = acceptProposal(prop)
    expect(accepted.status).toBe("accepted")
  })

  test("reject as duplicate preserves novelty result", () => {
    const prop = createDebugProposal("req-1", "Fix", "desc", "bob")
    const result = { verdict: "duplicate_pattern" as const, similarProposalId: "prop-1", reason: "Duplicate", similarityScore: 0.8 }
    const rejected = rejectAsDuplicate(prop, result)
    expect(rejected.status).toBe("rejected_duplicate")
    expect(rejected.noveltyResult?.verdict).toBe("duplicate_pattern")
  })

  test("addRequest stores request", () => {
    const store = createDebugStore()
    const req = createDebugRequest("Bug", "desc", "session-1", "alice", "major", "crash")
    const updated = addRequest(store, req)
    expect(updated.requests.get(req.requestId)).toBeDefined()
  })
})
