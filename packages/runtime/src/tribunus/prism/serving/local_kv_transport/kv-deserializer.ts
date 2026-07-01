/**
 * Prism Local-Host KV Transport — Deserializer
 *
 * Checksum validation, byte-length validation, and representation
 * compatibility checking at the destination side.
 */

// ── Checksum Validation ─────────────────────────────────────────────────────

/**
 * Validate that an expected checksum matches the actual computed checksum.
 * Comparison is case-insensitive hex.
 */
export function validateChecksum(expected: string, actual: string): boolean {
  if (!expected || !actual) {
    return false
  }
  return expected.toLowerCase() === actual.toLowerCase()
}

// ── Byte Length Validation ──────────────────────────────────────────────────

/**
 * Validate that the expected byte length matches the actual measured length.
 */
export function validateByteLength(expected: number, actual: number): boolean {
  if (expected <= 0 || actual <= 0) {
    return false
  }
  return expected === actual
}

// ── Representation Support ──────────────────────────────────────────────────

/**
 * Check whether a given transfer representation is in the set of supported
 * representations for deserialization.
 */
export function canDeserialize(rep: string, supportedReps: string[]): boolean {
  if (!rep || rep.length === 0) {
    return false
  }
  if (!supportedReps || supportedReps.length === 0) {
    return false
  }
  return supportedReps.includes(rep)
}
