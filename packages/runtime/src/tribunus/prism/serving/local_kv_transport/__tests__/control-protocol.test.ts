/**
 * Prism Local-Host KV Transport — Control Protocol Tests
 */

import { describe, it, expect } from "bun:test"
import {
  createControlMessage,
  validateControlMessage,
  isSequential,
  getExpectedControlFlow,
} from "../local-control-protocol"
import type { LocalKvControlMessageKind } from "../local-transport-types"

// ── createControlMessage ────────────────────────────────────────────────────

describe("createControlMessage", () => {
  it("creates a control message with the given fields", () => {
    const msg = createControlMessage("handoff-1", "handshake", { hello: "world" }, "src-inst", "dst-inst")
    expect(msg.protocolVersion).toBe(1)
    expect(msg.handoffId).toBe("handoff-1")
    expect(msg.kind).toBe("handshake")
    expect(msg.sourceWorkerInstanceId).toBe("src-inst")
    expect(msg.destinationWorkerInstanceId).toBe("dst-inst")
    expect(msg.payload).toEqual({ hello: "world" })
    expect(msg.messageId).toBeTruthy()
    expect(msg.sequenceNumber).toBe(1)
    expect(msg.routeId).toBe("src-inst->dst-inst")
    expect(msg.sentAt).toBeTruthy()
    expect(msg.signature).toBeTruthy()
  })

  it("handles null payload", () => {
    const msg = createControlMessage("h", "heartbeat", null, "src", "dst")
    expect(msg.payload).toBeNull()
    expect(msg.payloadDigest).toBe("null")
  })

  it("produces unique message IDs", () => {
    const a = createControlMessage("h", "commit", null, "src", "dst")
    const b = createControlMessage("h", "commit", null, "src", "dst")
    expect(a.messageId).not.toBe(b.messageId)
  })

  it("produces consistent payload digests for identical payloads", () => {
    const payload = { key: "value", num: 42 }
    const a = createControlMessage("h", "commit", payload, "src", "dst")
    const b = createControlMessage("h", "commit", payload, "src", "dst")
    expect(a.payloadDigest).toBe(b.payloadDigest)
  })
})

// ── validateControlMessage ──────────────────────────────────────────────────

describe("validateControlMessage", () => {
  it("accepts a valid control message", () => {
    const msg = createControlMessage("h-1", "handshake", null, "src", "dst")
    const result = validateControlMessage(msg, "h-1", "src", "dst")
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("rejects mismatched handoff ID", () => {
    const msg = createControlMessage("h-1", "handshake", null, "src", "dst")
    const result = validateControlMessage(msg, "h-2", "src", "dst")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Handoff ID mismatch")
  })

  it("rejects mismatched source instance", () => {
    const msg = createControlMessage("h-1", "handshake", null, "src", "dst")
    const result = validateControlMessage(msg, "h-1", "wrong-src", "dst")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Source instance mismatch")
  })

  it("rejects mismatched destination instance", () => {
    const msg = createControlMessage("h-1", "handshake", null, "src", "dst")
    const result = validateControlMessage(msg, "h-1", "src", "wrong-dst")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Destination instance mismatch")
  })

  it("rejects missing messageId", () => {
    const msg = createControlMessage("h-1", "handshake", null, "src", "dst")
    msg.messageId = ""
    const result = validateControlMessage(msg, "h-1", "src", "dst")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Missing messageId")
  })

  it("rejects missing sentAt", () => {
    const msg = createControlMessage("h-1", "handshake", null, "src", "dst")
    msg.sentAt = ""
    const result = validateControlMessage(msg, "h-1", "src", "dst")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Missing sentAt")
  })

  it("rejects missing signature", () => {
    const msg = createControlMessage("h-1", "handshake", null, "src", "dst")
    msg.signature = ""
    const result = validateControlMessage(msg, "h-1", "src", "dst")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Missing signature")
  })
})

// ── isSequential ────────────────────────────────────────────────────────────

describe("isSequential", () => {
  it("returns true when current follows last", () => {
    expect(isSequential(6, 5)).toBe(true)
  })

  it("returns true for the initial transition 1→2", () => {
    expect(isSequential(2, 1)).toBe(true)
  })

  it("returns false when current equals last", () => {
    expect(isSequential(5, 5)).toBe(false)
  })

  it("returns false when current precedes last", () => {
    expect(isSequential(3, 5)).toBe(false)
  })

  it("returns false when there is a gap", () => {
    expect(isSequential(8, 5)).toBe(false)
  })
})

// ── getExpectedControlFlow ──────────────────────────────────────────────────

describe("getExpectedControlFlow", () => {
  const flowCases: { kind: LocalKvControlMessageKind; expected: string[] }[] = [
    { kind: "handshake", expected: ["handshake", "handshake_accept"] },
    { kind: "handshake_accept", expected: ["handshake_accept"] },
    { kind: "handoff_offer", expected: ["handoff_offer", "handoff_accept", "handoff_reject"] },
    { kind: "handoff_accept", expected: ["handoff_accept"] },
    { kind: "handoff_reject", expected: ["handoff_reject"] },
    { kind: "export_ready", expected: ["export_ready", "segment_descriptor"] },
    { kind: "segment_descriptor", expected: ["segment_descriptor"] },
    { kind: "import_started", expected: ["import_started", "import_verified"] },
    { kind: "import_verified", expected: ["import_verified", "import_activated"] },
    { kind: "import_activated", expected: ["import_activated", "import_acknowledged"] },
    { kind: "import_acknowledged", expected: ["import_acknowledged"] },
    { kind: "commit", expected: ["commit"] },
    { kind: "rollback", expected: ["rollback"] },
    { kind: "cancel", expected: ["cancel"] },
    { kind: "source_disposition_request", expected: ["source_disposition_request", "source_disposition_complete"] },
    { kind: "source_disposition_complete", expected: ["source_disposition_complete"] },
    { kind: "heartbeat", expected: ["heartbeat"] },
    { kind: "error", expected: ["error"] },
  ]

  for (const { kind, expected } of flowCases) {
    it(`returns expected flow for "${kind}"`, () => {
      expect(getExpectedControlFlow(kind)).toEqual(expected)
    })
  }

  it("covers all 18 message kinds", () => {
    expect(flowCases.length).toBe(18)
  })
})
