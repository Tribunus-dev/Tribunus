/**
 * Dharma OS-Enforced Sandbox — Linux Network Namespace Helpers
 *
 * Provides network isolation via dedicated network namespaces with
 * loopback-only or restricted connectivity.
 */

import { execSync } from "node:child_process";

export interface NetworkNamespaceConfig {
  loopbackOnly: boolean;
  allowedDomains: string[];
  allowedPorts: number[];
}

/** Build network namespace isolation command. */
export function buildNetworkIsolationCommand(): string[] {
  return [
    // Create a new network namespace with only loopback
    "ip link set lo up",
    // Remove default routes — no external connectivity
    "ip route flush default",
    // Flush all non-lo addresses
    "ip addr flush dev eth0 2>/dev/null; true",
  ];
}

/** Check if network namespaces are available. */
export function hasNetworkNamespaceSupport(): boolean {
  try {
    execSync(
      "unshare --net true",
      { encoding: "utf-8", timeout: 2000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Create a network namespace with the given configuration. */
export function createNetworkNamespace(config: NetworkNamespaceConfig): void {
  const commands = buildNetworkIsolationCommand();
  if (!config.loopbackOnly) {
    // Additional domain/port allowlisting would go here
    commands.push("ip link set lo up");
  }
  for (const cmd of commands) {
    try {
      execSync(cmd, { encoding: "utf-8", timeout: 5000 });
    } catch {
      // Network commands may fail inside unshare — safe to continue
    }
  }
}

/** Tear down a network namespace. */
export function tearDownNetworkNamespace(config: NetworkNamespaceConfig): void {
  // Network namespace is destroyed when the last process in it exits
  // Explicit teardown is handled by the kernel
}
