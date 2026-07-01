/**
 * Dharma Replication — Binary Encoding Helpers
 *
 * Wraps compact-encoding and b4a for deterministic Dharma event serialization
 * over the wire. All event envelope bytes use the same canonical JSON rules
 * as Phase A types.
 */

import c from "compact-encoding"
import b4a from "b4a"
import type { Encoding } from "compact-encoding"

// ── Re-export helpers --------------------------------------------------------

export { b4a }

/** Encode a fixed-length hex string as binary. */
export const hex = c.array(c.uint8)

/** Encode a UTF-8 string. */
export const string = c.string

/** Encode a Dharma protocol version as a uint16. */
export const protocolVersion = c.uint16

/** Encode a uint32 for counters/limits. */
export const uint32 = c.uint32

/** Encode a uint64 for byte counts. */
export const uint64 = c.uint64

/** Encode a uint8 for small enums. */
export const uint8 = c.uint8

/** Encode a fixed-size 32-byte public key / hash. */
export const key32 = c.fixed(32)

/** Encode a fixed-size 64-byte signature. */
export const signature64 = c.fixed(64)

/** Encode a fixed-size 8-byte nonce. */
export const nonce8 = c.fixed(8)

/** Encode a fixed-size 16-byte IV. */
export const iv16 = c.fixed(16)

interface CodecShape {
  preencode(state: { length: number }, value: unknown): void
  encode(state: { buffer: Uint8Array; start: number }, value: unknown): void
  decode(state: { buffer: Uint8Array; start: number }): unknown
}

/**
 * Build an optional codec — encodes a 1-byte presence flag followed by
 * the inner codec's payload when present, or a zero flag when absent.
 */
function optional<T>(
  inner: CodecShape,
): CodecShape {
  return {
    preencode(state: { length: number }, value: unknown): void {
      state.length += 1
      if (value != null) inner.preencode(state, value)
    },
    encode(state: { buffer: Uint8Array; start: number }, value: unknown): void {
      state.buffer[state.start++] = value != null ? 1 : 0
      if (value != null) inner.encode(state, value)
    },
    decode(state: { buffer: Uint8Array; start: number }): unknown {
      return state.buffer[state.start++] ? inner.decode(state) : null
    },
  }
}

/** Encode an optional string. */
export const optionalString = optional(c.string)

/** Encode a variable-length byte array with length prefix. */
export const bytes = c.bytes

/** Encode an array of fixed-size keys. */
export function keyArray(count: number) {
  return c.array(c.fixed(count))
}

