/**
 * Dharma Live Sandbox — Storage Layout Paths
 *
 * Defines deterministic storage paths for session sandbox content.
 * Each session is materialized under:
 *   <profile>/dharma/sessions/<session_id>/
 */

import * as path from "node:path"

export interface SandboxLayoutPaths {
  root: string
  sessionJson: string
  sourceManifestJson: string
  sandboxPolicyJson: string
  workspaceDigestsJson: string
  aggregateJson: string
  commandReceiptsDir: string
  mutationReceiptsDir: string
  sourceBaseDir: string
  canonicalDir: string
  overlaysDir: string
  ownerOverlayDir: string
  peerOverlayDir: (membershipId: string) => string
  executionWorkDir: string
  executionTmpDir: string
  executionLogsDir: string
  executionProcessDir: string
  executionArtifactsDir: string
  controllerLock: string
  activeProcessesJson: string
  keyEpochJson: string
}

/**
 * Build the full sandbox layout for a given session.
 */
export function buildSandboxLayout(profileDataRoot: string, sessionId: string): SandboxLayoutPaths {
  const sessionRoot = path.join(profileDataRoot, "dharma", "sessions", sessionId)
  const metaDir = path.join(sessionRoot, "metadata")
  const sourceDir = path.join(sessionRoot, "source")
  const executionDir = path.join(sessionRoot, "execution")
  const runtimeDir = path.join(sessionRoot, "runtime")

  return {
    root: sessionRoot,
    sessionJson: path.join(metaDir, "session.json"),
    sourceManifestJson: path.join(metaDir, "source-manifest.json"),
    sandboxPolicyJson: path.join(metaDir, "sandbox-policy.json"),
    workspaceDigestsJson: path.join(metaDir, "workspace-digests.json"),
    aggregateJson: path.join(metaDir, "aggregate.json"),
    commandReceiptsDir: path.join(metaDir, "command-receipts"),
    mutationReceiptsDir: path.join(metaDir, "mutation-receipts"),
    sourceBaseDir: path.join(sourceDir, "base"),
    canonicalDir: path.join(sourceDir, "canonical"),
    overlaysDir: path.join(sourceDir, "overlays"),
    ownerOverlayDir: path.join(sourceDir, "overlays", "owner"),
    peerOverlayDir: (membershipId: string) => path.join(sourceDir, "overlays", `peer-${membershipId}`),
    executionWorkDir: path.join(executionDir, "work"),
    executionTmpDir: path.join(executionDir, "tmp"),
    executionLogsDir: path.join(executionDir, "logs"),
    executionProcessDir: path.join(executionDir, "process"),
    executionArtifactsDir: path.join(executionDir, "artifacts"),
    controllerLock: path.join(runtimeDir, "controller.lock"),
    activeProcessesJson: path.join(runtimeDir, "active-processes.json"),
    keyEpochJson: path.join(runtimeDir, "key-epoch.json"),
  }
}

/**
 * Get the sandbox root directory for a session.
 */
export function getSandboxRoot(profileDataRoot: string, sessionId: string): string {
  return path.join(profileDataRoot, "dharma", "sessions", sessionId)
}

/**
 * Get the overlay directory for a specific member.
 */
export function getOverlayDir(profileDataRoot: string, sessionId: string, membershipId: string): string {
  return path.join(getSandboxRoot(profileDataRoot, sessionId), "source", "overlays", `peer-${membershipId}`)
}
