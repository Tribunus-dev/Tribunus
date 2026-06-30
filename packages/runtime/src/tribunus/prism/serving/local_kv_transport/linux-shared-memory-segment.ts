/**
 * Prism Local-Host KV Transport — Linux Shared Memory Segment
 *
 * Segment sizing and alignment validation for Linux shared-memory
 * transport segments.
 */

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_SEGMENT_BYTES = 256 * 1024 * 1024 // 256 MiB
const DEFAULT_SEGMENT_ALIGNMENT = 4096 // 4 KiB (page-aligned)

// ── Getters ─────────────────────────────────────────────────────────────────

/**
 * Get the default maximum segment size in bytes.
 */
export function getMaxSegmentBytes(): number {
  return DEFAULT_MAX_SEGMENT_BYTES
}

/**
 * Get the default segment alignment (4 KiB page boundary).
 */
export function getDefaultAlignment(): number {
  return DEFAULT_SEGMENT_ALIGNMENT
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Check whether a segment byte length is valid given a maximum.
 * Valid segments are positive, <= maxBytes, and page-aligned.
 */
export function isSegmentSizeValid(bytes: number, maxBytes: number): boolean {
  if (bytes <= 0) {
    return false
  }
  if (bytes > maxBytes) {
    return false
  }
  if (bytes % DEFAULT_SEGMENT_ALIGNMENT !== 0) {
    return false
  }
  return true
}
