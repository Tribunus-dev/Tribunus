/**
 * Dharma Multi-Peer Three-Node Proof — convergence test
 *
 * Simulates one owner + two peers working from the same source revision
 * on independent tasks using the real state machine modules. Verifies
 * that all nodes converge on an identical canonical outcome chain.
 */

import { describe, test, expect } from "bun:test"
import type { DharmaTaskContract, DharmaTaskClaim } from "../multi-peer-types"
import { createTask, applyTaskAction, isTaskClaimable } from "../multi-peer-tasks"
import { createClaim, applyClaimAction, canClaimTask } from "../multi-peer-claims"
import { validateResultBundle, checkPathScope } from "../multi-peer-validation"
import { createFirstOutcome, createNextOutcome, verifyOutcomeChain } from "../multi-peer-outcome"
import { checkPathOverlap } from "../multi-peer-conflict"
import type { CanonicalSessionOutcome, SessionResultBundle } from "../multi-peer-types"

// ── Constants ───────────────────────────────────────────────────────────────

const SESSION_ID = "session-three-node-001"
const OWNER_KEY = "owner-pub-key-alpha"
const PEER_A_KEY = "peer-pub-key-A"
const PEER_B_KEY = "peer-pub-key-B"
const PEER_A_MEMBERSHIP = "membership-peer-A"
const PEER_B_MEMBERSHIP = "membership-peer-B"
const SOURCE_BASIS_DIGEST = "sha256-source-revision-v1-abc123"

// ── Factory Helpers ─────────────────────────────────────────────────────────

function makeResultBundle(overrides: Partial<SessionResultBundle> = {}): SessionResultBundle {
  return {
    resultId: "result-default",
    sessionId: SESSION_ID,
    taskId: "task-default",
    actorIdentityPublicKey: PEER_A_KEY,
    actorMembershipId: PEER_A_MEMBERSHIP,
    claimId: "claim-default",
    sourceBasisDigest: SOURCE_BASIS_DIGEST,
    sourceDisclosurePackageId: "pkg-default",
    environmentDigest: "env-default",
    containmentProfileDigest: "profile-default",
    localSandboxAttestation: "attest-default",
    patchDigest: null,
    changedPathDigests: [],
    artifactDigests: [],
    testReceiptDigests: [],
    benchmarkReceiptDigests: [],
    verificationSummary: "all tests pass, 92% coverage, attested",
    finalLocalWorkspaceDigest: "workspace-default",
    disclosureClass: "patch_context_only",
    createdAt: "2026-06-30T10:10:00.000Z",
    signature: "sig-result-default",
    ...overrides,
  }
}

// ── Convergence Checking ────────────────────────────────────────────────────

interface NodeState {
  identityKey: string
  outcomeChain: CanonicalSessionOutcome[]
}

function isConverged(nodes: NodeState[]): boolean {
  if (nodes.length < 2) return true
  const first = nodes[0].outcomeChain
  if (first.length === 0) return false
  for (let i = 1; i < nodes.length; i++) {
    const chain = nodes[i].outcomeChain
    if (chain.length !== first.length) return false
    for (let j = 0; j < first.length; j++) {
      if (
        chain[j].outcomeId !== first[j].outcomeId ||
        chain[j].canonicalOutcomeDigest !== first[j].canonicalOutcomeDigest ||
        chain[j].parentOutcomeDigest !== first[j].parentOutcomeDigest
      ) {
        return false
      }
    }
  }
  return true
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Three-Node Proof: owner + two peers converge on canonical chain", () => {
  test("full workflow with real state machines: create tasks, claim, submit, accept, converge", () => {
    // ── 1. Owner creates session state ────────────────────────────────────────
    const sessionNode: NodeState = { identityKey: OWNER_KEY, outcomeChain: [] }
    const peerANode: NodeState = { identityKey: PEER_A_KEY, outcomeChain: [] }
    const peerBNode: NodeState = { identityKey: PEER_B_KEY, outcomeChain: [] }

    // ── 2. Owner creates two tasks ──────────────────────────────────────────
    const taskA = createTask({
      sessionId: SESSION_ID,
      createdBy: OWNER_KEY,
      title: "Implement parser module",
      taskKind: "feature_implementation",
      sourceBasisDigest: SOURCE_BASIS_DIGEST,
      parallelism: "parallel_non_overlapping",
      allowedPathScopes: ["sha256:src/parser/"],
    })
    expect(taskA.status).toBe("draft")

    const taskB = createTask({
      sessionId: SESSION_ID,
      createdBy: OWNER_KEY,
      title: "Implement formatter module",
      taskKind: "feature_implementation",
      sourceBasisDigest: SOURCE_BASIS_DIGEST,
      parallelism: "parallel_non_overlapping",
      allowedPathScopes: ["sha256:src/formatter/"],
    })
    expect(taskB.status).toBe("draft")

    // ── 3. Owner transitions tasks through publish chain ─────────────────────
const taskAPublished = { ...taskA, status: applyTaskAction(taskA.status, "publish") } as DharmaTaskContract
    expect(taskAPublished.status).toBe("published")
const taskAAvailable = { ...taskAPublished, status: applyTaskAction(taskAPublished.status, "make_available") } as DharmaTaskContract
    expect(taskAAvailable.status).toBe("available")

const taskBPublished = { ...taskB, status: applyTaskAction(taskB.status, "publish") } as DharmaTaskContract
    expect(taskBPublished.status).toBe("published")
const taskBAvailable = { ...taskBPublished, status: applyTaskAction(taskBPublished.status, "make_available") } as DharmaTaskContract
    expect(taskBAvailable.status).toBe("available")

    expect(isTaskClaimable(taskAAvailable)).toBe(true)
    expect(isTaskClaimable(taskBAvailable)).toBe(true)

    // ── 4. Both peers claim their tasks ────────────────────────────────────
    const canAClaim = canClaimTask(taskAAvailable, [])
    expect(canAClaim.allowed).toBe(true)

    const claimA = createClaim({
      taskId: taskAAvailable.taskId,
      sessionId: SESSION_ID,
      claimantIdentity: PEER_A_KEY,
      claimantMembershipId: PEER_A_MEMBERSHIP,
      sourceBasisDigest: SOURCE_BASIS_DIGEST,
    })
    expect(claimA.taskId).toBe(taskAAvailable.taskId)
    expect(claimA.claimantIdentityPublicKey).toBe(PEER_A_KEY)

    // Claim: available → claimed, then claimed → in_progress
    const claimAAfterClaim = { ...claimA, status: applyClaimAction(claimA.status, "claim") }
    expect(claimAAfterClaim.status).toBe("claimed")
    const claimAInProgress = { ...claimAAfterClaim, status: applyClaimAction(claimAAfterClaim.status, "start_work") }
    expect(claimAInProgress.status).toBe("in_progress")

    const claimB = createClaim({
      taskId: taskBAvailable.taskId,
      sessionId: SESSION_ID,
      claimantIdentity: PEER_B_KEY,
      claimantMembershipId: PEER_B_MEMBERSHIP,
      sourceBasisDigest: SOURCE_BASIS_DIGEST,
    })
    const claimBAfterClaim = { ...claimB, status: applyClaimAction(claimB.status, "claim") }
    expect(claimBAfterClaim.status).toBe("claimed")
    const claimBInProgress = { ...claimBAfterClaim, status: applyClaimAction(claimBAfterClaim.status, "start_work") }
    expect(claimBInProgress.status).toBe("in_progress")

    // ── 5. Both peers submit results ───────────────────────────────────────
    const resultA = makeResultBundle({
      resultId: "result-A-parser",
      taskId: taskAAvailable.taskId,
      claimId: claimA.claimId,
      actorIdentityPublicKey: PEER_A_KEY,
      actorMembershipId: PEER_A_MEMBERSHIP,
      changedPathDigests: [
        "sha256:src/parser/lexer.ts:e3b0c44298fc1",
        "sha256:src/parser/grammar.ts:a7ffc6f8bf1f",
      ],
      finalLocalWorkspaceDigest: "workspace-parser-v2",
      verificationSummary: "all tests pass, 95% coverage, attested",
    })

    const resultB = makeResultBundle({
      resultId: "result-B-formatter",
      taskId: taskBAvailable.taskId,
      claimId: claimB.claimId,
      actorIdentityPublicKey: PEER_B_KEY,
      actorMembershipId: PEER_B_MEMBERSHIP,
      changedPathDigests: [
        "sha256:src/formatter/printer.ts:d4e5f6a7b8c9",
        "sha256:src/formatter/indent.ts:1a2b3c4d5e6f",
      ],
      finalLocalWorkspaceDigest: "workspace-formatter-v2",
      verificationSummary: "all tests pass, 88% coverage, attested",
    })

    // Validate both results
    const validationA = validateResultBundle(resultA, taskAAvailable)
    expect(validationA.state).toBe("verified")
    const validationB = validateResultBundle(resultB, taskBAvailable)
    expect(validationB.state).toBe("verified")

    // Verify non-overlapping paths
    const overlapCheck = checkPathOverlap(resultA.changedPathDigests, resultB.changedPathDigests)
    expect(overlapCheck.overlaps).toBe(false)

    // Advance claim states
    const claimASubmitted = { ...claimAInProgress, status: applyClaimAction(claimAInProgress.status, "submit") }
    expect(claimASubmitted.status).toBe("result_submitted")
    const claimBSubmitted = { ...claimBInProgress, status: applyClaimAction(claimBInProgress.status, "submit") }
    expect(claimBSubmitted.status).toBe("result_submitted")

    // ── 6. Accept results with outcome chaining ────────────────────────────
    // Accept in reverse arrival order (B first)
    const outcomeB = createFirstOutcome({
      sessionId: SESSION_ID,
      acceptedResultId: resultB.resultId,
      acceptedBy: OWNER_KEY,
      sourceBasisDigest: resultB.sourceBasisDigest,
      canonicalOutcomeDigest: `canonical-${resultB.resultId}-${resultB.finalLocalWorkspaceDigest}`,
      changedPathDigests: resultB.changedPathDigests,
    })
    expect(outcomeB.parentOutcomeDigest).toBeNull()

    // Chain outcome A on top of outcome B
    const outcomeA = createNextOutcome(outcomeB, {
      acceptedResultId: resultA.resultId,
      acceptedBy: OWNER_KEY,
      canonicalOutcomeDigest: `canonical-${resultA.resultId}-${resultA.finalLocalWorkspaceDigest}`,
      changedPathDigests: resultA.changedPathDigests,
    })
    expect(outcomeA.parentOutcomeDigest).toBe(outcomeB.canonicalOutcomeDigest)

    // Distribute to all nodes
    const chain = [outcomeB, outcomeA]
    sessionNode.outcomeChain = [...chain]
    peerANode.outcomeChain = [...chain]
    peerBNode.outcomeChain = [...chain]

    // ── 7. Verify convergence ─────────────────────────────────────────────
    const allNodes = [sessionNode, peerANode, peerBNode]
    for (const node of allNodes) {
      expect(node.outcomeChain.length).toBe(2)
    }

    const chainCheck = verifyOutcomeChain(chain)
    expect(chainCheck.valid).toBe(true)

    expect(isConverged(allNodes)).toBe(true)

    // Accept claims
    const claimACompleted = { ...claimASubmitted, status: applyClaimAction(claimASubmitted.status, "complete") }
    const claimBCompleted = { ...claimBSubmitted, status: applyClaimAction(claimBSubmitted.status, "complete") }
    expect(claimACompleted.status).toBe("completed")
    expect(claimBCompleted.status).toBe("completed")
  })

  test("alternative accept order still produces valid chains", () => {
    const resultA = makeResultBundle({
      resultId: "result-A-parser",
      changedPathDigests: ["sha256:src/parser/lexer.ts:e3b0c44298fc1"],
      finalLocalWorkspaceDigest: "ws-parser-v2",
    })
    const resultB = makeResultBundle({
      resultId: "result-B-formatter",
      changedPathDigests: ["sha256:src/formatter/printer.ts:d4e5f6a7b8c9"],
      finalLocalWorkspaceDigest: "ws-formatter-v2",
    })

    // Accept A-first
    const oA = createFirstOutcome({
      sessionId: SESSION_ID,
      acceptedResultId: resultA.resultId,
      acceptedBy: OWNER_KEY,
      sourceBasisDigest: resultA.sourceBasisDigest,
      canonicalOutcomeDigest: `canon-${resultA.resultId}-${resultA.finalLocalWorkspaceDigest}`,
      changedPathDigests: resultA.changedPathDigests,
    })
    const oB = createNextOutcome(oA, {
      acceptedResultId: resultB.resultId,
      acceptedBy: OWNER_KEY,
      canonicalOutcomeDigest: `canon-${resultB.resultId}-${resultB.finalLocalWorkspaceDigest}`,
      changedPathDigests: resultB.changedPathDigests,
    })
    expect(verifyOutcomeChain([oA, oB]).valid).toBe(true)

    // B-first order also produces valid chain
    const oBfirst = createFirstOutcome({
      sessionId: SESSION_ID,
      acceptedResultId: resultB.resultId,
      acceptedBy: OWNER_KEY,
      sourceBasisDigest: resultB.sourceBasisDigest,
      canonicalOutcomeDigest: `canon-${resultB.resultId}-${resultB.finalLocalWorkspaceDigest}`,
      changedPathDigests: resultB.changedPathDigests,
    })
    const oAsecond = createNextOutcome(oBfirst, {
      acceptedResultId: resultA.resultId,
      acceptedBy: OWNER_KEY,
      canonicalOutcomeDigest: `canon-${resultA.resultId}-${resultA.finalLocalWorkspaceDigest}`,
      changedPathDigests: resultA.changedPathDigests,
    })
    expect(verifyOutcomeChain([oBfirst, oAsecond]).valid).toBe(true)
  })

  test("convergence requires all nodes to have the outcome chain", () => {
    const result = makeResultBundle({
      resultId: "result-test",
      changedPathDigests: ["sha256:src/test.ts:abc"],
      finalLocalWorkspaceDigest: "ws-test-v2",
    })

    const outcome = createFirstOutcome({
      sessionId: SESSION_ID,
      acceptedResultId: result.resultId,
      acceptedBy: OWNER_KEY,
      sourceBasisDigest: result.sourceBasisDigest,
      canonicalOutcomeDigest: `canon-${result.resultId}-${result.finalLocalWorkspaceDigest}`,
      changedPathDigests: result.changedPathDigests,
    })

    const nodeA: NodeState = { identityKey: PEER_A_KEY, outcomeChain: [outcome] }
    const nodeB: NodeState = { identityKey: PEER_B_KEY, outcomeChain: [] }

    expect(isConverged([nodeA, nodeB])).toBe(false)

    nodeB.outcomeChain = [...nodeA.outcomeChain]
    expect(isConverged([nodeA, nodeB])).toBe(true)
  })

  test("outcome chain digests form a causal DAG via parent chaining", () => {
    const r1 = makeResultBundle({ resultId: "result-001", finalLocalWorkspaceDigest: "ws-v1" })
    const r2 = makeResultBundle({ resultId: "result-002", finalLocalWorkspaceDigest: "ws-v2" })
    const r3 = makeResultBundle({ resultId: "result-003", finalLocalWorkspaceDigest: "ws-v3" })

    const o1 = createFirstOutcome({
      sessionId: SESSION_ID,
      acceptedResultId: r1.resultId,
      acceptedBy: OWNER_KEY,
      sourceBasisDigest: r1.sourceBasisDigest,
      canonicalOutcomeDigest: `canon-r1-ws-v1`,
      changedPathDigests: r1.changedPathDigests,
    })
    const o2 = createNextOutcome(o1, {
      acceptedResultId: r2.resultId,
      acceptedBy: OWNER_KEY,
      canonicalOutcomeDigest: `canon-r2-ws-v2`,
      changedPathDigests: r2.changedPathDigests,
    })
    const o3 = createNextOutcome(o2, {
      acceptedResultId: r3.resultId,
      acceptedBy: OWNER_KEY,
      canonicalOutcomeDigest: `canon-r3-ws-v3`,
      changedPathDigests: r3.changedPathDigests,
    })

    expect(o1.parentOutcomeDigest).toBeNull()
    expect(o2.parentOutcomeDigest).toBe(o1.canonicalOutcomeDigest)
    expect(o3.parentOutcomeDigest).toBe(o2.canonicalOutcomeDigest)

    const chain = [o1, o2, o3]
    expect(verifyOutcomeChain(chain).valid).toBe(true)

    const digests = new Set(chain.map((o) => o.canonicalOutcomeDigest))
    expect(digests.size).toBe(3)
  })
})
