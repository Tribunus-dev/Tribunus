/**
 * Stub type declarations for the permission module.
 * These are minimal placeholders enabling typecheck of test files.
 * Full implementation to be provided when the permission system is built.
 */

export type RuleAction = "allow" | "deny"

export interface Rule {
  action: RuleAction
  pattern: string
}

export type Ruleset = Rule[]

export interface EvaluationResult {
  action: RuleAction
  matchedRule: Rule | null
}

export declare function merge(...sets: Ruleset[]): Ruleset
export declare function evaluate(
  action: string,
  path: string,
  rules: Ruleset,
): EvaluationResult
