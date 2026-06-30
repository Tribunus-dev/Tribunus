/**
 * Dharma Live Sandbox — Process Policy
 *
 * Command allow-list and argument validation.
 * Enforces which commands may run, checks for shell metacharacters,
 * and validates working directory constraints.
 */

import { normalize, resolve } from "node:path"
import type { ResourceScope } from "../types"
import { isCommandAllowed } from "../session-grants"

// ── Types ──────────────────────────────────────────────────────────────────

export interface CommandPolicyResult {
  allowed: boolean
  reason: string | null
  parsedCommand: string
  parsedArgs: string[]
}

// ── Shell Detection ────────────────────────────────────────────────────────

/**
 * Commands that inherently require a shell to function correctly.
 */
const SHELL_DEPENDENT_COMMANDS = new Set([
  "cd",
  "export",
  "alias",
  "unalias",
  "source",
  ".",
  "exec",
  "eval",
  "set",
  "unset",
  "trap",
  "type",
  "shopt",
  "pushd",
  "popd",
  "dirs",
  "bg",
  "fg",
  "jobs",
  "disown",
  "command",
  "builtin",
  "enable",
  "declare",
  "local",
  "readonly",
  "typeset",
  "let",
  "test",
  "[",
  "[[",
  "]]",
])

/**
 * Shell metacharacters that indicate command injection risk.
 */
const SHELL_METACHARACTERS = /[;|&`$(){}<>!#*?[\]~]/

/**
 * Check if a command requires shell (rejected).
 * Shell-builtins and control-flow keywords are not directly executable
 * without a shell interpreter.
 */
export function requiresShell(command: string): boolean {
  const base = command.split("/").pop() ?? command
  return SHELL_DEPENDENT_COMMANDS.has(base)
}

// ── Shell Metacharacter Detection ──────────────────────────────────────────

/**
 * Check for unsafe shell metacharacters in arguments.
 * Metacharacters inside quoted strings are still flagged because
 * we cannot definitively know how the spawned process will interpret them.
 */
export function hasUnsafeShellChars(args: string[]): boolean {
  for (const arg of args) {
    if (/^\d+$/.test(arg)) continue
    if (/^[a-zA-Z0-9_./@%+:,-]+$/.test(arg)) continue
    if (SHELL_METACHARACTERS.test(arg)) return true
    if (arg.includes("\n") || arg.includes("\r") || arg.includes("\t")) return true
  }
  return false
}

// ── Working Directory Validation ───────────────────────────────────────────

/**
 * Check that the working directory is within the sandbox root.
 * Null or empty working directory is allowed (will use sandbox root).
 */
export function isWorkingDirAllowed(
  wd: string | null,
  sandboxRoot: string,
): boolean {
  if (wd === null || wd === "") return true
  const resolved = resolve(normalize(wd))
  const resolvedRoot = resolve(normalize(sandboxRoot))
  return resolved.startsWith(resolvedRoot)
}

// ── Command Policy Check ───────────────────────────────────────────────────

/**
 * Check if a command and its arguments are allowed by policy.
 * Validates: command prefix against allowed/denied lists,
 * shell dependency, and unsafe argument characters.
 */
export function checkCommandPolicy(
  command: string,
  args: string[],
  scope: ResourceScope,
): CommandPolicyResult {
  if (requiresShell(command)) {
    return {
      allowed: false,
      reason: `Command "${command}" requires a shell and is not allowed`,
      parsedCommand: command,
      parsedArgs: args,
    }
  }

  if (hasUnsafeShellChars(args)) {
    return {
      allowed: false,
      reason: "Arguments contain unsafe shell metacharacters",
      parsedCommand: command,
      parsedArgs: args,
    }

  }

  // Build full command string for prefix-based scope matching.
  // Join command with first arg so prefix matching works (e.g. "npm test" matches "npm ").
  const fullCommand = args.length === 0
    ? command
    : command + " " + args[0]
  if (!isCommandAllowed(scope, fullCommand)) {
    return {
      allowed: false,
      reason: `Command "${fullCommand}" is not in the allowed command scope`,
      parsedCommand: command,
      parsedArgs: args,
    }
  }

  return {
    allowed: true,
    reason: null,
    parsedCommand: command,
    parsedArgs: args,
  }
}
