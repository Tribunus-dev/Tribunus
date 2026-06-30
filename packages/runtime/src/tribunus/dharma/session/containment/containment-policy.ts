/**
 * Dharma OS-Enforced Sandbox — Policy Compiler
 *
 * Compiles a ContainedExecutionRequest into a platform-specific containment
 * profile. Computes deterministic digests for policy artifacts.
 */

import { createHash } from "node:crypto"
import type {
  ContainmentProfile,
  ContainedExecutionRequest,
  FilesystemPolicy,
  NetworkPolicy,
  EnvironmentPolicy,
  ResourceLimits,
  IpcPolicy,
  ProcessPolicy,
  ContainmentBackendKind,
} from "./containment-types"

/** Compute a deterministic SHA-256 digest for any policy object. */
export function computePolicyDigest(obj: Record<string, unknown>): string {
  const canonical = JSON.stringify(obj, Object.keys(obj).sort())
  return createHash("sha256").update(canonical).digest("hex")
}

/** Build a filesystem policy from a request. */
export function compileFilesystemPolicy(req: ContainedExecutionRequest): FilesystemPolicy {
  return {
    readableRoots: [...new Set([
      req.sandboxRoot,
      req.canonicalWorkspaceRoot,
      ...req.readableRoots,
    ])],
    writableRoots: [...new Set([
      ...req.writableRoots,
      ...(req.overlayRoot ? [req.overlayRoot] : []),
    ])],
    deniedRoots: [
      process.env.HOME || "/Users",
      "/etc",
      "/var/root",
      "/private/var/db",
      ...(req.executionId ? [`/tmp/dharma-${req.executionId}`] : []),
    ],
    allowExecutable: req.executablePath,
    allowWorkingDirectory: req.workingDirectory,
    allowSymlinkEscape: false,
    requirePathResolution: true,
  }
}

/** Build a network policy from a request. */
export function compileNetworkPolicy(req: ContainedExecutionRequest): NetworkPolicy {
  return {
    mode: req.networkPolicy.mode,
    allowedDomains: req.networkPolicy.allowedDomains,
    allowedPorts: req.networkPolicy.allowedPorts,
  }
}

/** Build an environment policy from a request. */
export function compileEnvironmentPolicy(req: ContainedExecutionRequest): EnvironmentPolicy {
  return {
    allowedVariables: req.environmentPolicy.allowedVariables,
    deniedVariables: [
      "SSH_AUTH_SOCK", "SSH_AGENT_PID",
      "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
      "GCP_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS",
      "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET",
      "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN", "NPM_TOKEN",
      ...(req.environmentPolicy.deniedVariables || []),
    ],
    staticValues: req.environmentPolicy.staticValues,
    sandboxHome: req.environmentPolicy.sandboxHome,
    sandboxTemp: req.environmentPolicy.sandboxTemp,
  }
}

/** Build resource limits from a request. */
export function compileResourceLimits(req: ContainedExecutionRequest): ResourceLimits {
  return { ...req.resourceLimits }
}

/** Build IPC policy from a request. */
export function compileIpcPolicy(req: ContainedExecutionRequest): IpcPolicy {
  return { ...req.ipcPolicy }
}

/** Build process policy from a request. */
export function compileProcessPolicy(req: ContainedExecutionRequest): ProcessPolicy {
  return { ...req.processPolicy }
}

/** Compile a full containment profile from a request. */
export function compileContainmentProfile(
  req: ContainedExecutionRequest,
  backendKind: ContainmentBackendKind,
): ContainmentProfile {
  const fsPolicy = compileFilesystemPolicy(req)
  const netPolicy = compileNetworkPolicy(req)
  const envPolicy = compileEnvironmentPolicy(req)
  const resLimits = compileResourceLimits(req)
  const ipcPol = compileIpcPolicy(req)
  const procPol = compileProcessPolicy(req)

  const raw: Record<string, unknown> = {
    backendKind,
    filesystemPolicy: fsPolicy,
    networkPolicy: netPolicy,
    resourceLimits: resLimits,
    ipcPolicy: ipcPol,
    processPolicy: procPol,
  }

  return {
    profileId: `profile-${req.executionId}`,
    backendKind,
    filesystemPolicy: fsPolicy,
    networkPolicy: netPolicy,
    environmentPolicy: envPolicy,
    resourceLimits: resLimits,
    ipcPolicy: ipcPol,
    processPolicy: procPol,
    profileDigest: computePolicyDigest(raw),
    createdAt: new Date().toISOString(),
  }
}

/** Check if a backend can satisfy a given set of requirements. */
export function backendCanSatisfy(
  profile: ContainmentProfile,
  availableFeatures: string[],
): { satisfiable: boolean; missingFeatures: string[] } {
  const required: string[] = []
  if (profile.networkPolicy.mode === "none") required.push("network_isolation")
  if (profile.resourceLimits.maximumMemoryBytes > 0) required.push("memory_limits")
  if (profile.processPolicy.allowChildProcesses === false) required.push("process_limits")
  if (profile.filesystemPolicy.deniedRoots.length > 0) required.push("filesystem_isolation")

  const missing = required.filter((f) => !availableFeatures.includes(f))
  return { satisfiable: missing.length === 0, missingFeatures: missing }
}

/** Get default resource limits for a session. */
export function getDefaultResourceLimits(): ResourceLimits {
  return {
    maximumRuntimeSeconds: 300,
    maximumCpuSeconds: 120,
    maximumMemoryBytes: 512 * 1024 * 1024, // 512 MB
    maximumProcessCount: 16,
    maximumOpenFiles: 64,
    maximumDiskWriteBytes: 100 * 1024 * 1024, // 100 MB
    maximumOutputBytes: 1024 * 1024, // 1 MB
    maximumTempBytes: 50 * 1024 * 1024, // 50 MB
    maximumNetworkBytes: 0,
  }
}
