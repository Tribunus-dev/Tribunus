/**
 * Prism KV Handoff — Source Disposition Tests
 *
 * Pure function tests for source-disposition.ts
 */

import { expect, test, describe } from "bun:test"
import {
  createDispositionRecord,
  resolveDisposition,
  isDispositionResolved,
} from "../source-disposition"
import type { SourceRetentionPolicy } from "../handoff-types"

// ── createDispositionRecord ─────────────────────────────────────────────────

describe("createDispositionRecord", () => {
  test("creates record with pending state", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_destination_commit",
    )

    expect(record.handoffId).toBe("ho-001")
    expect(record.sourceWorkerId).toBe("worker-a")
    expect(record.sourceKvNamespaceId).toBe("ns-prefill-1")
    expect(record.policy).toBe("retain_until_destination_commit")
    expect(record.state).toBe("pending")
    expect(record.resolvedAt).toBeNull()
  })

  test("sets deadline for retain policies", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_destination_commit",
    )
    expect(record.deadlineAt).not.toBeNull()
  })

  test("does not set deadline for release policies", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "release_after_destination_commit",
    )
    expect(record.deadlineAt).toBeNull()
  })

  test("does not set deadline for invalidate policies", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "invalidate_after_destination_commit",
    )
    expect(record.deadlineAt).toBeNull()
  })
})

// ── resolveDisposition ──────────────────────────────────────────────────────

describe("resolveDisposition", () => {
  const POLICIES: SourceRetentionPolicy[] = [
    "retain_until_destination_commit",
    "retain_until_decode_completion",
    "release_after_destination_commit",
    "invalidate_after_destination_commit",
  ]

  test("retains on commit success with retain_until_destination_commit", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_destination_commit",
    )

    const resolved = resolveDisposition(record, true, true)
    expect(resolved.state).toBe("retained")
    expect(resolved.resolvedAt).not.toBeNull()
  })

  test("stays pending on commit failure with retain_until_destination_commit", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_destination_commit",
    )

    const resolved = resolveDisposition(record, false, true)
    expect(resolved.state).toBe("pending")
    expect(resolved.resolvedAt).toBeNull()
  })

  test("retains on decode complete with retain_until_decode_completion", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_decode_completion",
    )

    const resolved = resolveDisposition(record, true, true)
    expect(resolved.state).toBe("retained")
  })

  test("stays pending without decode complete", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_decode_completion",
    )

    const resolved = resolveDisposition(record, true, false)
    expect(resolved.state).toBe("pending")
    expect(resolved.resolvedAt).toBeNull()
  })

  test("releases on commit success with release_after_destination_commit", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "release_after_destination_commit",
    )

    const resolved = resolveDisposition(record, true, false)
    expect(resolved.state).toBe("released")
    expect(resolved.resolvedAt).not.toBeNull()
  })

  test("invalidates on commit success with invalidate_after_destination_commit", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "invalidate_after_destination_commit",
    )

    const resolved = resolveDisposition(record, true, false)
    expect(resolved.state).toBe("invalidated")
    expect(resolved.resolvedAt).not.toBeNull()
  })

  test("does not resolve if already resolved (idempotent)", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_destination_commit",
    )
    const resolved1 = resolveDisposition(record, true, true)
    expect(resolved1.state).toBe("retained")

    // A second call should not change state
    const resolved2 = resolveDisposition(resolved1, false, false)
    expect(resolved2.state).toBe("retained")
  })
})

// ── isDispositionResolved ───────────────────────────────────────────────────

describe("isDispositionResolved", () => {
  test("returns false for pending", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_destination_commit",
    )
    expect(isDispositionResolved(record)).toBe(false)
  })

  test("returns true for retained", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "retain_until_destination_commit",
    )
    const resolved = resolveDisposition(record, true, true)
    expect(isDispositionResolved(resolved)).toBe(true)
  })

  test("returns true for released", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "release_after_destination_commit",
    )
    const resolved = resolveDisposition(record, true, false)
    expect(isDispositionResolved(resolved)).toBe(true)
  })

  test("returns true for invalidated", () => {
    const record = createDispositionRecord(
      "ho-001", "worker-a", "ns-prefill-1",
      "invalidate_after_destination_commit",
    )
    const resolved = resolveDisposition(record, true, false)
    expect(isDispositionResolved(resolved)).toBe(true)
  })
})
