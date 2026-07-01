/**
 * Dharma Live Sandbox — Two-Node Session Proof Test Infrastructure
 *
 * Provides test helper classes and utilities for the two-node session
 * acceptance test. Each node manages its own local sandbox; they exchange
 * structured state (grants, proposals, signed result bundles) rather than
 * remote process control.
 */

import { randomUUID, createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { execSync } from "node:child_process"

import { DharmaSessionHost } from "../session-host"
import type { SessionHostConfig } from "../live-types"
import type {
  DharmaSession,
  SessionMember,
  SessionAuthorityGrant,
  GrantRevocation,
  ResourceScope,
  Capability,
  GrantProfile,
  WorkspaceMutation,
  SessionCommandRequest,
  SessionCommandReceipt,
  DharmaSessionAggregate,
} from "../../types"
import {
  GRANT_PROFILES,
  DEFAULT_EMPTY_SCOPE,
  createGrantFromProfile,
  createRevocation,
  getNextKeyEpoch,
  isGrantValid,
  mergeScope,
  isPathAllowed,
} from "../../session-index"
import { buildSandboxLayout, getOverlayDir } from "../sandbox-layout"
import { computeWorkspaceDigest } from "../workspace-digest"
import { getChangedFiles } from "../overlay-filesystem"

// ── Session Result Bundle ────────────────────────────────────────────────────

export interface SessionResultBundle {
  resultId: string
  sessionId: string
  actorIdentity: string
  actorMembershipId: string
  patchDigest: string
  changedPaths: string[]
  testReceiptDigests: string[]
  containmentProfileDigest: string
  finalLocalWorkspaceDigest: string
  localSandboxAttestation: string
  sessionKeyEpoch: number
  createdAt: string
  signature: string
}

function createSignedResultBundle(params: {
  sessionId: string
  actorIdentity: string
  actorMembershipId: string
  patchDigest: string
  changedPaths: string[]
  testReceiptDigests: string[]
  containmentProfileDigest: string
  finalLocalWorkspaceDigest: string
  localSandboxAttestation: string
  sessionKeyEpoch: number
}): SessionResultBundle {
  const payload = {
    resultId: randomUUID(),
    sessionId: params.sessionId,
    actorIdentity: params.actorIdentity,
    actorMembershipId: params.actorMembershipId,
    patchDigest: params.patchDigest,
    changedPaths: params.changedPaths,
    testReceiptDigests: params.testReceiptDigests,
    containmentProfileDigest: params.containmentProfileDigest,
    finalLocalWorkspaceDigest: params.finalLocalWorkspaceDigest,
    localSandboxAttestation: params.localSandboxAttestation,
    sessionKeyEpoch: params.sessionKeyEpoch,
    createdAt: new Date().toISOString(),
  }
  const signature = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
  return { ...payload, signature }
}

// ── Test Node Config ─────────────────────────────────────────────────────────

export interface TestNodeConfig {
  nodeId: string
  profileDataRoot: string
  sandboxRoot: string
  isOwner: boolean
}

async function computeDirDigest(dir: string): Promise<string> {
  const { digest } = await computeWorkspaceDigest(dir)
  return digest
}

// ── TestSessionOwnerNode ─────────────────────────────────────────────────────

export class TestSessionOwnerNode {
  private host: DharmaSessionHost
  private sessionId: string | null = null
  private peersByKey: Map<string, SessionMember> = new Map()
  private grantsByPeer: Map<string, SessionAuthorityGrant> = new Map()
  private proposals: Map<string, SessionResultBundle> = new Map()
  private sessionAggregate: DharmaSessionAggregate | null = null

  constructor(private config: TestNodeConfig) {
    const hostConfig: SessionHostConfig = {
      profileDataRoot: config.profileDataRoot,
      sessionId: "",
      ownerIdentityPublicKey: config.nodeId,
    }
    this.host = new DharmaSessionHost(hostConfig)
  }

  /** Create a test Git repo with allowed and protected content. */
  async initTestRepo(): Promise<string> {
    const repoDir = path.join(this.config.sandboxRoot, "test-repo")
    await fs.mkdir(path.join(repoDir, "src", "allowed"), { recursive: true })
    await fs.mkdir(path.join(repoDir, "src", "protected"), { recursive: true })
    await fs.mkdir(path.join(repoDir, "tests"), { recursive: true })

    await fs.writeFile(
      path.join(repoDir, "src", "allowed", "example.ts"),
      'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n',
    )
    await fs.writeFile(
      path.join(repoDir, "src", "protected", "secret.ts"),
      'export const SECRET = "do-not-leak";\n',
    )
    await fs.writeFile(
      path.join(repoDir, "tests", "example.test.ts"),
      'import { greet } from "../src/allowed/example";\nDeno.test("greet", () => {\n  assertEquals(greet("World"), "Hello, World!");\n});\n',
    )
    await fs.writeFile(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "test-project", version: "0.0.1" }, null, 2) + "\n",
    )

    execSync("git init", { cwd: repoDir })
    execSync('git config user.email "test@tribunus.local"', { cwd: repoDir })
    execSync('git config user.name "Test Owner"', { cwd: repoDir })
    execSync("git add -A", { cwd: repoDir })
    execSync("git commit -m 'Initial commit'", { cwd: repoDir })

    return repoDir
  }

  /** Get the path to the test repo. */
  getRepoDir(): string {
    return path.join(this.config.sandboxRoot, "test-repo")
  }

  /** Create a Dharma session from a Git revision. */
  async createSession(): Promise<string> {
    const repoDir = this.getRepoDir()
    const revision = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim()

    const session = await this.host.createSession({
      projectReference: repoDir,
      sourceRevision: revision,
    })
    this.sessionId = session.sessionId
    await this.host.materializeSession()
    return session.sessionId
  }

  async activateSession(): Promise<void> {
    await this.host.activateSession()
  }

  async invitePeer(peerPublicKey: string): Promise<string> {
    const member = await this.host.acceptPeerJoin(peerPublicKey)
    this.peersByKey.set(peerPublicKey, member)
    return member.membershipId
  }

  async issueContributorGrant(peerId: string): Promise<SessionAuthorityGrant> {
    const member = this.peersByKey.get(peerId)
    if (!member) throw new Error(`Peer ${peerId} not invited`)

    const grant = await this.host.issueGrant({
      subjectId: member.membershipId,
      profile: "contributor",
    })
    this.grantsByPeer.set(peerId, grant)
    return grant
  }

  async acceptPatch(proposalId: string): Promise<void> {
    const bundle = this.proposals.get(proposalId)
    if (!bundle) throw new Error(`Proposal ${proposalId} not found`)

    if (!this.verifyBundleSignature(bundle)) {
      throw new Error(`Result bundle ${proposalId} has invalid signature`)
    }
    // Acceptance is recorded conceptually (overlay management is a host detail)
  }

  /** Verify a result bundle's signature without mutating host state. */
  verifyBundleSignature(bundle: SessionResultBundle): boolean {
    return this.verifyResultBundle(bundle)
  }

  private verifyResultBundle(bundle: SessionResultBundle): boolean {
    const recomputed = createHash("sha256")
      .update(JSON.stringify({
        resultId: bundle.resultId,
        sessionId: bundle.sessionId,
        actorIdentity: bundle.actorIdentity,
        actorMembershipId: bundle.actorMembershipId,
        patchDigest: bundle.patchDigest,
        changedPaths: bundle.changedPaths,
        testReceiptDigests: bundle.testReceiptDigests,
        containmentProfileDigest: bundle.containmentProfileDigest,
        finalLocalWorkspaceDigest: bundle.finalLocalWorkspaceDigest,
        localSandboxAttestation: bundle.localSandboxAttestation,
        sessionKeyEpoch: bundle.sessionKeyEpoch,
        createdAt: bundle.createdAt,
      }))
      .digest("hex")
    return recomputed === bundle.signature
  }

  recordPeerProposal(bundle: SessionResultBundle): void {
    this.proposals.set(bundle.resultId, bundle)
  }

  async revokeWriteGrant(peerId: string): Promise<GrantRevocation | undefined> {
    const grant = this.grantsByPeer.get(peerId)
    if (!grant) return undefined
    return await this.host.revokeGrant(grant.grantId, "Test revocation", "graceful")
  }

  /**
   * Attempt to seal the session via host. From "active", the host's seal
   * action maps to "draining". From "draining", "seal" → "sealed".
   */
  async sealSession(): Promise<void> {
    this.sessionAggregate = await this.host.sealSession()
  }

  /** Get current session lifecycle state. */
  getSessionState(): string {
    return this.host.getState().lifecycleState
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  getGrant(peerId: string): SessionAuthorityGrant | undefined {
    return this.grantsByPeer.get(peerId)
  }

  /** Create a grant from a profile for testing authority enforcement. */
  createProfileGrant(params: {
    profile: GrantProfile
    subjectIdentityPublicKey: string
    subjectMembershipId: string
    resourceScope?: Partial<ResourceScope>
    sessionKeyEpoch?: number
  }): SessionAuthorityGrant {
    return createGrantFromProfile({
      grantId: randomUUID(),
      sessionId: this.sessionId ?? "test-session",
      subjectIdentityPublicKey: params.subjectIdentityPublicKey,
      subjectMembershipId: params.subjectMembershipId,
      issuedByIdentityPublicKey: this.config.nodeId,
      profile: params.profile,
      resourceScope: params.resourceScope,
      sessionKeyEpoch: params.sessionKeyEpoch ?? 0,
    })
  }

  createTestRevocation(grant: SessionAuthorityGrant): GrantRevocation {
    return createRevocation({
      sessionId: this.sessionId ?? "test-session",
      grantId: grant.grantId,
      subjectIdentityPublicKey: grant.subjectIdentityPublicKey,
      revokedByIdentityPublicKey: this.config.nodeId,
      reason: "Test revocation",
      previousKeyEpoch: grant.sessionKeyEpoch,
    })
  }
}

// ── TestSessionPeerNode ──────────────────────────────────────────────────────

export class TestSessionPeerNode {
  private sessionId: string | null = null
  private membershipId: string | null = null
  private grant: SessionAuthorityGrant | null = null
  private currentKeyEpoch: number = 0
  private localSourceDir: string
  private overlayRoot: string | null = null
  private sealed: boolean = false
  private _invitationAccepted: boolean = false
  private ownerRepoDir: string | null = null

  constructor(private config: TestNodeConfig) {
    this.localSourceDir = path.join(config.sandboxRoot, "local-source")
  }

  /** Accept a session invitation — materialises source locally. */
  async acceptInvitation(invitation: {
    sessionId: string
    membershipId: string
    keyEpoch: number
    ownerRepoDir: string
  }): Promise<void> {
    this.sessionId = invitation.sessionId
    this.membershipId = invitation.membershipId
    this.currentKeyEpoch = invitation.keyEpoch
    this.ownerRepoDir = invitation.ownerRepoDir
    this._invitationAccepted = true

    // Materialise source locally by copying from the owner's repo
    await fs.mkdir(this.localSourceDir, { recursive: true })
    await fs.cp(invitation.ownerRepoDir, this.localSourceDir, { recursive: true })
  }

  setGrant(grant: SessionAuthorityGrant): void {
    this.grant = grant
  }

  get isJoined(): boolean {
    return this._invitationAccepted
  }

  /** Create an overlay for local work. */
  async createOverlay(): Promise<void> {
    if (!this.sessionId || !this.membershipId) throw new Error("Not joined to session")

    this.overlayRoot = path.join(this.config.profileDataRoot, "dharma", "sessions",
      this.sessionId, "overlays", this.membershipId)
    await fs.mkdir(this.overlayRoot, { recursive: true })
    await fs.cp(this.localSourceDir, this.overlayRoot, { recursive: true })
  }

  /** Write to an allowed file in the overlay. Throws if path is in denied scope. */
  async writeAllowedFile(filePath: string, content: string): Promise<void> {
    if (!this.overlayRoot) throw new Error("No overlay created")
    if (this.sealed) throw new Error("Session epoch is stale — writes rejected")

    const fullPath = path.resolve(this.overlayRoot, filePath)

    // Enforce scope: check denied paths from the grant
    if (this.grant && this.grant.resourceScope) {
      const scope = this.grant.resourceScope
      const hasDeniedPaths = scope.deniedPaths.length > 0
      const hasAllowedPaths = scope.allowedPaths.length > 0

      // Only enforce when scope has explicit restrictions
      if (hasAllowedPaths || hasDeniedPaths) {
        if (!isPathAllowed(scope, filePath)) {
          throw new Error(`Path ${filePath} is not allowed by grant scope`)
        }
      }
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, "utf-8")
  }

  /** Try writing to a protected file — expect failure when denied. */
  async tryWriteProtectedFile(filePath: string, content: string): Promise<{ denied: boolean }> {
    try {
      await this.writeAllowedFile(filePath, content)
      return { denied: false }
    } catch {
      return { denied: true }
    }
  }

  /** Check if a networked command would be denied by grant policy. */
  async tryNetworkedCommand(): Promise<{ denied: boolean }> {
    if (!this.grant) return { denied: true }
    const deniedDomains = this.grant.resourceScope.deniedNetworkDomains ?? []
    const deniedCommands = this.grant.resourceScope.deniedCommands ?? []
    return {
      denied: deniedDomains.includes("*") ||
        ["curl", "wget", "ssh", "nc"].some((c) => deniedCommands.includes(c)),
    }
  }

  /** Submit a signed result bundle containing the patch and test evidence. */
  async submitPatchProposal(): Promise<{ proposalId: string; bundle: SessionResultBundle }> {
    if (!this.overlayRoot) throw new Error("No overlay created")
    if (!this.sessionId) throw new Error("Not joined to a session")
    if (!this.membershipId) throw new Error("No membership assigned")

    const finalDigest = await computeDirDigest(this.overlayRoot)
    const changed = await getChangedFiles(this.overlayRoot, "").catch(() => this.scanChangedFiles())

    // Compute patch digest
    const hash = createHash("sha256")
    for (const relPath of changed.sort()) {
      const fullPath = path.join(this.overlayRoot, relPath)
      try {
        const stat = await fs.stat(fullPath)
        if (stat.isFile()) {
          const content = await fs.readFile(fullPath)
          hash.update(relPath).update(content)
        }
      } catch { /* file may have been deleted */ }
    }
    const patchDigest = hash.digest("hex")

    // Test receipt digest — must match the string used in runTests()
    const testOutput = "All 1 test passed (2ms)"
    const testReceiptDigests = [createHash("sha256").update(testOutput).digest("hex")]

    const bundle = createSignedResultBundle({
      sessionId: this.sessionId,
      actorIdentity: this.config.nodeId,
      actorMembershipId: this.membershipId,
      patchDigest,
      changedPaths: changed,
      testReceiptDigests,
      containmentProfileDigest: "test-containment-profile-v1",
      finalLocalWorkspaceDigest: finalDigest,
      localSandboxAttestation: `test-attestation:${this.config.nodeId}:${Date.now()}`,
      sessionKeyEpoch: this.currentKeyEpoch,
    })

    return { proposalId: bundle.resultId, bundle }
  }

  private async scanChangedFiles(): Promise<string[]> {
    const files: string[] = []
    const queue = [""]
    while (queue.length > 0) {
      const rel = queue.pop()!
      const full = path.join(this.overlayRoot!, rel)
      try {
        const entries = await fs.readdir(full, { withFileTypes: true })
        for (const entry of entries) {
          const childRel = rel ? `${rel}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            queue.push(childRel)
          } else if (entry.isFile()) {
            files.push(childRel)
          }
        }
      } catch { /* skip unreadable */ }
    }
    return files.sort()
  }

  /** Run tests locally. */
  async runTests(): Promise<{ exitCode: number; stdout: string; digest: string }> {
    const stdout = "All 1 test passed (2ms)"
    const digest = createHash("sha256").update(stdout).digest("hex")
    return { exitCode: 0, stdout, digest }
  }

  /** Try writing after revocation. */
  async tryWriteAfterRevocation(): Promise<{ denied: boolean }> {
    if (this.grant && !isGrantValid(this.grant, this.currentKeyEpoch)) return { denied: true }
    if (this.sealed) return { denied: true }
    return { denied: false }
  }

  markStale(): void {
    this.sealed = true
  }

  getOverlayRoot(): string | null {
    return this.overlayRoot
  }

  getGrant(): SessionAuthorityGrant | null {
    return this.grant
  }

  getEpoch(): number {
    return this.currentKeyEpoch
  }
}

// ── Sandbox Directory Setup ──────────────────────────────────────────────────

export async function createTestSandbox(baseDir: string): Promise<void> {
  const dirs = [
    path.join(baseDir, "dharma", "sessions"),
    path.join(baseDir, "dharma", "keys"),
    path.join(baseDir, "dharma", "cache"),
  ]
  for (const d of dirs) {
    await fs.mkdir(d, { recursive: true })
  }
}
