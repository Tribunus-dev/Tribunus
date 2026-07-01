/**
 * Codex — Semantic Pattern Extractor
 *
 * Transforms contributions into generalized engineering patterns.
 * Instead of replacing code with bracketed labels like "[method call]",
 * it analyzes the *semantic role* of each code reference and produces
 * a natural-language pattern description.
 *
 * A contribution like "crash in matrix_multiply.metal because
 * computeEncoder.setBuffer wasn't called before dispatch" becomes:
 * "GPU crash occurs when a Metal buffer resource is dispatched to a
 * shader core without first being bound to the command encoder.
 * The pattern applies to any Metal compute dispatch where buffer
 * lifetime does not extend to the encoder's execution scope."
 *
 * The key insight: the pattern is the *role* the code plays in the
 * engineering situation, not the literal identifier.
 */

import type { CodexClaim } from "./codex-types"

// ── Pattern Taxonomy ───────────────────────────────────────────────────

/**
 * Known classes of engineering patterns the extractor can recognize.
 */
export type PatternClass =
  | "resource_lifecycle"     // allocate → prepare → bind → use → release
  | "validation"             // check precondition before operation
  | "error_handling"         // catch, handle, recover from failure
  | "concurrency"            // ordering, locking, synchronization
  | "configuration"          // parameter selection, tuning, thresholds
  | "migration"              // API change, deprecation, version compatibility
  | "composition"            // how components connect, data flow, pipeline
  | "boundary_condition"     // edge case, overflow, truncation, alignment
  | "instrumentation"        // logging, tracing, metrics, debugging
  | "general"                // uncategorized

// ── Extraction Result ──────────────────────────────────────────────────

export interface PatternExtraction {
  /** The natural-language pattern description. */
  pattern: string
  /** What class of pattern this is. */
  patternClass: PatternClass
  /** The engineering roles identified in the source material. */
  roles: PatternRole[]
  /** Confidence that this pattern is correct (0.0–1.0). */
  confidence: number
}

export interface PatternRole {
  /** The role this identifier plays (e.g. "resource", "operation", "guard"). */
  role: string
  /** What the role does in the pattern. */
  action: string
  /** The consequence of getting this role wrong. */
  consequence: string | null
}

// ── Role Lexicon ───────────────────────────────────────────────────────

/**
 * Known role patterns mapped from code identifiers to engineering roles.
 */
const ROLE_MAP: Record<string, { role: string; action: string; consequence: string }> = {
  // Buffer / memory management
  bind: { role: "resource binding", action: "attaches a resource to a context before use", consequence: "unbound resource access causes undefined behavior or device crash" },
  unbind: { role: "resource release", action: "detaches a resource from a context after use", consequence: "resource leak or use-after-free" },
  allocate: { role: "resource allocation", action: "reserves memory or device resource", consequence: "allocation failure causes OOM or device error" },
  release: { role: "resource deallocation", action: "frees memory or device resource", consequence: "memory leak or resource exhaustion" },
  free: { role: "resource deallocation", action: "frees memory or device resource", consequence: "memory leak or resource exhaustion" },
  makeBuffer: { role: "buffer creation", action: "creates a device-accessible memory buffer", consequence: "missing buffer causes null-pointer dispatch" },
  setBuffer: { role: "buffer binding", action: "binds a buffer to a pipeline stage", consequence: "unbound buffer causes silent data corruption" },
  setBytes: { role: "inline data binding", action: "passes small data directly to a shader", consequence: "missing data causes undefined shader behavior" },
  setTexture: { role: "texture binding", action: "binds a texture to a pipeline stage", consequence: "unbound texture causes undefined sampling" },
  setSamplerState: { role: "sampler binding", action: "binds a sampler configuration", consequence: "missing sampler causes undefined filtering" },

  // Dispatch / execution
  dispatch: { role: "compute dispatch", action: "launches a compute workload on the GPU", consequence: "dispatch with incorrect dimensions causes out-of-bounds access" },
  dispatchThreadgroups: { role: "threadgroup dispatch", action: "launches a grid of threadgroups on the GPU", consequence: "incorrect threadgroup dimensions cause GPU memory fault" },
  draw: { role: "render dispatch", action: "launches a render workload on the GPU", consequence: "draw with unbound resources causes GPU crash" },
  encode: { role: "command encoding", action: "records GPU commands into a command buffer", consequence: "encoding order errors cause incorrect GPU execution" },
  commit: { role: "command submission", action: "submits encoded commands to the GPU", consequence: "uncommitted commands never execute" },
  waitUntilCompleted: { role: "synchronization", action: "blocks CPU until GPU work completes", consequence: "missing synchronization causes data races" },

  // Validation / safety
  validate: { role: "precondition check", action: "verifies conditions before proceeding", consequence: "skipped validation causes silent corruption" },
  assert: { role: "invariant check", action: "verifies internal consistency", consequence: "violated invariant causes undefined behavior" },
  check: { role: "condition check", action: "tests a condition and handles failure", consequence: "unchecked condition propagates error silently" },

  // Error handling
  catch: { role: "error capture", action: "intercepts a thrown error", consequence: "uncaught error terminates the process" },
  throw: { role: "error signaling", action: "raises an error condition", consequence: "unhandled error propagates to caller" },
  "try": { role: "error monitoring", action: "marks a block for error interception", consequence: "unmonitored block allows exceptions to propagate unhandled" },
  recover: { role: "error recovery", action: "restores consistent state after error", consequence: "failed recovery leaves system in inconsistent state" },

  // Concurrency
  lock: { role: "mutual exclusion", action: "acquires exclusive access to a resource", consequence: "missing lock causes data races" },
  unlock: { role: "lock release", action: "releases exclusive access to a resource", consequence: "held lock causes deadlock" },
  sync: { role: "synchronization", action: "coordinates access between execution domains", consequence: "missing sync causes inconsistent state" },
  wait: { role: "barrier", action: "blocks until a condition is met", consequence: "missing barrier causes use-before-ready" },
  signal: { role: "condition signaling", action: "notifies waiting consumers", consequence: "missing signal causes indefinite wait" },
}

// ── Statement Analysis ─────────────────────────────────────────────────

export interface AnalyzedStatement {
  original: string
  hasCode: boolean
  identifiedRoles: PatternRole[]
  patternClass: PatternClass
  contextClues: string[]
}

/**
 * Analyze a statement and extract pattern roles and classification.
 */
export function analyzeStatement(statement: string): AnalyzedStatement {
  const lower = statement.toLowerCase()
  const roles: PatternRole[] = []
  const contextClues: string[] = []

  // Extract backtick-wrapped code references and map them to roles
  const codeRefs = statement.match(/`([^`]+)`/g) || []
  for (const ref of codeRefs) {
    const code = ref.slice(1, -1) // remove backticks
    const mapped = mapCodeToRole(code)
    if (mapped) {
      roles.push(mapped)
    }
  }

  // Extract bare identifiers that look like code (camelCase, snake_case, dotted paths)
  const bareRefs = statement.match(/\b[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*\([^)]*\)/g) || []
  for (const ref of bareRefs) {
    const baseName = ref.split(/[.()]/)[0]
    if (!roles.some((r) => r.role.toLowerCase().includes(baseName.toLowerCase()))) {
      const mapped = mapCodeToRole(baseName)
      if (mapped) {
        roles.push(mapped)
      }
    }
  }

  // Classify the pattern based on role types
  const patternClass = classifyByRoles(roles, lower)

  // Extract context clues
  if (/crash|timeout|panic|segfault|abort|fatal/i.test(lower)) contextClues.push("crash/failure")
  if (/leak|exhaust|oom|overflow|corruption/i.test(lower)) contextClues.push("resource exhaustion")
  if (/race|deadlock|contention|ordering|concurrent/i.test(lower)) contextClues.push("concurrency")
  if (/migration|deprecated|removed|upgrade|breaking|compat/i.test(lower)) contextClues.push("migration")
  if (/optimize|slow|latency|throughput|performance/i.test(lower)) contextClues.push("performance")

  return {
    original: statement,
    hasCode: codeRefs.length > 0 || bareRefs.length > 0,
    identifiedRoles: roles,
    patternClass,
    contextClues,
  }
}

/**
 * Map a code identifier to a known engineering role.
 */
export function mapCodeToRole(code: string): PatternRole | null {
  // Strip namespace/object prefixes
  // Handle multi-word references like "try catch" or "encoder.setBuffer"
  // Try the full code ref first
  if (ROLE_MAP[code]) return ROLE_MAP[code]

  // Try individual words (for "try catch" -> "try")
  const wordMatch = code.match(/\w+/g)
  if (wordMatch) { for (const w of wordMatch) { if (ROLE_MAP[w]) return ROLE_MAP[w] } }

  // Then try the last segment (for dotted paths like encoder.setBuffer)
  const baseName = code.split(".").pop() || code
  // Strip parentheses and arguments
  const cleanName = baseName.split("(")[0]

  const entry = ROLE_MAP[cleanName]
  if (entry) return entry

  // Heuristic: methods starting with common prefixes
  if (/^(get|set|is|has|to|from)/i.test(cleanName)) {
    return {
      role: "property access",
      action: `reads or modifies a property`,
      consequence: "incorrect access causes state inconsistency",
    }
  }
  if (/^(validate|check|ensure|verify|assert)/i.test(cleanName)) {
    return {
      role: "validation step",
      action: "verifies a precondition before proceeding",
      consequence: "skipped validation allows silent corruption",
    }
  }
  if (/^(handle|process|on|did|will)/i.test(cleanName)) {
    return {
      role: "event handler",
      action: "responds to an event or callback",
      consequence: "missing handler causes unhandled event",
    }
  }
  if (/^(alloc|create|new|build|init|make)/i.test(cleanName)) {
    return {
      role: "resource creation",
      action: "constructs a new resource or object",
      consequence: "creation failure leaves system without required resource",
    }
  }
  if (/^(dealloc|destroy|cleanup|teardown|close|shutdown)/i.test(cleanName)) {
    return {
      role: "resource teardown",
      action: "releases resources and cleans up state",
      consequence: "incomplete teardown causes resource leak",
    }
  }

  return null
}

/**
 * Classify the pattern based on what roles were identified.
 */
function classifyByRoles(roles: PatternRole[], lower: string): PatternClass {
  const roleWords = roles.map((r) => r.role.toLowerCase()).join(" ")

  if (/bind|unbind|alloc|dealloc|buffer|texture|memory|resource|leak|exhaust/i.test(roleWords)) {
    return "resource_lifecycle"
  }
  if (/validation|check|assert|precondition/i.test(roleWords)) {
    return "validation"
  }
  if (/error|catch|throw|recover|failure/i.test(roleWords) || /catch|throw|error|exception/i.test(lower)) {
    return "error_handling"
  }
  if (/lock|unlock|sync|race|deadlock|concurrent/i.test(roleWords) || /thread|race|deadlock|concurrent/i.test(lower)) {
    return "concurrency"
  }
  if (/dispatch|draw|encode|pipeline|shader|kernel|threadgroup/i.test(roleWords)) {
    return "composition"
  }
  if (/boundary|overflow|truncation|alignment|precision|clamp|wrap/i.test(roleWords) || /overflow|underflow|truncation|alignment/i.test(lower)) {
    return "boundary_condition"
  }
  if (/migration|deprecated|removed|upgrade|version/i.test(roleWords) || /deprecated|migration|upgrade/i.test(lower)) {
    return "migration"
  }
  if (/log|trace|metric|instrument|telemetry/i.test(lower)) {
    return "instrumentation"
  }

  return "general"
}

// ── Pattern Generation ─────────────────────────────────────────────────

/**
 * Generate a natural-language pattern description from the analyzed statement.
 */
export function generatePattern(analysis: AnalyzedStatement): string {
  const { original, identifiedRoles: roles, patternClass, contextClues } = analysis

  let cleaned = original
    .replace(/`([^`]+)`/g, (_, code) => {
      const mapped = mapCodeToRole(code)
      if (mapped) return `[${mapped.role}]`
      // Try to extract the semantic category
      const cat = categorizeIdentifier(code)
      return `[${cat}]`
    })

  // If no roles were identified and no code was found, it's already a pattern
  if (roles.length === 0) {
    return cleaned
  }

  // Build pattern description from roles
  const roleDescriptions = roles.map((r) => `- ${r.role}: ${r.action}`).join("\n")
  const consequences = roles.filter((r) => r.consequence).map((r) => `  Consequence: ${r.consequence}`).join("\n")

  const patternClassLabel = patternClass.replace(/_/g, " ")
  const clueContext = contextClues.length > 0 ? `\nContext: ${contextClues.join(", ")}` : ""

  return `${cleaned}

Pattern classification: ${patternClassLabel}
Engineering roles identified:
${roleDescriptions}${consequences ? "\n" + consequences : ""}${clueContext}`
}

/**
 * Categorize an identifier when no specific role mapping exists.
 */
function categorizeIdentifier(code: string): string {
  const base = code.split(".").pop() || code
  const clean = base.split("(")[0]

  if (/^[A-Z]/.test(clean)) return "type or struct"
  if (/^[a-z][a-zA-Z0-9]*$/.test(clean)) return "value or variable"
  if (/\./.test(code)) return "nested property"
  if (/\(/.test(code)) return "function or method call"
  return "identifier"
}

// ── Public API ─────────────────────────────────────────────────────────

export function extractPattern(statement: string): string {
  const analysis = analyzeStatement(statement)
  return generatePattern(analysis)
}

export function containsCode(statement: string): boolean {
  return analyzeStatement(statement).hasCode
}

export function isPattern(claim: CodexClaim): boolean {
  return !containsCode(claim.statement)
}

export function ensurePatternClaims(claims: CodexClaim[]): CodexClaim[] {
  return claims.map((claim) => {
    if (isPattern(claim)) return claim
    const pattern = extractPattern(claim.statement)
    return {
      ...claim,
      statement: pattern,
      confidence: Math.min(claim.confidence, 0.65),
    }
  })
}

export function validatePatternClaims(
  claims: CodexClaim[],
): { cleaned: CodexClaim[]; warnings: string[] } {
  const warnings: string[] = []
  const cleaned = claims.map((claim) => {
    if (isPattern(claim)) return claim
    const analysis = analyzeStatement(claim.statement)
    const pattern = generatePattern(analysis)
    warnings.push(
      `Claim contained code references; identified ${analysis.identifiedRoles.length} engineering roles (${analysis.patternClass})`,
    )
    return {
      ...claim,
      statement: pattern,
      confidence: Math.min(claim.confidence, 0.65),
    }
  })
  return { cleaned, warnings }
}
