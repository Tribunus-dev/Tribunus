/**
 * Dharma Live Sandbox — Network Isolation
 *
 * Network access denial for sandboxed process execution.
 * Checks whether a given command is network-capable and whether
 * network access is permitted by the scope.
 */

import type { ResourceScope } from "../types"

// ── Known Network-Capable Commands ─────────────────────────────────────────

/**
 * Commands that are inherently capable of network access.
 * These are blocked when the session scope does not grant network permissions.
 */
const NETWORK_CAPABLE_COMMANDS = new Set([
  // Network diagnostics
  "curl", "wget", "nc", "netcat", "ncat",
  "telnet", "ssh", "scp", "sftp", "rsync",
  "ping", "traceroute", "tracert", "mtr",
  "nslookup", "dig", "host", "whois",
  "nmap", "netstat", "ss", "lsof",
  "iftop", "nethogs", "tcpdump", "tshark",
  "iperf", "iperf3",

  // HTTP clients and downloaders
  "httpie", "http", "fetch", "aria2c", "axel",
  "wget2", "httrack",

  // Package managers (network-dependent)
  "npm", "npx", "yarn", "pnpm", "bun",
  "pip", "pip3", "conda", "mamba",
  "apt", "apt-get", "dpkg",
  "yum", "dnf", "rpm",
  "brew", "port",
  "cargo", "gem", "composer",
  "nuget", "dotnet", "go", "mvn", "gradle",

  // Git and VCS
  "git", "hg", "svn",

  // Database clients
  "psql", "mysql", "sqlite3",
  "mongo", "mongosh", "redis-cli",

  // Remote execution
  "docker", "kubectl", "helm",
  "grpcurl", "websocat", "mqtt",

  // Cloud CLIs
  "aws", "gcloud", "az", "doctl",
  "terraform", "pulumi",

  // Interpreters (can be used for network access)
  "deno", "python3", "python",
  "node", "bun", "tsx",
])

// ── Checks ─────────────────────────────────────────────────────────────────

/**
 * Check if a command is potentially network-capable.
 */
export function isNetworkCapable(command: string): boolean {
  const base = command.split("/").pop() ?? command
  return NETWORK_CAPABLE_COMMANDS.has(base)
}

/**
 * Get the full list of denied network commands.
 */
export function getDeniedNetworkCommands(): string[] {
  return [...NETWORK_CAPABLE_COMMANDS]
}

/**
 * Check network capability of a command against the resource scope.
 *
 * A command that is NOT network-capable is always allowed.
 * A network-capable command is allowed only if the scope has
 * allowedNetworkDomains entries (indicating networking is configured).
 */
export function checkNetworkAccess(
  command: string,
  scope: ResourceScope,
): { allowed: boolean; reason: string | null } {
  const base = command.split("/").pop() ?? command

  if (!isNetworkCapable(base)) {
    return { allowed: true, reason: null }
  }

  // Network-capable command: only allowed if scope permits network access.
  // Allowed network domains being non-empty signals networking is enabled.
  if (scope.allowedNetworkDomains.length > 0) {
    return { allowed: true, reason: null }
  }

  return {
    allowed: false,
    reason: `Command "${base}" is network-capable and network access is not permitted by scope`,
  }
}
