/**
 * Tests — Local Transport Cancellation
 */

import { describe, it, expect } from "bun:test"
import type { LocalTransportCancellationStage } from "../transport-cancellation"
import { getCancellationEffect, classifyCancelState } from "../transport-cancellation"

describe("getCancellationEffect", () => {
  it("pre_handshake requires no cleanup", () => {
    const effect = getCancellationEffect("pre_handshake")
    expect(effect).toEqual({
      releaseSegment: false,
      invalidateDest: false,
      retainSource: true,
      needsRollback: false,
    })
  })

  it("handshake requires no cleanup", () => {
    const effect = getCancellationEffect("handshake")
    expect(effect).toEqual({
      releaseSegment: false,
      invalidateDest: false,
      retainSource: true,
      needsRollback: false,
    })
  })

  it("handoff_offer requires no cleanup", () => {
    const effect = getCancellationEffect("handoff_offer")
    expect(effect).toEqual({
      releaseSegment: false,
      invalidateDest: false,
      retainSource: true,
      needsRollback: false,
    })
  })

  it("export_ready requires release + rollback, retains source", () => {
    const effect = getCancellationEffect("export_ready")
    expect(effect).toEqual({
      releaseSegment: true,
      invalidateDest: false,
      retainSource: true,
      needsRollback: true,
    })
  })

  it("segment_descriptor requires full rollback with dest invalidation", () => {
    const effect = getCancellationEffect("segment_descriptor")
    expect(effect).toEqual({
      releaseSegment: true,
      invalidateDest: true,
      retainSource: true,
      needsRollback: true,
    })
  })

  it("import_started drops retainSource", () => {
    const effect = getCancellationEffect("import_started")
    expect(effect).toEqual({
      releaseSegment: true,
      invalidateDest: true,
      retainSource: false,
      needsRollback: true,
    })
  })

  it("import_verified same as import_started", () => {
    const effect = getCancellationEffect("import_verified")
    expect(effect).toEqual({
      releaseSegment: true,
      invalidateDest: true,
      retainSource: false,
      needsRollback: true,
    })
  })

  it("import_activated same as import_verified", () => {
    const effect = getCancellationEffect("import_activated")
    expect(effect).toEqual({
      releaseSegment: true,
      invalidateDest: true,
      retainSource: false,
      needsRollback: true,
    })
  })

  it("import_acknowledged requires no cleanup", () => {
    const effect = getCancellationEffect("import_acknowledged")
    expect(effect).toEqual({
      releaseSegment: false,
      invalidateDest: false,
      retainSource: false,
      needsRollback: false,
    })
  })

  it("post_commit requires no cleanup", () => {
    const effect = getCancellationEffect("post_commit")
    expect(effect).toEqual({
      releaseSegment: false,
      invalidateDest: false,
      retainSource: false,
      needsRollback: false,
    })
  })

  it("source_cleanup requires no cleanup", () => {
    const effect = getCancellationEffect("source_cleanup")
    expect(effect).toEqual({
      releaseSegment: false,
      invalidateDest: false,
      retainSource: false,
      needsRollback: false,
    })
  })
})

describe("classifyCancelState", () => {
  it('classifies pre_handshake as harmless', () => {
    expect(classifyCancelState("pre_handshake")).toBe("harmless")
  })

  it('classifies handshake as harmless', () => {
    expect(classifyCancelState("handshake")).toBe("harmless")
  })

  it('classifies handoff_offer as harmless', () => {
    expect(classifyCancelState("handoff_offer")).toBe("harmless")
  })

  it('classifies export_ready as mid_handoff', () => {
    expect(classifyCancelState("export_ready")).toBe("mid_handoff")
  })

  it('classifies segment_descriptor as mid_handoff', () => {
    expect(classifyCancelState("segment_descriptor")).toBe("mid_handoff")
  })

  it('classifies import_started as deep_import', () => {
    expect(classifyCancelState("import_started")).toBe("deep_import")
  })

  it('classifies import_verified as deep_import', () => {
    expect(classifyCancelState("import_verified")).toBe("deep_import")
  })

  it('classifies import_activated as deep_import', () => {
    expect(classifyCancelState("import_activated")).toBe("deep_import")
  })

  it('classifies import_acknowledged as late', () => {
    expect(classifyCancelState("import_acknowledged")).toBe("late")
  })

  it('classifies post_commit as late', () => {
    expect(classifyCancelState("post_commit")).toBe("late")
  })

  it('classifies source_cleanup as late', () => {
    expect(classifyCancelState("source_cleanup")).toBe("late")
  })
})

describe("exhaustive stage coverage", () => {
  const stages: LocalTransportCancellationStage[] = [
    "pre_handshake",
    "handshake",
    "handoff_offer",
    "export_ready",
    "segment_descriptor",
    "import_started",
    "import_verified",
    "import_activated",
    "import_acknowledged",
    "post_commit",
    "source_cleanup",
  ]

  it("getCancellationEffect handles all known stages", () => {
    for (const stage of stages) {
      const result = getCancellationEffect(stage)
      expect(typeof result.releaseSegment).toBe("boolean")
      expect(typeof result.invalidateDest).toBe("boolean")
      expect(typeof result.retainSource).toBe("boolean")
      expect(typeof result.needsRollback).toBe("boolean")
    }
  })

  it("classifyCancelState handles all known stages", () => {
    const severities = ["harmless", "mid_handoff", "deep_import", "late"]
    for (const stage of stages) {
      expect(severities).toContain(classifyCancelState(stage))
    }
  })
})
