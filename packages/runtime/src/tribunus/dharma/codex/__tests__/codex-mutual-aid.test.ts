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
  promoteAcceptedProposal,
} from "../codex-mutual-aid"
import { createDharmaLedger, createBugResolutionBenefitPolicy } from "../codex-dharma"
import { createBenefitStore, addPolicy } from "../codex-benefits"
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
    const existing = [{ ...createDebugProposal("req-1", "Use Metal buffer binding", "proposal", "alice"), codexPatternIds: ["pattern-buffer-bind"], claims: [makeClaim("Buffer must be bound before dispatch on Metal")], evidenceRefs: [{ receiptDigest: "r1", contributionId: "c1", artifactDigest: "a1", description: "e1" }], scope: { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: [], contextNotes: [] } }]
    const novel = { ...createDebugProposal("req-1", "Use Vulkan timeline semaphores", "proposal", "bob"), codexPatternIds: ["pattern-timeline-semaphore"], claims: [makeClaim("Timeline semaphores synchronize queue submissions on Vulkan")], evidenceRefs: [{ receiptDigest: "r99", contributionId: "c99", artifactDigest: "a99", description: "different" }], scope: { hardwareTargets: ["rtx4090"], softwareVersions: ["Linux 6.8"], modelFamilies: [], contextNotes: [] } }
    expect(checkNovelty(novel, existing).verdict).toBe("novel")
  })

  test("same Codex pattern is duplicate", () => {
    const existing = [{ ...createDebugProposal("req-1", "Fix", "proposal", "alice"), codexPatternIds: ["pattern-buffer-bind"], claims: [], evidenceRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] } }]
    expect(checkNovelty({ ...createDebugProposal("req-1", "Also fix", "proposal", "bob"), codexPatternIds: ["pattern-buffer-bind"], claims: [], evidenceRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] } }, existing).verdict).toBe("duplicate_pattern")
  })

  test("shared evidence is duplicate", () => {
    const existing = [{ ...createDebugProposal("req-1", "Fix", "proposal", "alice"), codexPatternIds: [], claims: [], evidenceRefs: [{ receiptDigest: "r1", contributionId: "c1", artifactDigest: "a1", description: "log" }], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] } }]
    expect(checkNovelty({ ...createDebugProposal("req-1", "Also fix", "proposal", "bob"), codexPatternIds: [], claims: [], evidenceRefs: [{ receiptDigest: "r1", contributionId: "c1", artifactDigest: "a1", description: "log" }], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] } }, existing).verdict).toBe("duplicate_evidence")
  })

  test("high claim overlap is duplicate", () => {
    const existing = [{ ...createDebugProposal("req-1", "Fix", "proposal", "alice"), codexPatternIds: [], claims: [makeClaim("The Metal buffer must be bound to the encoder before any dispatch call is made to the GPU")], evidenceRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] } }]
    expect(checkNovelty({ ...createDebugProposal("req-1", "Same fix", "proposal", "bob"), codexPatternIds: [], claims: [makeClaim("A Metal buffer must be bound to the encoder before any GPU dispatch calls are made")], evidenceRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] } }, existing).verdict).toBe("duplicate_claim")
  })

  test("different scope with same claim is NOT duplicate", () => {
    const existing = [{ ...createDebugProposal("req-1", "Fix", "proposal", "alice"), codexPatternIds: [], claims: [makeClaim("Buffer must be bound before dispatch on Metal")], evidenceRefs: [], scope: { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: ["gemma"], contextNotes: [] } }]
    expect(checkNovelty({ ...createDebugProposal("req-1", "Different scope", "proposal", "bob"), codexPatternIds: [], claims: [makeClaim("Buffer must be bound before dispatch on CUDNN")], evidenceRefs: [], scope: { hardwareTargets: ["h100"], softwareVersions: ["CUDA 12"], modelFamilies: ["llama"], contextNotes: [] } }, existing).verdict).toBe("novel")
  })
})

describe("computeWordJaccard", () => {
  test("identical text has overlap of 1", () => {
    expect(computeWordJaccard("buffer must be bound before dispatch", "buffer must be bound before dispatch")).toBe(1)
  })
  test("completely different text has 0 overlap", () => {
    expect(computeWordJaccard("buffer must be bound", "vulkan timeline semaphore synchronization")).toBe(0)
  })
  test("similar wording has overlap", () => {
    expect(computeWordJaccard("the metal buffer must be bound before dispatch", "a metal buffer should be bound before dispatch calls")).toBeGreaterThan(0.3)
  })
  test("empty strings return 0", () => {
    expect(computeWordJaccard("", "")).toBe(0)
  })
})

describe("computeScopeOverlap", () => {
  test("identical scope has high overlap", () => {
    const s = { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: [], contextNotes: [] }
    expect(computeScopeOverlap(s, s)).toBeGreaterThan(0.8)
  })
  test("completely different scope has low overlap", () => {
    const a = { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: [], contextNotes: [] }
    const b = { hardwareTargets: ["h100"], softwareVersions: ["Linux"], modelFamilies: [], contextNotes: [] }
    expect(computeScopeOverlap(a, b)).toBe(0)
  })
  test("empty scopes return 0", () => {
    expect(computeScopeOverlap({ hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] })).toBe(0)
  })
})

describe("addProposal with novelty check", () => {
  test("novel proposal is added", () => {
    const store = createDebugStore()
    const req = createDebugRequest("Crash", "GPU crash", "session-1", "alice", "critical", "crash")
    const s1 = addRequest(store, req)
    const prop = createDebugProposal(req.requestId, "Fix", "desc", "bob")
    const result = addProposal(s1, prop, true)
    expect(result.noveltyResult.verdict).toBe("novel")
    expect(getNovelProposals(result.store, req.requestId)).toHaveLength(1)
  })

  test("duplicate proposal is rejected", () => {
    const store = createDebugStore()
    const req = createDebugRequest("Crash", "GPU crash", "session-1", "alice", "critical", "crash")
    const s1 = addRequest(store, req)
    const r1 = addProposal(s1, { ...createDebugProposal(req.requestId, "Fix", "desc", "bob"), codexPatternIds: ["pattern-buffer-bind"] }, true)
    const r2 = addProposal(r1.store, { ...createDebugProposal(req.requestId, "Also fix", "desc", "charlie"), codexPatternIds: ["pattern-buffer-bind"] }, true)
    expect(r2.noveltyResult.verdict).toBe("duplicate_pattern")
    expect(getNovelProposals(r2.store, req.requestId)).toHaveLength(1)
  })
})

describe("proposal lifecycle", () => {
  test("accept proposal changes status", () => {
    expect(acceptProposal(createDebugProposal("req-1", "Fix", "desc", "alice")).status).toBe("accepted")
  })
  test("reject as duplicate preserves novelty result", () => {
    const r = { verdict: "duplicate_pattern" as const, similarProposalId: "prop-1", reason: "Duplicate", similarityScore: 0.8 }
    expect(rejectAsDuplicate(createDebugProposal("req-1", "Fix", "desc", "bob"), r).status).toBe("rejected_duplicate")
  })
  test("addRequest stores request", () => {
    expect(addRequest(createDebugStore(), createDebugRequest("Bug", "desc", "session-1", "alice", "major", "crash")).requests.size).toBe(1)
  })
})

// ── Promotion Tests ────────────────────────────────────────────────────

describe("promoteAcceptedProposal", () => {
  function setupProposal() {
    const store = createDebugStore()
    const request = createDebugRequest("GPU crash on Metal dispatch", "GPU timeout when buffer not bound", "session-1", "alice", "critical", "crash")
    const s1 = addRequest(store, request)
    const proposal = createDebugProposal(request.requestId, "Bind buffer before dispatch", "The Metal buffer must be bound to the encoder before dispatch", "bob")
    const r1 = addProposal(s1, { ...proposal, claims: [{ claimId: "c1", statement: "The Metal buffer must be bound to the encoder before dispatch", claimType: "procedure", supportRefs: [], scope: { hardwareTargets: ["m1"], softwareVersions: ["macOS 14"], modelFamilies: [], contextNotes: [] }, confidence: 0.8 }], evidenceRefs: [{ receiptDigest: "r1", contributionId: "bob", artifactDigest: "a1", description: "crash log" }] }, true)
    const accepted = acceptProposal(r1.store.proposals.get(r1.store.proposalsByRequest.get(request.requestId)![0])!)
    return { request, accepted, store: r1.store }
  }

  test("promotes accepted proposal to Codex entry and earns dharma", () => {
    const { request, accepted } = setupProposal()
    const policy = createBugResolutionBenefitPolicy("bp-1")
    const store = addPolicy(createBenefitStore(), policy)
    const ledger = createDharmaLedger()
    const result = promoteAcceptedProposal(accepted, request, "alice", "receipt-verify-1", policy, store, ledger)

    expect(result.codexEntry.title).toContain("Bind buffer before dispatch")
    expect(result.codexEntry.provenance.authoredBy).toContain("bob")
    expect(result.resolution.verificationStatus).toBe("confirmed_fixed")
    expect(result.dharmaResult.dharmaEntry.contributorDigest).toBe("bob")
    expect(result.dharmaResult.ledger.balances.get("bob")).toBe(1)
    expect(result.dharmaResult.benefitEvent.benefitKind).toBe("reuse")
  })

  test("throws for non-accepted proposal", () => {
    const request = createDebugRequest("Bug", "desc", "session-1", "alice", "major", "crash")
    const proposal = createDebugProposal(request.requestId, "Fix", "desc", "bob")
    const policy = createBugResolutionBenefitPolicy("bp-1")
    expect(() => promoteAcceptedProposal(proposal, request, "alice", "receipt", policy, addPolicy(createBenefitStore(), policy), createDharmaLedger())).toThrow()
  })

  test("includes evidence contributors in dharma", () => {
    const store = createDebugStore()
    const request = createDebugRequest("Bug", "desc", "session-1", "alice", "major", "crash")
    const s1 = addRequest(store, request)
    const r1 = addProposal(s1, { ...createDebugProposal(request.requestId, "Fix", "desc", "bob"), claims: [{ claimId: "c1", statement: "fix", claimType: "fact", supportRefs: [], scope: { hardwareTargets: [], softwareVersions: [], modelFamilies: [], contextNotes: [] }, confidence: 0.8 }], evidenceRefs: [{ receiptDigest: "r1", contributionId: "charlie", artifactDigest: "a1", description: "log" }, { receiptDigest: "r2", contributionId: "dave", artifactDigest: "a2", description: "trace" }] }, true)
    const accepted = acceptProposal(r1.store.proposals.get(r1.store.proposalsByRequest.get(request.requestId)![0])!)
    const policy = createBugResolutionBenefitPolicy("bp-1")
    const result = promoteAcceptedProposal(accepted, request, "alice", "receipt", policy, addPolicy(createBenefitStore(), policy), createDharmaLedger())
    expect(result.dharmaResult.ledger.balances.get("bob")).toBe(1)
    const allocContributors = result.dharmaResult.benefitEvent.allocations.map((a) => a.recipientIdentityDigest)
    expect(allocContributors).toContain("charlie")
    expect(allocContributors).toContain("dave")
  })

  test("maps crash category to failure_mode knowledge class", () => {
    const { request, accepted } = setupProposal()
    const policy = createBugResolutionBenefitPolicy("bp-1")
    const result = promoteAcceptedProposal(accepted, request, "alice", "receipt", policy, addPolicy(createBenefitStore(), policy), createDharmaLedger())
    expect(result.codexEntry.knowledgeClass).toBe("failure_mode")
  })
})
