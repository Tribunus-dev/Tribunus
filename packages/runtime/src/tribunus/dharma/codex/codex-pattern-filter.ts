/**
 * Codex — Pattern Filter
 *
 * Ensures Codex claims contain generalized patterns, not literal code.
 * Strips code blocks, file paths, and implementation-specific references
 * from claims during ingestion, replacing them with pattern descriptions.
 *
 * The Codex stores reusable knowledge. Literal code belongs in the
 * contribution evidence layer (receipts, patches, diffs), not in claims.
 */

import type { CodexClaim, EvidenceQuality } from "./codex-types"

// ── Code Pattern Detection ─────────────────────────────────────────────

/**
 * Patterns that indicate a statement contains literal code.
 */
const CODE_INDICATORS = [
  /\b(?:function|class|struct|enum|interface|type|import|export|const|let|var|def|impl|trait|fn|pub)\s+\w+\s*[\({<:]/,
  /```\w*\n/,           // fenced code blocks
  /`[^`\n]{3,}`/,        // inline code (3+ chars)
  /\b(?:\.ts|\.rs|\.py|\.js|\.swift|\.c|\.cpp|\.h|\.metal|\.java|\.go)\b/,  // file extensions
  /\b(?:file:|line:|L\d{2,})\b/,  // file:line references
  /\b(?:commit|sha256:|blob|tree)\/[a-f0-9]{7,}\b/,  // git references
  /\b(?:std::|use\s+\w+::|fn\s+\w+\()/,  // Rust-style paths
  /\b(?:import\s+\w+|from\s+['\"]\w+)/,  // import statements
  /^\s*[\/#*]{1,3}\s*(?:TODO|FIXME|HACK|XXX)/m,  // code comments
]

/**
 * Check if a statement contains literal code indicators.
 */
export function containsCode(statement: string): boolean {
  return CODE_INDICATORS.some((re) => re.test(statement))
}

/**
 * Check if a claim is a pattern (does not contain literal code).
 */
export function isPattern(claim: CodexClaim): boolean {
  return !containsCode(claim.statement)
}

// ── Pattern Extraction ─────────────────────────────────────────────────

/**
 * Extract a pattern description from a statement that may contain code.
 * Replaces code references with generalized pattern language.
 */
export function extractPattern(statement: string): string {
  let result = statement

  // Remove fenced code blocks entirely
  result = result.replace(/```[\s\S]*?```/g, "[code example]")

  // Replace inline code backticks with pattern language
  result = result.replace(/`([^`]+)`/g, (match, code) => {
    const pattern = generalizeCodeReference(code)
    return pattern
  })

  // Remove file:line references
  result = result.replace(/\b\w+\.\w+(?::\d+)?(?::\d+)?/g, (match) => {
    if (/\.(ts|rs|py|js|swift|c|cpp|h|metal|java|go)$/i.test(match)) {
      return "[source file]"
    }
    return match
  })

  // Remove git commit references
  result = result.replace(/\b[a-f0-9]{7,40}\b/g, (match) => {
    if (/^[0-9a-f]{7,}$/i.test(match) && match.length >= 7 && match.length <= 40) {
      return "[commit]"
    }
    return match
  })

  // Clean up double spaces and trim
  result = result.replace(/\s{2,}/g, " ").trim()

  return result
}

/**
 * Generalize a code reference into a pattern description.
 */
function generalizeCodeReference(code: string): string {
  const lower = code.toLowerCase()

  // Method calls — identifier + parens (buffer.bind(), dispatcher.dispatch())
  if (/^[\w.]+(?:\([^)]*\))?$/.test(code) && /\(/.test(code)) {
    return "[method call]"
  }

  // Function/method identifiers
  if (/^(get|set|is|has|to|from|with|handle|process|validate|compute|render|dispatch|bind|allocate|free|release)[\w.]*$/i.test(code)) {
    return "[operation]"
  }

  // Variable names (camelCase or snake_case)
  if (/^[a-z][a-zA-Z0-9]{2,}$/.test(code) || /^[a-z][a-z0-9_]{2,}$/.test(code)) {
    return "[value]"
  }

  // Type names (PascalCase)
  if (/^[A-Z][a-zA-Z0-9]{2,}$/.test(code)) {
    return "[type]"
  }

  // File paths
  if (code.includes("/") || code.includes("\\")) {
    return "[path]"
  }

  // Numbers / versions
  if (/^\d+(?:\.\d+)+$/.test(code)) {
    return "[version]"
  }

  return code
}

// ── Claim Transformation ───────────────────────────────────────────────

/**
 * Transform a list of claims to ensure they are patterns, not code.
 * Claims containing literal code are filtered and their statements
 * are replaced with extracted patterns.
 */
export function ensurePatternClaims(claims: CodexClaim[]): CodexClaim[] {
  return claims.map((claim) => {
    if (isPattern(claim)) return claim

    const pattern = extractPattern(claim.statement)
    return {
      ...claim,
      statement: pattern,
      // Reduce confidence for machine-extracted patterns
      confidence: Math.min(claim.confidence, 0.6),
    }
  })
}

// ── Ingestion Hook ────────────────────────────────────────────────────

/**
 * Validate that all claims in a set are patterns.
 * Returns the claims with code filtered out, and a list of warnings
 * for claims that were transformed.
 */
export function validatePatternClaims(
  claims: CodexClaim[],
): { cleaned: CodexClaim[]; warnings: string[] } {
  const warnings: string[] = []
  const cleaned = claims.map((claim) => {
    if (isPattern(claim)) return claim

    const pattern = extractPattern(claim.statement)
    if (pattern !== claim.statement) {
      warnings.push(
        `Claim "${claim.statement.slice(0, 60)}..." contained code; extracted pattern: "${pattern.slice(0, 60)}..."`,
      )
    }
    return {
      ...claim,
      statement: pattern,
      confidence: Math.min(claim.confidence, 0.6),
    }
  })

  return { cleaned, warnings }
}
