/**
 * Prism Local-Host KV Transport — Segment Lifecycle FSM & Sealing Tests
 */

import { describe, it, expect } from "bun:test"
import type { SegmentState, PrismKvSharedMemorySegment } from "../local-transport-types"
import {
  VALID_SEGMENT_TRANSITIONS,
  applySegmentAction,
  isSegmentTerminal,
  canReleaseSegment,
} from "../local-segment-lifecycle"
import {
  createSegment,
  isSegmentExpired,
  isSegmentActive,
  canWriteToSegment,
  canMapSegment,
} from "../local-segment"
import {
  sealSegment,
  isSegmentSealable,
  markMapped,
  markVerified,
  markAcknowledged,
  releaseSegment,
} from "../segment-sealing"

// ── Helpers ─────────────────────────────────────────────────────────────────

/** All 11 states defined in the type system. */
const ALL_STATES: SegmentState[] = [
  "allocated",
  "writing",
  "sealed",
  "offered",
  "mapped_by_destination",
  "import_verified",
  "acknowledged",
  "released",
  "failed",
  "cancelled",
  "expired",
]

/** States with at least one outgoing transition. */
const NON_TERMINAL_STATES: SegmentState[] = [
  "allocated",
  "writing",
  "sealed",
  "offered",
  "mapped_by_destination",
  "import_verified",
  "acknowledged",
]

/** States with no outgoing transitions. */
const TERMINAL_STATES: SegmentState[] = ["released", "failed", "cancelled", "expired"]

function makeSegment(overrides: Partial<PrismKvSharedMemorySegment> = {}): PrismKvSharedMemorySegment {
  return {
    segmentId: "seg-1",
    handoffId: "handoff-1",
    ownerWorkerInstanceId: "owner-1",
    destinationWorkerInstanceId: "dest-1",
    hostInstanceId: "host-1",
    byteLength: 4096,
    mappedByteLength: 0,
    alignment: 64,
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    state: "allocated",
    payloadChecksum: "",
    descriptorDigest: "",
    ...overrides,
  }
}

// ── FSM: VALID_SEGMENT_TRANSITIONS ──────────────────────────────────────────

describe("VALID_SEGMENT_TRANSITIONS", () => {
  it("defines an entry for every SegmentState", () => {
    for (const state of ALL_STATES) {
      expect(Array.isArray(VALID_SEGMENT_TRANSITIONS[state])).toBe(true)
    }
  })

  it("allocated → writing | failed", () => {
    expect(VALID_SEGMENT_TRANSITIONS.allocated).toEqual(["writing", "failed"])
  })

  it("writing → sealed | failed | cancelled", () => {
    expect(VALID_SEGMENT_TRANSITIONS.writing).toEqual(["sealed", "failed", "cancelled"])
  })

  it("sealed → offered | expired | cancelled | failed", () => {
    expect(VALID_SEGMENT_TRANSITIONS.sealed).toEqual(["offered", "expired", "cancelled", "failed"])
  })

  it("offered → mapped_by_destination | expired | cancelled | failed", () => {
    expect(VALID_SEGMENT_TRANSITIONS.offered).toEqual([
      "mapped_by_destination",
      "expired",
      "cancelled",
      "failed",
    ])
  })

  it("mapped_by_destination → import_verified | failed | cancelled", () => {
    expect(VALID_SEGMENT_TRANSITIONS.mapped_by_destination).toEqual([
      "import_verified",
      "failed",
      "cancelled",
    ])
  })

  it("import_verified → acknowledged | failed | cancelled", () => {
    expect(VALID_SEGMENT_TRANSITIONS.import_verified).toEqual([
      "acknowledged",
      "failed",
      "cancelled",
    ])
  })

  it("acknowledged → released", () => {
    expect(VALID_SEGMENT_TRANSITIONS.acknowledged).toEqual(["released"])
  })

  it("terminal states have empty transitions", () => {
    for (const state of TERMINAL_STATES) {
      expect(VALID_SEGMENT_TRANSITIONS[state]).toEqual([])
    }
  })
})

// ── FSM: applySegmentAction ─────────────────────────────────────────────────

describe("applySegmentAction", () => {
  it("returns target state for valid transitions", () => {
    expect(applySegmentAction("allocated", "writing")).toBe("writing")
    expect(applySegmentAction("writing", "sealed")).toBe("sealed")
    expect(applySegmentAction("sealed", "offered")).toBe("offered")
    expect(applySegmentAction("offered", "mapped_by_destination")).toBe("mapped_by_destination")
    expect(applySegmentAction("mapped_by_destination", "import_verified")).toBe("import_verified")
    expect(applySegmentAction("import_verified", "acknowledged")).toBe("acknowledged")
    expect(applySegmentAction("acknowledged", "released")).toBe("released")
  })

  it("returns current state for invalid transitions", () => {
    // Cannot go from allocated directly to sealed
    expect(applySegmentAction("allocated", "sealed")).toBe("allocated")
    // Cannot go from writing to acknowledged
    expect(applySegmentAction("writing", "acknowledged")).toBe("writing")
    // Cannot transition from terminal states
    expect(applySegmentAction("released", "allocated")).toBe("released")
    expect(applySegmentAction("failed", "writing")).toBe("failed")
    expect(applySegmentAction("cancelled", "acknowledged")).toBe("cancelled")
  })

  it("accepts fail, cancel, and expire actions from eligible states", () => {
    expect(applySegmentAction("allocated", "failed")).toBe("failed")
    expect(applySegmentAction("writing", "failed")).toBe("failed")
    expect(applySegmentAction("writing", "cancelled")).toBe("cancelled")
    expect(applySegmentAction("sealed", "expired")).toBe("expired")
    expect(applySegmentAction("sealed", "cancelled")).toBe("cancelled")
    expect(applySegmentAction("offered", "expired")).toBe("expired")
  })

  it("rejects fail/cancel/expire from ineligible states", () => {
    // released cannot fail
    expect(applySegmentAction("released", "failed")).toBe("released")
    // allocated cannot cancel (not in its transition set)
    expect(applySegmentAction("allocated", "cancelled")).toBe("allocated")
    // allocated cannot expire (not in its transition set)
    expect(applySegmentAction("allocated", "expired")).toBe("allocated")
  })

  it("returns current for unrecognized action strings", () => {
    expect(applySegmentAction("allocated", "bogus")).toBe("allocated")
    expect(applySegmentAction("writing", "")).toBe("writing")
  })
})

// ── FSM: isSegmentTerminal ──────────────────────────────────────────────────

describe("isSegmentTerminal", () => {
  it("returns true for terminal states", () => {
    for (const state of TERMINAL_STATES) {
      expect(isSegmentTerminal(state)).toBe(true)
    }
  })

  it("returns false for non-terminal states", () => {
    for (const state of NON_TERMINAL_STATES) {
      expect(isSegmentTerminal(state)).toBe(false)
    }
  })
})

// ── FSM: canReleaseSegment ──────────────────────────────────────────────────

describe("canReleaseSegment", () => {
  it("returns true only for acknowledged", () => {
    for (const state of NON_TERMINAL_STATES) {
      if (state === "acknowledged") {
        expect(canReleaseSegment(state)).toBe(true)
      } else {
        expect(canReleaseSegment(state)).toBe(false)
      }
    }
  })

  it("returns false for terminal states", () => {
    for (const state of TERMINAL_STATES) {
      expect(canReleaseSegment(state)).toBe(false)
    }
  })
})

// ── Segment Factory ─────────────────────────────────────────────────────────

describe("createSegment", () => {
  const seg = createSegment("h-1", "owner-1", "dest-1", "host-1", 8192, 256)

  it("creates a segment in allocated state", () => {
    expect(seg.state).toBe("allocated")
    expect(seg.handoffId).toBe("h-1")
    expect(seg.ownerWorkerInstanceId).toBe("owner-1")
    expect(seg.destinationWorkerInstanceId).toBe("dest-1")
    expect(seg.hostInstanceId).toBe("host-1")
    expect(seg.byteLength).toBe(8192)
    expect(seg.alignment).toBe(256)
  })

  it("generates a non-empty segmentId", () => {
    expect(seg.segmentId.length).toBeGreaterThan(0)
  })

  it("sets mappedByteLength and checksums to zero/default", () => {
    expect(seg.mappedByteLength).toBe(0)
    expect(seg.payloadChecksum).toBe("")
    expect(seg.descriptorDigest).toBe("")
  })

  it("sets createdAt and expiresAt as valid ISO strings", () => {
    expect(() => new Date(seg.createdAt)).not.toThrow()
    expect(() => new Date(seg.expiresAt)).not.toThrow()
  })
})

// ── Segment Expiry ──────────────────────────────────────────────────────────

describe("isSegmentExpired", () => {
  it("returns false for a segment with future expiresAt", () => {
    const seg = makeSegment({ expiresAt: new Date(Date.now() + 60_000).toISOString() })
    expect(isSegmentExpired(seg)).toBe(false)
  })

  it("returns true for a segment with past expiresAt", () => {
    const seg = makeSegment({ expiresAt: new Date(Date.now() - 10_000).toISOString() })
    expect(isSegmentExpired(seg)).toBe(true)
  })
})

// ── Segment Active ──────────────────────────────────────────────────────────

describe("isSegmentActive", () => {
  it("returns true for non-terminal, non-expired states", () => {
    for (const state of NON_TERMINAL_STATES) {
      const seg = makeSegment({ state, expiresAt: new Date(Date.now() + 60_000).toISOString() })
      expect(isSegmentActive(seg)).toBe(true)
    }
  })

  it("returns false for terminal states even when not expired", () => {
    for (const state of TERMINAL_STATES) {
      const seg = makeSegment({ state, expiresAt: new Date(Date.now() + 60_000).toISOString() })
      expect(isSegmentActive(seg)).toBe(false)
    }
  })

  it("returns false for expired segments even in active states", () => {
    const seg = makeSegment({
      state: "writing",
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
    })
    expect(isSegmentActive(seg)).toBe(false)
  })
})

// ── Write Eligibility ───────────────────────────────────────────────────────

describe("canWriteToSegment", () => {
  it("returns true for allocated and writing (non-expired)", () => {
    for (const state of ["allocated", "writing"] as SegmentState[]) {
      const seg = makeSegment({ state, expiresAt: new Date(Date.now() + 60_000).toISOString() })
      expect(canWriteToSegment(seg)).toBe(true)
    }
  })

  it("returns false for all other states", () => {
    for (const state of ALL_STATES) {
      if (state === "allocated" || state === "writing") continue
      const seg = makeSegment({ state, expiresAt: new Date(Date.now() + 60_000).toISOString() })
      expect(canWriteToSegment(seg)).toBe(false)
    }
  })

  it("returns false when the segment is expired", () => {
    const seg = makeSegment({
      state: "writing",
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
    })
    expect(canWriteToSegment(seg)).toBe(false)
  })
})

// ── Map Eligibility ─────────────────────────────────────────────────────────

describe("canMapSegment", () => {
  it("returns true for offered and mapped_by_destination (non-expired)", () => {
    for (const state of ["offered", "mapped_by_destination"] as SegmentState[]) {
      const seg = makeSegment({ state, expiresAt: new Date(Date.now() + 60_000).toISOString() })
      expect(canMapSegment(seg)).toBe(true)
    }
  })

  it("returns false for all other states", () => {
    for (const state of ALL_STATES) {
      if (state === "offered" || state === "mapped_by_destination") continue
      const seg = makeSegment({ state, expiresAt: new Date(Date.now() + 60_000).toISOString() })
      expect(canMapSegment(seg)).toBe(false)
    }
  })

  it("returns false when the segment is expired", () => {
    const seg = makeSegment({
      state: "offered",
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
    })
    expect(canMapSegment(seg)).toBe(false)
  })
})

// ── Sealing Protocol ────────────────────────────────────────────────────────

describe("sealing protocol", () => {
  it("isSegmentSealable returns true only for writing state", () => {
    expect(isSegmentSealable(makeSegment({ state: "writing" }))).toBe(true)
    for (const state of ALL_STATES) {
      if (state === "writing") continue
      expect(isSegmentSealable(makeSegment({ state }))).toBe(false)
    }
  })

  it("sealSegment transitions writing → sealed", () => {
    const seg = makeSegment({ state: "writing", handoffId: "ho-1", segmentId: "sg-1" })
    const sealed = sealSegment(seg)
    expect(sealed.state).toBe("sealed")
    expect(sealed.segmentId).toBe("sg-1")
    // descriptorDigest is set during seal
    expect(sealed.descriptorDigest).toBe("dd:ho-1:sg-1")
  })

  it("sealSegment is no-op when not in writing state", () => {
    const seg = makeSegment({ state: "allocated" })
    const result = sealSegment(seg)
    expect(result.state).toBe("allocated")
    // unchanged — shallow equality of own-properties
    expect(result.descriptorDigest).toBe("")
  })

  it("markMapped transitions offered → mapped_by_destination", () => {
    const seg = makeSegment({ state: "offered", byteLength: 4096 })
    const mapped = markMapped(seg)
    expect(mapped.state).toBe("mapped_by_destination")
    expect(mapped.mappedByteLength).toBe(4096)
  })

  it("markMapped is no-op when not in offered state", () => {
    const seg = makeSegment({ state: "writing" })
    const result = markMapped(seg)
    expect(result.state).toBe("writing")
  })

  it("markVerified transitions mapped_by_destination → import_verified", () => {
    const seg = makeSegment({ state: "mapped_by_destination" })
    const verified = markVerified(seg)
    expect(verified.state).toBe("import_verified")
  })

  it("markVerified is no-op when not in mapped_by_destination state", () => {
    const seg = makeSegment({ state: "writing" })
    const result = markVerified(seg)
    expect(result.state).toBe("writing")
  })

  it("markAcknowledged transitions import_verified → acknowledged", () => {
    const seg = makeSegment({ state: "import_verified" })
    const ackd = markAcknowledged(seg)
    expect(ackd.state).toBe("acknowledged")
  })

  it("markAcknowledged is no-op when not in import_verified state", () => {
    const seg = makeSegment({ state: "writing" })
    const result = markAcknowledged(seg)
    expect(result.state).toBe("writing")
  })

  it("releaseSegment transitions acknowledged → released", () => {
    const seg = makeSegment({ state: "acknowledged" })
    const released = releaseSegment(seg)
    expect(released.state).toBe("released")
  })

  it("releaseSegment is no-op when not in acknowledged state", () => {
    const seg = makeSegment({ state: "writing" })
    const result = releaseSegment(seg)
    expect(result.state).toBe("writing")
  })

  it("full happy-path sealing flow", () => {
    // Start writing
    const w = makeSegment({ state: "writing", handoffId: "h2", segmentId: "s2", byteLength: 8192 })
    const s1 = sealSegment(w)
    expect(s1.state).toBe("sealed")

    // Offer
    const s2 = { ...s1, state: "offered" as SegmentState }
    expect(markMapped(s2).state).toBe("mapped_by_destination")

    // Verify flow
    const mv = { ...s2, state: "mapped_by_destination" as SegmentState }
    const v = markVerified(mv)
    expect(v.state).toBe("import_verified")

    // Acknowledge
    const a = markAcknowledged(v)
    expect(a.state).toBe("acknowledged")

    // Release
    const r = releaseSegment(a)
    expect(r.state).toBe("released")
  })

  it("returns a new object each time (immutability)", () => {
    const seg = makeSegment({ state: "writing" })
    const sealed = sealSegment(seg)
    expect(sealed).not.toBe(seg)
    expect(seg.state).toBe("writing") // original unchanged
  })
})
