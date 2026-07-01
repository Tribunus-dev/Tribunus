/**
 * Dharma Multi-Peer Result Convergence — In-Memory API
 *
 * Provides an in-memory API surface that wraps the pure state-machine
 * and domain functions in the multi-peer sub-modules. All data lives in
 * Maps; no persistence, no IO.
 */

import crypto from "node:crypto"
import {
  type DharmaTaskContract,
  type TaskStatus,
  type TaskKind,
  type DharmaTaskClaim,
  type SourceDisclosurePackage,
  type DisclosureClass,
  type SessionResultBundle,
  type ResultValidation,
  type CanonicalSessionOutcome,
  type SessionResultConflict,
  type ArtifactAccessRequest,
  type ArtifactAccessDecision,
} from "./multi-peer-types"
import {
  TaskError,
  ClaimError,
  SourcePackageError,
  ResultValidationError,
  ConflictError,
  ArtifactAccessError,
} from "./multi-peer-errors"
import {
  createTask as buildTask,
  applyTaskAction,
  isTaskClaimable,
} from "./multi-peer-tasks"
import {
  createClaim as buildClaim,
  applyClaimAction,
  canClaimTask,
  isClaimActive,
} from "./multi-peer-claims"
import {
  validateResultBundle,
} from "./multi-peer-validation"
import {
  createSourcePackage as buildSourcePackage,
} from "./multi-peer-source"
import {
  createAccessRequest as buildAccessRequest,
  createAccessDecision as buildAccessDecision,
} from "./multi-peer-artifact"
import {
  createFirstOutcome,
  createNextOutcome,
  getOutcomeChain,
} from "./multi-peer-outcome"
import {
  detectConflict,
  createConflictRecord,
  resolveConflict as applyConflictResolution,
} from "./multi-peer-conflict"

// ── MultiPeerApi ──────────────────────────────────────────────────────────────

export class MultiPeerApi {
  private readonly tasks = new Map<string, DharmaTaskContract>()
  private readonly claims = new Map<string, DharmaTaskClaim>()
  private readonly sourcePackages = new Map<string, SourceDisclosurePackage>()
  private readonly resultBundles = new Map<string, SessionResultBundle>()
  private readonly conflicts = new Map<string, SessionResultConflict>()
  private readonly artifactRequests = new Map<string, ArtifactAccessRequest>()
  private readonly artifactDecisions = new Map<string, ArtifactAccessDecision>()
  private readonly canonicalOutcomes = new Map<string, CanonicalSessionOutcome>()

  // Apply a task action, skipping it if the current state cannot transition.
  private tryAdvanceTask(task: DharmaTaskContract, action: Parameters<typeof applyTaskAction>[1]): DharmaTaskContract {
    try {
      const newStatus = applyTaskAction(task.status, action)
      return { ...task, status: newStatus as TaskStatus, updatedAt: new Date().toISOString() }
    } catch {
      return task
    }
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  createTask(config: Partial<DharmaTaskContract>): DharmaTaskContract {
    const sessionId = config.sessionId ?? ""
    const createdBy = config.createdByIdentityPublicKey ?? ""
    const title = config.title ?? ""
    const taskKind: TaskKind = config.taskKind ?? "investigation"
    const sourceBasisDigest = config.sourceBasisDigest ?? crypto.randomUUID()

    if (!sessionId || !createdBy || !title) {
      throw new TaskError("sessionId, createdByIdentityPublicKey, and title are required")
    }

    const task = buildTask({
      sessionId,
      createdBy,
      title,
      taskKind,
      sourceBasisDigest,
      parallelism: config.parallelism,
      allowedPathScopes: config.allowedPathScopes,
    })

    const merged: DharmaTaskContract = {
      ...task,
      summary: config.summary ?? task.summary,
      deniedPathScopes: config.deniedPathScopes ?? task.deniedPathScopes,
      expectedArtifactClasses: config.expectedArtifactClasses ?? task.expectedArtifactClasses,
      verificationContract: config.verificationContract ?? task.verificationContract,
      acceptancePolicy: config.acceptancePolicy ?? task.acceptancePolicy,
      requiredCapabilities: config.requiredCapabilities ?? task.requiredCapabilities,
      assignedMembershipIds: config.assignedMembershipIds ?? task.assignedMembershipIds,
      maxContributors: config.maxContributors ?? task.maxContributors,
      maxResultBundles: config.maxResultBundles ?? task.maxResultBundles,
      claimDeadline: config.claimDeadline ?? task.claimDeadline,
      completionDeadline: config.completionDeadline ?? task.completionDeadline,
      status: config.status ?? task.status,
      signature: config.signature ?? task.signature,
    }

    this.tasks.set(merged.taskId, merged)
    return merged
  }

  publishTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) throw new TaskError(`Task not found: ${taskId}`)

    // draft -> published -> available (fully open for claiming)
    let updated = this.tryAdvanceTask(task, "publish")
    updated = this.tryAdvanceTask(updated, "make_available")
    this.tasks.set(taskId, updated)
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) throw new TaskError(`Task not found: ${taskId}`)

    const updated = this.tryAdvanceTask(task, "cancel")
    this.tasks.set(taskId, updated)
  }

  listTasks(sessionId?: string): DharmaTaskContract[] {
    const all = Array.from(this.tasks.values())
    if (sessionId) return all.filter((t) => t.sessionId === sessionId)
    return all
  }

  getTask(taskId: string): DharmaTaskContract | undefined {
    return this.tasks.get(taskId)
  }

  // ── Claims ─────────────────────────────────────────────────────────────────

  claimTask(
    taskId: string,
    claimantIdentity: string,
    claimantMembershipId: string,
  ): DharmaTaskClaim {
    const task = this.tasks.get(taskId)
    if (!task) throw new TaskError(`Task not found: ${taskId}`)

    if (!isTaskClaimable(task)) {
      throw new ClaimError(`Task ${taskId} is not available for claiming`)
    }

    const existingClaims = Array.from(this.claims.values()).filter(
      (c) => c.taskId === taskId,
    )
    const check = canClaimTask(task, existingClaims)
    if (!check.allowed) {
      throw new ClaimError(check.reason ?? "Cannot claim task")
    }

    const claim = buildClaim({
      taskId,
      sessionId: task.sessionId,
      claimantIdentity,
      claimantMembershipId,
      sourceBasisDigest: task.sourceBasisDigest,
    })

    const advanced = applyClaimAction(claim.status, "claim")
    const storedClaim: DharmaTaskClaim = { ...claim, status: advanced }
    this.claims.set(storedClaim.claimId, storedClaim)

    // Advance task: available -> claimed
    const updatedTask = this.tryAdvanceTask(task, "claim")
    this.tasks.set(taskId, updatedTask)

    return storedClaim
  }

  releaseTaskClaim(claimId: string): void {
    const claim = this.claims.get(claimId)
    if (!claim) throw new ClaimError(`Claim not found: ${claimId}`)
    if (!isClaimActive(claim)) {
      throw new ClaimError(`Claim ${claimId} is not active`)
    }

    const newStatus = applyClaimAction(claim.status, "release")
    this.claims.set(claimId, { ...claim, status: newStatus })
  }

  getTaskClaim(claimId: string): DharmaTaskClaim | undefined {
    return this.claims.get(claimId)
  }

  // ── Source Packages ────────────────────────────────────────────────────────

  createSourcePackage(
    config: Partial<SourceDisclosurePackage>,
  ): SourceDisclosurePackage {
    const sessionId = config.sessionId ?? ""
    const sourceBasisDigest = config.sourceBasisDigest ?? crypto.randomUUID()
    const createdBy = config.createdByIdentityPublicKey ?? ""

    if (!sessionId || !createdBy) {
      throw new SourcePackageError("sessionId and createdByIdentityPublicKey are required")
    }

    const pkg = buildSourcePackage({
      sessionId,
      sourceBasisDigest,
      createdBy,
      disclosureClass: config.disclosureClass ?? "full_snapshot",
      sourceScope: config.sourceScope,
      intendedMembershipIds: config.intendedMembershipIds ?? [],
    })

    const merged: SourceDisclosurePackage = {
      ...pkg,
      encryptedPayloadReference:
        config.encryptedPayloadReference ?? pkg.encryptedPayloadReference,
      artifactReferences: config.artifactReferences ?? pkg.artifactReferences,
      expiresAt: config.expiresAt ?? pkg.expiresAt,
      signature: config.signature ?? pkg.signature,
    }

    this.sourcePackages.set(merged.packageId, merged)
    return merged
  }

  authorizeSourcePackage(packageId: string, membershipId: string): void {
    const pkg = this.sourcePackages.get(packageId)
    if (!pkg) {
      throw new SourcePackageError(`Source package not found: ${packageId}`)
    }

    if (!pkg.intendedMembershipIds.includes(membershipId)) {
      this.sourcePackages.set(packageId, {
        ...pkg,
        intendedMembershipIds: [...pkg.intendedMembershipIds, membershipId],
      })
    }
  }

  getSourcePackageManifest(
    packageId: string,
  ): SourceDisclosurePackage | undefined {
    return this.sourcePackages.get(packageId)
  }

  // ── Result Bundles ─────────────────────────────────────────────────────────

  submitResultBundle(
    config: Partial<SessionResultBundle>,
  ): SessionResultBundle {
    const sessionId = config.sessionId ?? ""
    const taskId = config.taskId ?? ""
    const actorIdentity = config.actorIdentityPublicKey ?? ""

    if (!sessionId || !taskId || !actorIdentity) {
      throw new ResultValidationError(
        "sessionId, taskId, and actorIdentityPublicKey are required",
      )
    }

    const result: SessionResultBundle = {
      resultId: crypto.randomUUID(),
      sessionId,
      taskId,
      actorIdentityPublicKey: actorIdentity,
      actorMembershipId: config.actorMembershipId ?? "",
      claimId: config.claimId ?? "",
      sourceBasisDigest: config.sourceBasisDigest ?? "",
      sourceDisclosurePackageId: config.sourceDisclosurePackageId ?? "",
      environmentDigest: config.environmentDigest ?? "",
      containmentProfileDigest: config.containmentProfileDigest ?? "",
      localSandboxAttestation: config.localSandboxAttestation ?? "",
      patchDigest: config.patchDigest ?? null,
      changedPathDigests: config.changedPathDigests ?? [],
      artifactDigests: config.artifactDigests ?? [],
      testReceiptDigests: config.testReceiptDigests ?? [],
      benchmarkReceiptDigests: config.benchmarkReceiptDigests ?? [],
      verificationSummary: config.verificationSummary ?? "",
      finalLocalWorkspaceDigest: config.finalLocalWorkspaceDigest ?? "",
      disclosureClass: config.disclosureClass ?? "full_snapshot",
      createdAt: new Date().toISOString(),
      signature: config.signature ?? "",
    }

    this.resultBundles.set(result.resultId, result)

    const task = this.tasks.get(taskId)
    if (task) {
      // Advance task claimed -> in_progress -> result_submitted
      let updatedTask = this.tryAdvanceTask(task, "start")
      updatedTask = this.tryAdvanceTask(updatedTask, "submit_result")
      this.tasks.set(taskId, updatedTask)

      const sessionOutcomes = Array.from(this.canonicalOutcomes.values()).filter(
        (o) => o.sessionId === sessionId,
      )
      const detection = detectConflict(result, sessionOutcomes, task)
      if (detection.hasConflict) {
        const conflictRecord = createConflictRecord({
          sessionId,
          taskId,
          proposedResultId: result.resultId,
          conflictKind: detection.conflictKind ?? "path_overlap",
          overlappingPaths: detection.overlappingPaths,
          baseDigest: result.sourceBasisDigest,
          currentCanonicalDigest: "",
        })
        this.conflicts.set(conflictRecord.conflictId, conflictRecord)
      }
    }

    return result
  }

  listResultBundles(sessionId?: string): SessionResultBundle[] {
    const all = Array.from(this.resultBundles.values())
    if (sessionId) return all.filter((r) => r.sessionId === sessionId)
    return all
  }

  verifyResultBundle(resultId: string): ResultValidation {
    const bundle = this.resultBundles.get(resultId)
    if (!bundle) {
      throw new ResultValidationError(`Result bundle not found: ${resultId}`)
    }

    const task = this.tasks.get(bundle.taskId)
    if (!task) {
      return {
        resultId,
        validationState: "pending_verification",
        validationReason: "Task not found for verification",
        policyDigest: null,
        validatorVersion: 1,
        validatedAt: new Date().toISOString(),
      }
    }

    const validation = validateResultBundle(bundle, task)
    return {
      resultId,
      validationState: validation.state,
      validationReason: validation.reason,
      policyDigest: null,
      validatorVersion: 1,
      validatedAt: new Date().toISOString(),
    }
  }

  acceptResultBundle(
    resultId: string,
    acceptedBy: string,
  ): CanonicalSessionOutcome {
    const bundle = this.resultBundles.get(resultId)
    if (!bundle) {
      throw new ResultValidationError(`Result bundle not found: ${resultId}`)
    }

    const task = this.tasks.get(bundle.taskId)
    if (task) {
      // Advance task result_submitted -> accepted
      const updatedTask = this.tryAdvanceTask(task, "accept")
      this.tasks.set(bundle.taskId, updatedTask)
    }

    const existing = Array.from(this.canonicalOutcomes.values()).filter(
      (o) => o.sessionId === bundle.sessionId,
    )
    const ordered = getOutcomeChain(existing)
    const last = ordered.length > 0 ? ordered[ordered.length - 1] : undefined

    let outcome: CanonicalSessionOutcome
    if (last) {
      outcome = createNextOutcome(last, {
        acceptedResultId: resultId,
        acceptedBy,
        canonicalOutcomeDigest: bundle.finalLocalWorkspaceDigest,
        changedPathDigests: bundle.changedPathDigests,
      })
    } else {
      outcome = createFirstOutcome({
        sessionId: bundle.sessionId,
        acceptedResultId: resultId,
        acceptedBy,
        sourceBasisDigest: bundle.sourceBasisDigest,
        canonicalOutcomeDigest: bundle.finalLocalWorkspaceDigest,
        changedPathDigests: bundle.changedPathDigests,
      })
    }

    this.canonicalOutcomes.set(outcome.outcomeId, outcome)
    return outcome
  }

  rejectResultBundle(resultId: string): void {
    const bundle = this.resultBundles.get(resultId)
    if (!bundle) {
      throw new ResultValidationError(`Result bundle not found: ${resultId}`)
    }

    const task = this.tasks.get(bundle.taskId)
    if (task) {
      const updatedTask = this.tryAdvanceTask(task, "reject")
      this.tasks.set(bundle.taskId, updatedTask)
    }
  }

  // ── Conflicts ──────────────────────────────────────────────────────────────

  listConflicts(sessionId?: string): SessionResultConflict[] {
    const all = Array.from(this.conflicts.values())
    if (sessionId) return all.filter((c) => c.sessionId === sessionId)
    return all
  }

  requestRebase(conflictId: string): void {
    const conflict = this.conflicts.get(conflictId)
    if (!conflict) throw new ConflictError(conflictId, `Conflict not found: ${conflictId}`)

    const resolved = applyConflictResolution(conflict, "rebase")
    this.conflicts.set(conflictId, resolved)
  }

  resolveConflict(
    conflictId: string,
    resolution: "reject" | "rebase" | "resolve",
  ): void {
    const conflict = this.conflicts.get(conflictId)
    if (!conflict) throw new ConflictError(conflictId, `Conflict not found: ${conflictId}`)

    const resolved = applyConflictResolution(conflict, resolution)
    this.conflicts.set(conflictId, resolved)
  }

  // ── Artifact Access ────────────────────────────────────────────────────────

  requestArtifactAccess(
    artifactDigest: string,
    requesterMembershipId: string,
  ): ArtifactAccessRequest {
    const request = buildAccessRequest({
      sessionId: "",
      artifactDigest,
      requesterMembershipId,
      purpose: "result verification",
    })
    this.artifactRequests.set(request.requestId, request)
    return request
  }

  decideArtifactAccess(
    requestId: string,
    decision: string,
    decidedBy: string,
  ): ArtifactAccessDecision {
    const req = this.artifactRequests.get(requestId)
    if (!req) throw new ArtifactAccessError(`Access request not found: ${requestId}`)

    const isGranted = decision === "granted" || decision === "approved"
    const result = buildAccessDecision({
      requestId,
      sessionId: req.sessionId,
      decision: isGranted ? "granted" : "denied",
      decidedBy,
      deliveryRef: isGranted ? crypto.randomUUID() : undefined,
    })
    this.artifactDecisions.set(result.requestId, result)
    return result
  }

  // ── Canonical Outcomes ─────────────────────────────────────────────────────

  getCanonicalOutcome(sessionId: string): CanonicalSessionOutcome | undefined {
    const outcomes = Array.from(this.canonicalOutcomes.values()).filter(
      (o) => o.sessionId === sessionId,
    )
    const ordered = getOutcomeChain(outcomes)
    return ordered.length > 0 ? ordered[ordered.length - 1] : undefined
  }

  getCanonicalOutcomeHistory(sessionId: string): CanonicalSessionOutcome[] {
    const outcomes = Array.from(this.canonicalOutcomes.values()).filter(
      (o) => o.sessionId === sessionId,
    )
    return getOutcomeChain(outcomes)
  }
}
