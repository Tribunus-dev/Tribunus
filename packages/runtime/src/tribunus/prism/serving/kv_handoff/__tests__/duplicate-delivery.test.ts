/**
 * Tests — Duplicate delivery detection and rejection
 */

import { describe, it, expect } from "bun:test"

interface DeliveryRecord {
  handoffId: string
  deliveryId: string
  deliveredAt: string
}

// ── Inline duplicate detection (no production module yet) ───────────────────

function isDuplicateDelivery(
  deliveryId: string,
  history: DeliveryRecord[],
): boolean {
  return history.some((r) => r.deliveryId === deliveryId)
}

function rejectDuplicateDelivery(
  deliveryId: string,
  history: DeliveryRecord[],
): { accepted: boolean; reason: string | null } {
  if (isDuplicateDelivery(deliveryId, history)) {
    return { accepted: false, reason: "duplicate_delivery_detected" }
  }
  return { accepted: true, reason: null }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const history: DeliveryRecord[] = [
  { handoffId: "handoff-001", deliveryId: "delivery-001", deliveredAt: "2025-06-01T00:00:00Z" },
  { handoffId: "handoff-001", deliveryId: "delivery-002", deliveredAt: "2025-06-01T00:00:05Z" },
  { handoffId: "handoff-002", deliveryId: "delivery-003", deliveredAt: "2025-06-01T00:01:00Z" },
]

// ── Tests ───────────────────────────────────────────────────────────────────

describe("isDuplicateDelivery", () => {
  it("detects a known delivery id", () => {
    expect(isDuplicateDelivery("delivery-001", history)).toBeTrue()
    expect(isDuplicateDelivery("delivery-002", history)).toBeTrue()
    expect(isDuplicateDelivery("delivery-003", history)).toBeTrue()
  })

  it("returns false for an unknown delivery id", () => {
    expect(isDuplicateDelivery("delivery-999", history)).toBeFalse()
  })

  it("returns false for empty history", () => {
    expect(isDuplicateDelivery("delivery-001", [])).toBeFalse()
  })
})

describe("rejectDuplicateDelivery", () => {
  it("rejects a known delivery id", () => {
    const result = rejectDuplicateDelivery("delivery-001", history)
    expect(result.accepted).toBeFalse()
    expect(result.reason).toBe("duplicate_delivery_detected")
  })

  it("accepts an unknown delivery id", () => {
    const result = rejectDuplicateDelivery("delivery-new", history)
    expect(result.accepted).toBeTrue()
    expect(result.reason).toBeNull()
  })

  it("handles empty history without error", () => {
    const result = rejectDuplicateDelivery("delivery-new", [])
    expect(result.accepted).toBeTrue()
    expect(result.reason).toBeNull()
  })
})
