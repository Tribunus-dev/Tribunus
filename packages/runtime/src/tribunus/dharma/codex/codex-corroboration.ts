/**
 * Codex — Corroboration Pipeline
 *
 * When a duplicate contribution is detected, instead of discarding it,
 * corroborate the existing entry: increment counters, add evidence refs,
 * update confidence and reproducibility status.
 *
 * This keeps Codex growth at O(novel_claims), not O(accepted_contributions).
 */

import type { CodexEntry, CodexClaim, EvidenceRef, EvidenceQuality, ReproducibilityStatus } from "./codex-types"

// ── Corroboration Result ────────────────────────────────────────────────

export interface CorroborationResult {
  entry: CodexEntry
  updated: boolean
  changes: CorroborationChange[]
}

export type CorroborationChange =
  | { kind: "corroboration_count"; from: number; to: number }
  | { kind: "confidence"; from: number; to: number }
  | { kind: "reproducibility_status"; from: ReproducibilityStatus; to: ReproducibilityStatus }
  | { kind: "evidence_refs_added"; count: number }
  | { kind: "evidence_quality"; from: EvidenceQuality; to: EvidenceQuality }

// ── Corroborate ─────────────────────────────────────────────────────────

/**
 * Corroborate an existing Codex entry with new evidence from a duplicate
 * contribution. Does NOT create a new entry — only updates the existing one.
 *
 * Returns the updated entry and a list of what changed.
 */
export function corroborateEntry(
  entry: CodexEntry,
  newEvidenceRefs: EvidenceRef[],
  newClaims: CodexClaim[],
): CorroborationResult {
  const changes: CorroborationChange[] = []
  let updated = { ...entry }

  // 1. Increment corroboration count
  const oldCount = updated.quality.corroborationCount
  updated.quality = {
    ...updated.quality,
    corroborationCount: oldCount + 1,
  }
  changes.push({ kind: "corroboration_count", from: oldCount, to: oldCount + 1 })

  // 2. Add new evidence refs (deduplicated by receiptDigest)
  const existingDigests = new Set(updated.evidenceRefs.map((r) => r.receiptDigest))
  const novelRefs = newEvidenceRefs.filter((r) => !existingDigests.has(r.receiptDigest))
  if (novelRefs.length > 0) {
    updated = {
      ...updated,
      evidenceRefs: [...updated.evidenceRefs, ...novelRefs],
    }
    changes.push({ kind: "evidence_refs_added", count: novelRefs.length })
  }

  // 3. Update confidence (weighted average, favoring corroboration)
  const newConfidence = recalculateConfidence(updated.quality.confidence, newClaims, updated.quality.corroborationCount)
  if (Math.abs(newConfidence - entry.quality.confidence) > 0.01) {
    changes.push({ kind: "confidence", from: entry.quality.confidence, to: newConfidence })
    updated.quality = { ...updated.quality, confidence: newConfidence }
  }

  // 4. Update reproducibility status (promote if enough corroborations)
  const newStatus = promoteReproducibility(updated.quality.reproducibilityStatus, updated.quality.corroborationCount)
  if (newStatus !== entry.quality.reproducibilityStatus) {
    changes.push({ kind: "reproducibility_status", from: entry.quality.reproducibilityStatus, to: newStatus })
    updated.quality = { ...updated.quality, reproducibilityStatus: newStatus }
  }

  // 5. Promote evidence quality if corroboration crosses threshold
  const newQuality = promoteEvidenceQuality(updated.quality.evidenceQuality, updated.quality.corroborationCount)
  if (newQuality !== entry.quality.evidenceQuality) {
    changes.push({ kind: "evidence_quality", from: entry.quality.evidenceQuality, to: newQuality })
    updated.quality = { ...updated.quality, evidenceQuality: newQuality }
  }

  return { entry: updated, updated: changes.length > 0, changes }
}

// ── Internal Helpers ────────────────────────────────────────────────────

/**
 * Recalculate confidence as a weighted average of existing confidence and
 * new claim confidence. Each corroboration adds weight.
 */
function recalculateConfidence(
  existingConfidence: number,
  newClaims: CodexClaim[],
  corroborationCount: number,
): number {
  const newConfidence = newClaims.reduce((sum, c) => sum + c.confidence, 0) / Math.max(newClaims.length, 1)
  // Weight: existing has (corroborationCount-1) weight, new has 1 weight
  const totalWeight = corroborationCount
  return (existingConfidence * (totalWeight - 1) + newConfidence) / totalWeight
}

/**
 * Promote reproducibility status based on corroboration count thresholds.
 */
function promoteReproducibility(
  current: ReproducibilityStatus,
  corroborationCount: number,
): ReproducibilityStatus {
  if (current === "contradicted") return current  // never promote from contradicted
  if (corroborationCount >= 5) return "independently_reproduced"
  if (corroborationCount >= 2) return "reproduced"
  return current
}

/**
 * Promote evidence quality based on corroboration count.
 */
function promoteEvidenceQuality(
  current: EvidenceQuality,
  corroborationCount: number,
): EvidenceQuality {
  if (current === "high") return current
  if (corroborationCount >= 3) return "high"
  if (corroborationCount >= 1 && current === "low") return "medium"
  return current
}
