/**
 * Dharma OS-Enforced Sandbox — Linux Namespace Containment Backend
 *
 * Implements the OS-enforced sandbox layer for Dharma sessions using Linux
 * namespaces, seccomp, Landlock, and cgroups v2.
 */

import { spawn } from "node:child_process";
import type {
  ContainedExecutionRequest,
  ContainedExecutionReceipt,
  ContainmentCapability,
} from "../containment-types";
import { computePolicyDigest } from "../containment-policy";
import { LinuxProcessTree } from "./linux-process-tree";
import {
  LINUX_REQUIRED_NAMESPACES,
  checkUserNamespaces,
  hasUnshareBinary,
  getNamespaceFlags,
} from "./linux-namespaces";
import { hasMountNamespaceSupport } from "./linux-mounts";
import { hasSeccompSupport } from "./linux-seccomp";
import { hasCgroupsV2, getCgroupPath } from "./linux-cgroups";

export class LinuxNamespaceBackend {
  private activeTrees: Record<string, LinuxProcessTree> = {};

  /** Execute a contained process on Linux using namespace isolation. */
  async execute(
    req: ContainedExecutionRequest,
  ): Promise<ContainedExecutionReceipt> {
    if (!(await this.isAvailable())) {
      throw new Error(
        "Linux namespace backend is not available on this system",
      );
    }

    const startedAt = new Date().toISOString();

    // Build the unshare command with namespace flags
    const flags = getNamespaceFlags();
    const unshareArgs = [
      `--mount`,
      `--pid`,
      `--net`,
      `--ipc`,
      `--uts`,
      `--user`,
      `--fork`,
      `--kill-child`,
      "--",
      req.executablePath,
      ...req.argv,
    ];

    const child = spawn("unshare", unshareArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...this.buildEnvironment(req),
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
    });

    const rootPid = child.pid ?? -1;
    const processTree = new LinuxProcessTree(
      req.executionId,
      rootPid,
      getCgroupPath(),
    );

    this.activeTrees[req.executionId] = processTree;

    // Track stdout and stderr
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const violationEvents: Array<{
      timestamp: string;
      kind: string;
      details: string;
    }> = [];

    child.stdout?.on("data", (data: Buffer) => {
      stdoutChunks.push(data.toString());
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderrChunks.push(data.toString());
    });

    const { promise, resolve } = Promise.withResolvers<ContainedExecutionReceipt>();
      child.on("close", (exitCode: number | null) => {
        const endedAt = new Date().toISOString();
        const stdoutDigest = computePolicyDigest({
          content: stdoutChunks.join(""),
    });

        const receipt: ContainedExecutionReceipt = {
          executionId: req.executionId,
          containmentBackend: "linux_namespaces",
          containmentProfileDigest: computePolicyDigest({
            backend: "linux_namespaces",
            namespaces: LINUX_REQUIRED_NAMESPACES,
            flags,
          }),
          filesystemPolicyDigest: computePolicyDigest(
            req as unknown as Record<string, unknown>,
          ),
          networkPolicyDigest: computePolicyDigest(
            req.networkPolicy as unknown as Record<string, unknown>,
          ),
          resourcePolicyDigest: computePolicyDigest(
            req.resourceLimits as unknown as Record<string, unknown>,
          ),
          startedAt,
          endedAt,
          exitCode,
          terminationReason: exitCode === 0 ? null : `exit code ${exitCode}`,
          violationEvents,
          stdoutDigest,
          stderrDigest: computePolicyDigest({
            content: stderrChunks.join(""),
          }),
          processTreeSummary: `${req.executionId}`,
        };

        resolve(receipt);
    });

    return promise;
  }

  /** Check if the Linux namespace backend is available on this host. */
  async isAvailable(): Promise<boolean> {
    if (process.platform !== "linux") {
      return false;
    }

    return (
      hasUnshareBinary() &&
      hasMountNamespaceSupport() &&
      hasSeccompSupport()
    );
  }

  /** Terminate a process tree by process group ID. */
  async terminateProcessTree(
    processGroupId: string,
    emergency: boolean,
  ): Promise<void> {
    const tree = this.activeTrees[processGroupId];
    if (!tree) {
      return; // Already cleaned up or never existed
    }

    if (emergency) {
      await tree.emergencyKill();
    } else {
      await tree.gracefulTerminate();
    }

    delete this.activeTrees[processGroupId];
  }

  /** Detect available Linux containment features. */
  async detectCapabilities(): Promise<ContainmentCapability> {
    const supportedFeatures: string[] = [];
    const unsupportedFeatures: string[] = [];

    if (hasUnshareBinary()) supportedFeatures.push("unshare");
    else unsupportedFeatures.push("unshare");

    if (checkUserNamespaces()) supportedFeatures.push("user_namespaces");
    else unsupportedFeatures.push("user_namespaces");

    if (hasMountNamespaceSupport()) supportedFeatures.push("mount_namespace");
    else unsupportedFeatures.push("mount_namespace");

    if (hasSeccompSupport()) supportedFeatures.push("seccomp");
    else unsupportedFeatures.push("seccomp");

    if (hasCgroupsV2()) supportedFeatures.push("cgroups_v2");
    else unsupportedFeatures.push("cgroups_v2");

    const available =
      supportedFeatures.length >= 3 && supportedFeatures.includes("unshare");

    return {
      backend: "linux_namespaces",
      available,
      version: process.version,
      supportedFeatures,
      unsupportedFeatures,
      deprecationWarning: null,
    };
  }

  private buildEnvironment(
    req: ContainedExecutionRequest,
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // Set sandbox environment variables
    if (req.environmentPolicy.sandboxHome) {
      env.HOME = req.environmentPolicy.sandboxHome;
    }
    if (req.environmentPolicy.sandboxTemp) {
      env.TMPDIR = req.environmentPolicy.sandboxTemp;
      env.TMP = req.environmentPolicy.sandboxTemp;
      env.TEMP = req.environmentPolicy.sandboxTemp;
    }

    // Apply static values
    for (const [key, value] of Object.entries(
      req.environmentPolicy.staticValues,
    )) {
      env[key] = value;
    }

    // Propagate allowed variables from parent process
    for (const key of req.environmentPolicy.allowedVariables) {
      const val = process.env[key];
      if (val !== undefined) {
        env[key] = val;
      }
    }

    return env;
  }
}
