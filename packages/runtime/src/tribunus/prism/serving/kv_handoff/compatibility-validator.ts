/**
 * Prism KV Handoff Protocol — Compatibility Validator
 *
 * Strict and family-mode validation between source and destination
 * compatibility descriptors. Returns mismatched fields and a human-readable
 * reason when compatibility cannot be established.
 */

import type { PrismKvCompatibilityDescriptor, CompatibilityMode } from "./handoff-types"

/**
 * Non-nullable field keys whose equality is checked for compatibility.
 */
const COMPARISON_FIELDS = [
  "modelArtifactDigest",
  "tokenizerDigest",
  "architectureDigest",
  "attentionLayoutDigest",
  "ropeConfigurationDigest",
  "kvQuantizationDigest",
  "kvPrecisionMode",
  "kvPageShape",
  "kvHeadLayout",
  "kvLayerCount",
  "kvHiddenDimension",
  "kvSequenceLength",
  "transferRepresentation",
  "sourceComputeImageClass",
  "destinationComputeImageClass",
] as const

/**
 * Strict-mode fields (all non-nullable fields, including digests).
 */
const STRICT_FIELDS = [...COMPARISON_FIELDS] as const

/**
 * Validate source against destination for a given compatibility mode.
 *
 * - strict: all non-nullable fields must match exactly.
 * - family: only structural fields must match; image classes and
 *           transfer representation are allowed to differ.
 * - evaluation: only model and tokenizer digests must match.
 */
export function validateCompatibility(
  source: PrismKvCompatibilityDescriptor,
  dest: PrismKvCompatibilityDescriptor,
  mode: CompatibilityMode,
): { compatible: boolean; mismatchedFields: string[]; reason: string | null } {
  const mismatchedFields: string[] = []

  const fieldsToCheck: readonly (keyof PrismKvCompatibilityDescriptor)[] =
    mode === "strict"
      ? STRICT_FIELDS
      : mode === "family"
        ? STRICT_FIELDS.filter(
            (f) => f !== "sourceComputeImageClass" && f !== "destinationComputeImageClass" && f !== "transferRepresentation",
          )
        : // evaluation mode — only model + tokenizer digests
          ["modelArtifactDigest", "tokenizerDigest"]

  for (const field of fieldsToCheck) {
    const s = String(source[field] ?? "")
    const d = String(dest[field] ?? "")
    if (s !== d) {
      mismatchedFields.push(field)
    }
  }

  if (mismatchedFields.length > 0) {
    return {
      compatible: false,
      mismatchedFields,
      reason: `Mismatched fields in ${mode} mode: ${mismatchedFields.join(", ")}`,
    }
  }

  return { compatible: true, mismatchedFields: [], reason: null }
}

/**
 * Shorthand for strict-mode compatibility check.
 */
export function isStrictlyCompatible(
  source: PrismKvCompatibilityDescriptor,
  dest: PrismKvCompatibilityDescriptor,
): boolean {
  for (const field of STRICT_FIELDS) {
    if (String(source[field] ?? "") !== String(dest[field] ?? "")) {
      return false
    }
  }
  return true
}

/**
 * Return only the mismatched field names between two descriptors.
 */
export function getMismatchedFields(
  source: PrismKvCompatibilityDescriptor,
  dest: PrismKvCompatibilityDescriptor,
): string[] {
  const mismatched: string[] = []
  for (const field of COMPARISON_FIELDS) {
    if (String(source[field] ?? "") !== String(dest[field] ?? "")) {
      mismatched.push(field)
    }
  }
  return mismatched
}
