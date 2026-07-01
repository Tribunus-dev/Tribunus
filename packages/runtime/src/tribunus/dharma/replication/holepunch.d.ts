/**
 * Ambient type declarations for Holepunch packages that lack bundled types.
 *
 * These packages are JavaScript-only. Their APIs are consumed through the
 * runtime types we know from the package documentation.
 *
 * TODO: Replace with proper declarations or published @types packages
 *       when they become available.
 */

// ── hypercore (declared first — other modules reference it) -------------------

declare module "hypercore" {
  class Hypercore<T = Uint8Array> {
    readonly key: Uint8Array
    readonly discoveryKey: Uint8Array
    readonly length: number
    readonly writable: boolean
    readonly opened: boolean
    constructor(storage: string | Record<string, unknown>, key?: Uint8Array, opts?: Record<string, unknown>)
    ready(): Promise<void>
    append(block: T): Promise<number>
    get(index: number): Promise<T>
    close(): Promise<void>
    replicate(isInitiator: boolean, opts?: Record<string, unknown>): unknown
  }

  export default Hypercore
}

// ── corestore -----------------------------------------------------------------

declare module "corestore" {
  import type Hypercore from "hypercore"

  interface CorestoreOptions {
    primary?: string
  }

  class Corestore {
    constructor(path?: string, opts?: CorestoreOptions)
    ready(): Promise<void>
    get(name: string): Hypercore
    replicate(isInitiator: boolean, opts?: Record<string, unknown>): unknown
    close(): Promise<void>
  }

  export default Corestore
}

// ── b4a ----------------------------------------------------------------------

declare module "b4a" {
  export function from(value: string, encoding?: "utf-8" | "hex" | "base64" | "binary"): Uint8Array
  export function alloc(size: number): Uint8Array
  export function toString(buffer: Uint8Array, encoding?: "utf-8" | "hex" | "base64" | "binary"): string
  export function isBuffer(value: unknown): value is Uint8Array
}

// ── compact-encoding ---------------------------------------------------------

declare module "compact-encoding" {
  interface Encoding<T> {
    encode(state: { buffer: Uint8Array; start: number }, value: T): void
    decode(state: { buffer: Uint8Array; start: number }): T
    preencode(state: { length: number }, value: T): void
  }

  export const uint8: Encoding<number>
  export const uint16: Encoding<number>
  export const uint32: Encoding<number>
  export const uint64: Encoding<bigint>
  export const string: Encoding<string>
  export const buffer: Encoding<Uint8Array>
  export const bytes: Encoding<Uint8Array>
  export function array<T>(encoding: Encoding<T>): Encoding<T[]>
  export function fixed(size: number): Encoding<Uint8Array>
  export function optional<T>(encoding: Encoding<T>): Encoding<T | null>
}

// ── autobase ------------------------------------------------------------------

declare module "autobase" {
  import type Hypercore from "hypercore"

  interface AutobaseOpts {
    inputs?: Hypercore[]
    outputs?: Hypercore[]
    apply?: (batch: unknown[]) => Promise<void>
    [key: string]: unknown
  }

  class Autobase {
    constructor(opts: AutobaseOpts)
    ready(): Promise<void>
    readonly view: Hypercore
    readonly length: number
    append(block: Uint8Array | string): Promise<number>
    close(): Promise<void>
  }

  export default Autobase
}

// ── hyperbee ------------------------------------------------------------------

declare module "hyperbee" {
  import type Hypercore from "hypercore"

  interface BeeEntry {
    key: Uint8Array
    value: Uint8Array
  }

  class Hyperbee {
    constructor(core: Hypercore, opts?: Record<string, unknown>)
    ready(): Promise<void>
    put(key: string | Uint8Array, value: string | Uint8Array): Promise<void>
    get(key: string | Uint8Array): Promise<BeeEntry>
    del(key: string | Uint8Array): Promise<void>
    createReadStream(opts?: Record<string, unknown>): AsyncIterable<BeeEntry>
    close(): Promise<void>
  }

  export default Hyperbee
}

// ── hyperswarm ----------------------------------------------------------------

declare module "hyperswarm" {
  class Hyperswarm {
    constructor(opts?: Record<string, unknown>)
    join(topic: Uint8Array, opts?: Record<string, unknown>): { flushed: Promise<void> }
    leave(topic: Uint8Array): Promise<void>
    destroy(): Promise<void>
    on(event: string, handler: (...args: unknown[]) => void): this
  }

  export default Hyperswarm
}
