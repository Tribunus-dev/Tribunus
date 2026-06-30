/**
 * Dharma OS-Enforced Sandbox — Linux Mount Namespace Helpers
 *
 * Builds mount command sequences for establishing a private mount namespace
 * with controlled bind mounts, procfs, and tmpfs volumes.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface MountConfig {
  readableBindMounts: string[];
  writableBindMounts: string[];
  procMount: boolean;
  tmpfs: string[];
}

export interface MountPlan {
  readonlyMounts: string[];
  writableMounts: string[];
  procMount: boolean;
  tmpfsPaths: string[];
  commands: string[];
}

/** Build mount command sequence for namespace setup. */
export function buildMountCommands(config: MountConfig): string[] {
  const commands: string[] = [];

  // Make root private (no mount propagation)
  commands.push("mount --make-private /");

  // Create mount points in the namespace root
  commands.push("mount -t tmpfs tmpfs /mnt");

  // Read-only bind mounts
  for (const path of config.readableBindMounts) {
    commands.push(`mount --bind -o ro "${path}" "${path}"`);
  }

  // Writable bind mounts
  for (const path of config.writableBindMounts) {
    commands.push(`mount --bind -o rw "${path}" "${path}"`);
  }

  // proc filesystem
  if (config.procMount) {
    commands.push("mount -t proc proc /proc");
  }

  // tmpfs volumes
  for (const path of config.tmpfs) {
    commands.push(`mount -t tmpfs -o size=64M tmpfs "${path}"`);
  }

  return commands;
}

/** Check if mount namespace is available. */
export function hasMountNamespaceSupport(): boolean {
  try {
    execSync(
      "unshare --mount true",
      { encoding: "utf-8", timeout: 2000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Compile a mount plan from configuration. */
export function compileMountPlan(config: MountConfig): MountPlan {
  const commands = buildMountCommands(config);
  return {
    readonlyMounts: config.readableBindMounts,
    writableMounts: config.writableBindMounts,
    procMount: config.procMount,
    tmpfsPaths: config.tmpfs,
    commands,
  };
}

/** Apply a mount plan by executing mount commands. */
export function applyMountPlan(plan: MountPlan): void {
  for (const cmd of plan.commands) {
    try {
      execSync(cmd, { encoding: "utf-8", timeout: 5000 });
    } catch {
      // Mount may fail if already applied — continue
    }
  }
}
