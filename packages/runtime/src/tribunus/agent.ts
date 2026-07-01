import type { Ruleset, EvaluationResult } from "./permission"
import * as EffectModule from "effect/Effect"

export interface AgentDescriptor {
  id: string
  permission: Ruleset
}

export declare const use: {
  get: (id: string) => EffectModule.Effect<AgentDescriptor | undefined, never, unknown>
}

export declare function deriveSubagentSessionPermission(
  opts: {
    parentSessionPermission: Ruleset
    parentAgent: AgentDescriptor
    subagent: AgentDescriptor
  },
): Ruleset

export type { Ruleset, EvaluationResult }
