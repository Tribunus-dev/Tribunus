/**
 * Prism Local-Host KV Transport — Deserializer Tests
 */

import { expect, test, describe } from "bun:test"
import {
  validateChecksum,
  validateByteLength,
  canDeserialize,
} from "../kv-deserializer"

// ── validateChecksum ────────────────────────────────────────────────────────

describe("validateChecksum", () => {
  test("matching checksums return true", () => {
    expect(validateChecksum("abc123", "abc123")).toBe(true)
  })

  test("matching checksums with different case return true", () => {
    expect(validateChecksum("ABC123", "abc123")).toBe(true)
    expect(validateChecksum("aBc123", "AbC123")).toBe(true)
  })

  test("differing checksums return false", () => {
    expect(validateChecksum("abc123", "def456")).toBe(false)
  })

  test("empty expected checksum returns false", () => {
    expect(validateChecksum("", "abc123")).toBe(false)
  })

  test("empty actual checksum returns false", () => {
    expect(validateChecksum("abc123", "")).toBe(false)
  })

  test("both empty returns false", () => {
    expect(validateChecksum("", "")).toBe(false)
  })
})

// ── validateByteLength ──────────────────────────────────────────────────────

describe("validateByteLength", () => {
  test("matching lengths return true", () => {
    expect(validateByteLength(1024, 1024)).toBe(true)
    expect(validateByteLength(1, 1)).toBe(true)
  })

  test("differing lengths return false", () => {
    expect(validateByteLength(1024, 2048)).toBe(false)
    expect(validateByteLength(100, 99)).toBe(false)
  })

  test("zero expected returns false", () => {
    expect(validateByteLength(0, 100)).toBe(false)
  })

  test("negative expected returns false", () => {
    expect(validateByteLength(-1, 100)).toBe(false)
  })

  test("zero actual returns false", () => {
    expect(validateByteLength(100, 0)).toBe(false)
  })

  test("both zero returns false", () => {
    expect(validateByteLength(0, 0)).toBe(false)
  })
})

// ── canDeserialize ──────────────────────────────────────────────────────────

describe("canDeserialize", () => {
  const supported = ["flat_buffer", "tensor_page_array"]

  test("returns true for supported representation", () => {
    expect(canDeserialize("flat_buffer", supported)).toBe(true)
    expect(canDeserialize("tensor_page_array", supported)).toBe(true)
  })

  test("returns false for unsupported representation", () => {
    expect(canDeserialize("binary_blob", supported)).toBe(false)
  })

  test("returns false for empty representation", () => {
    expect(canDeserialize("", supported)).toBe(false)
  })

  test("returns false for empty supported list", () => {
    expect(canDeserialize("flat_buffer", [])).toBe(false)
  })

  test("returns false when supported list is not provided", () => {
    // @ts-expect-error — testing runtime behavior with missing arg
    expect(canDeserialize("flat_buffer", undefined)).toBe(false)
  })
})
