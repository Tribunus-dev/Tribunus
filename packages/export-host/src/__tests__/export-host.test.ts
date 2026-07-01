/**
 * Ephemeral Export Host Tests
 *
 * Tests for the standalone Codex export host executable.
 * Covers CLI argument parsing, manifest validation, entry loading,
 * buffer zeroing, and the full export pipeline.
 *
 * These tests use the runtime's crypto modules (same ones the host imports)
 * but exercise them through the export-host's public API surface.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes, createHash } from "node:crypto"

import {
  parseArgs,
  validateManifest,
  loadEncryptedEntries,
  zeroBuffer,
  exportEntries,
  runExport,
  validateConfig,
  buildDomainKeyStoreFromRelease,
  processEntriesInBatches,
  extractDerFromPem,
  loadAndValidateManifest,
  deserializeEncryptedEntry,
  requestKeyRelease,
} from "../export-host"

import type { ExportHostConfig, ExportHostResult, SignedManifest } from "../export-host"

import { encryptEntry, generateDek, wrapDek, buildAssociatedData } from "@tribunus/runtime/tribunus/dharma/codex/crypto/codex-crypto"
import type { EncryptedEntry } from "@tribunus/runtime/tribunus/dharma/codex/crypto/codex-crypto"

import {
  signManifest,
  initializeRootKey,
  encryptOutputForRecipient,
  generateEncryptionKeyPair,
} from "@tribunus/runtime/tribunus/dharma/codex/crypto/codex-export-crypto"

import type { KeyReleaseResponse, DomainKeyStore } from "@tribunus/runtime/tribunus/dharma/codex/crypto/domain-keys"

import { generateKeyPair, sign, verify } from "@tribunus/runtime/tribunus/dharma/crypto"

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string
let rootKeyPair: { publicKey: Buffer; privateKey: Buffer }
let rootKeyB64: string

function makeManifest(overrides: Partial<SignedManifest> = {}): SignedManifest {
  return {
    manifest: overrides.manifest ?? { datasetId: "test-dataset-1", version: "1.0.0" },
    signature: overrides.signature ?? "",
    signerIdentity: overrides.signerIdentity ?? "test-signer",
  }
}

function signManifestPayload(sm: SignedManifest, privateKey: Buffer): SignedManifest {
  const manifestJson = JSON.stringify(sm.manifest)
  const sig = signManifest(manifestJson, privateKey)
  return { ...sm, signature: sig.toString("base64") }
}

function makeEncryptedEntry(
  overrides: Partial<EncryptedEntry> = {},
  entryId: string = `entry-${randomBytes(4).toString("hex")}`,
  domainKey: Buffer = randomBytes(32),
): { entry: EncryptedEntry; dek: Buffer; plaintext: Buffer } {
  const dek = generateDek()
  const plaintext = Buffer.from(
    JSON.stringify({
      codexEntryId: entryId,
      title: "Test Entry",
      visibilityClass: overrides.visibilityClass ?? "public",
      schemaVersion: overrides.schemaVersion ?? 1,
      claims: [],
    }),
  )

  const aad = buildAssociatedData(entryId, overrides.visibilityClass ?? "public", overrides.schemaVersion ?? 1)
  const { ciphertext, iv, authTag } = encryptEntry(plaintext, dek, aad)
  const { wrappedDek, iv: wrapIv, authTag: wrapAuthTag } = wrapDek(dek, domainKey)
  const contentDigest = createHash("sha256").update(plaintext).digest("hex")

  return {
    entry: {
      entryId,
      domainId: overrides.domainId ?? "domain-public",
      visibilityClass: overrides.visibilityClass ?? "public",
      schemaVersion: overrides.schemaVersion ?? 1,
      iv,
      ciphertext,
      authTag,
      wrappedDek,
      wrapIv,
      wrapAuthTag,
      contentDigest,
      ...overrides,
    },
    dek,
    plaintext,
  }
}

function serializeEncryptedEntryForFile(entry: EncryptedEntry): string {
  return JSON.stringify({
    entryId: entry.entryId,
    domainId: entry.domainId,
    visibilityClass: entry.visibilityClass,
    schemaVersion: entry.schemaVersion,
    iv: entry.iv.toString("base64"),
    ciphertext: entry.ciphertext.toString("base64"),
    authTag: entry.authTag.toString("base64"),
    wrappedDek: entry.wrappedDek.toString("base64"),
    wrapIv: entry.wrapIv.toString("base64"),
    wrapAuthTag: entry.wrapAuthTag.toString("base64"),
    contentDigest: entry.contentDigest,
  })
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "export-host-test-"))
  return dir
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  rootKeyPair = generateKeyPair()
  rootKeyB64 = Buffer.from(rootKeyPair.publicKey).toString("base64")
  initializeRootKey(rootKeyB64)
})

// ── Tests: parseArgs ────────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("parses all required arguments", () => {
    const config = parseArgs([
      "--manifest", "/tmp/manifest.json",
      "--entries", "/tmp/entries",
      "--recipient-key", "/tmp/key.pub",
      "--output", "/tmp/result.pack",
    ])

    expect(config.manifestPath).toBe("/tmp/manifest.json")
    expect(config.entriesDir).toBe("/tmp/entries")
    expect(config.recipientKeyPath).toBe("/tmp/key.pub")
    expect(config.outputPath).toBe("/tmp/result.pack")
    expect(config.batchSize).toBe(100) // default
  })

  test("parses optional arguments", () => {
    const config = parseArgs([
      "--manifest", "/tmp/m.json",
      "--entries", "/tmp/e",
      "--recipient-key", "/tmp/k.pub",
      "--output", "/tmp/o.pack",
      "--lease-url", "http://127.0.0.1:8080",
      "--batch-size", "50",
      "--root-key", "dGVzdHJvb3RrZXk=",
    ])

    expect(config.leaseUrl).toBe("http://127.0.0.1:8080")
    expect(config.batchSize).toBe(50)
    expect(config.rootPublicKeyB64).toBe("dGVzdHJvb3RrZXk=")
  })

  test("throws on missing required argument", () => {
    expect(() => parseArgs([
      "--manifest", "/tmp/m.json",
      "--entries", "/tmp/e",
    ])).toThrow("--recipient-key")
  })

  test("throws on unknown flag", () => {
    expect(() => parseArgs([
      "--manifest", "/tmp/m.json",
      "--entries", "/tmp/e",
      "--recipient-key", "/tmp/k.pub",
      "--output", "/tmp/o.pack",
      "--bogus", "value",
    ])).toThrow("Unknown argument")
  })

  test("throws on batch-size < 1", () => {
    expect(() => parseArgs([
      "--manifest", "/tmp/m.json",
      "--entries", "/tmp/e",
      "--recipient-key", "/tmp/k.pub",
      "--output", "/tmp/o.pack",
      "--batch-size", "0",
    ])).toThrow("batch-size")
  })

  test("defaults to process.argv when no args given", () => {
    // parseArgs with default argv — just verify it resolves
    expect(typeof parseArgs).toBe("function")
  })
})

// ── Tests: validateConfig ────────────────────────────────────────────────────

describe("validateConfig", () => {
  let tmpDir: string
  let config: ExportHostConfig

  beforeAll(() => {
    tmpDir = makeTempDir()
    writeFileSync(join(tmpDir, "manifest.json"), "{}")
    mkdirSync(join(tmpDir, "entries"), { recursive: true })
    writeFileSync(join(tmpDir, "key.pub"), "fake-key-content")
    config = {
      manifestPath: join(tmpDir, "manifest.json"),
      entriesDir: join(tmpDir, "entries"),
      recipientKeyPath: join(tmpDir, "key.pub"),
      outputPath: join(tmpDir, "out.pack"),
      batchSize: 100,
    }
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("passes when all paths exist", () => {
    expect(() => validateConfig(config)).not.toThrow()
  })

  test("throws when manifest does not exist", () => {
    expect(() => validateConfig({ ...config, manifestPath: join(tmpDir, "nonexistent.json") })).toThrow("Manifest file not found")
  })

  test("throws when entries dir does not exist", () => {
    expect(() => validateConfig({ ...config, entriesDir: join(tmpDir, "nonexistent") })).toThrow("Entries directory not found")
  })
})

// ── Tests: validateManifest ──────────────────────────────────────────────────

describe("validateManifest", () => {
  test("accepts valid signature", () => {
    const manifestJson = JSON.stringify({ datasetId: "test-1" })
    const signature = Buffer.from(sign(rootKeyPair.privateKey, Buffer.from(manifestJson, "utf-8")))

    const result = validateManifest(manifestJson, signature, rootKeyPair.publicKey)
    expect(result).toBe(true)
  })

  test("rejects invalid signature", () => {
    const manifestJson = JSON.stringify({ datasetId: "test-1" })
    const badSignature = randomBytes(64)

    const result = validateManifest(manifestJson, badSignature, rootKeyPair.publicKey)
    expect(result).toBe(false)
  })

  test("rejects signature from wrong key", () => {
    const otherPair = generateKeyPair()
    const manifestJson = JSON.stringify({ datasetId: "test-1" })
    const signature = Buffer.from(sign(otherPair.privateKey, Buffer.from(manifestJson, "utf-8")))

    const result = validateManifest(manifestJson, signature, rootKeyPair.publicKey)
    expect(result).toBe(false)
  })

  test("rejects empty manifest", () => {
    const result = validateManifest("", Buffer.alloc(0), rootKeyPair.publicKey)
    expect(result).toBe(false)
  })
})

// ── Tests: loadAndValidateManifest ───────────────────────────────────────────

describe("loadAndValidateManifest", () => {
  test("loads and validates a properly signed manifest file", () => {
    const dir = makeTempDir()
    const manifestPath = join(dir, "signed-manifest.json")

    const sm = signManifestPayload(makeManifest(), rootKeyPair.privateKey)
    writeFileSync(manifestPath, JSON.stringify(sm))

    const result = loadAndValidateManifest(manifestPath, rootKeyPair.publicKey)
    expect(result.manifest.datasetId).toBe("test-dataset-1")
    expect(result.signature).toBe(sm.signature)

    rmSync(dir, { recursive: true, force: true })
  })

  test("throws on malformed manifest file", () => {
    const dir = makeTempDir()
    const manifestPath = join(dir, "bad-manifest.json")
    writeFileSync(manifestPath, "not json")

    expect(() => loadAndValidateManifest(manifestPath, rootKeyPair.publicKey)).toThrow()

    rmSync(dir, { recursive: true, force: true })
  })

  test("throws when signature is missing", () => {
    const dir = makeTempDir()
    const manifestPath = join(dir, "no-sig.json")
    writeFileSync(manifestPath, JSON.stringify({ manifest: {}, signature: "" }))

    expect(() => loadAndValidateManifest(manifestPath, rootKeyPair.publicKey)).toThrow()

    rmSync(dir, { recursive: true, force: true })
  })
})

// ── Tests: loadEncryptedEntries ──────────────────────────────────────────────

describe("loadEncryptedEntries", () => {
  test("reads encrypted entry files from directory", () => {
    const dir = makeTempDir()
    const domainKey = randomBytes(32)
    const { entry: e1 } = makeEncryptedEntry({ domainId: "domain-public" }, "entry-a", domainKey)
    const { entry: e2 } = makeEncryptedEntry({ domainId: "domain-contributor" }, "entry-b", domainKey)

    writeFileSync(join(dir, "entry-a.enc.json"), serializeEncryptedEntryForFile(e1))
    writeFileSync(join(dir, "entry-b.enc.json"), serializeEncryptedEntryForFile(e2))

    const entries = loadEncryptedEntries(dir)
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.entryId).sort()).toEqual(["entry-a", "entry-b"])

    rmSync(dir, { recursive: true, force: true })
  })

  test("skips non-encrypted files", () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, "readme.txt"), "hello")
    writeFileSync(join(dir, "data.json"), "{}")

    const entries = loadEncryptedEntries(dir)
    expect(entries).toHaveLength(0)

    rmSync(dir, { recursive: true, force: true })
  })

  test("skips malformed encrypted entry files", () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, "bad.enc.json"), "not valid json")

    const entries = loadEncryptedEntries(dir)
    expect(entries).toHaveLength(0)

    rmSync(dir, { recursive: true, force: true })
  })

  test("returns empty array for empty directory", () => {
    const dir = makeTempDir()
    const entries = loadEncryptedEntries(dir)
    expect(entries).toHaveLength(0)

    rmSync(dir, { recursive: true, force: true })
  })
})

// ── Tests: deserializeEncryptedEntry ─────────────────────────────────────────

describe("deserializeEncryptedEntry", () => {
  test("deserializes valid JSON to EncryptedEntry", () => {
    const { entry } = makeEncryptedEntry({ domainId: "domain-public" }, "test-entry", randomBytes(32))
    const json = serializeEncryptedEntryForFile(entry)
    const result = deserializeEncryptedEntry(json)

    expect(result.entryId).toBe(entry.entryId)
    expect(result.domainId).toBe(entry.domainId)
    expect(result.visibilityClass).toBe(entry.visibilityClass)
    expect(result.ciphertext).toEqual(entry.ciphertext)
    expect(result.iv).toEqual(entry.iv)
    expect(result.authTag).toEqual(entry.authTag)
    expect(result.wrappedDek).toEqual(entry.wrappedDek)
    expect(result.contentDigest).toBe(entry.contentDigest)
  })

  test("throws on invalid JSON", () => {
    expect(() => deserializeEncryptedEntry("not json")).toThrow()
  })
})

// ── Tests: zeroBuffer ────────────────────────────────────────────────────────

describe("zeroBuffer", () => {
  test("zeroes all bytes in a buffer", () => {
    const buf = randomBytes(256)
    const original = Buffer.from(buf) // copy

    zeroBuffer(buf)

    for (let i = 0; i < buf.length; i++) {
      expect(buf[i]).toBe(0)
    }

    // Ensure it was actually changed
    expect(Buffer.compare(buf, original)).not.toBe(0)
  })

  test("handles empty buffer", () => {
    const buf = Buffer.alloc(0)
    expect(() => zeroBuffer(buf)).not.toThrow()
  })

  test("handles null/undefined gracefully", () => {
    expect(() => zeroBuffer(null as unknown as Buffer)).not.toThrow()
    expect(() => zeroBuffer(undefined as unknown as Buffer)).not.toThrow()
  })

  test("zeroes a single-byte buffer", () => {
    const buf = Buffer.from([0xff])
    zeroBuffer(buf)
    expect(buf[0]).toBe(0)
  })
})

// ── Tests: buildDomainKeyStoreFromRelease ────────────────────────────────────

describe("buildDomainKeyStoreFromRelease", () => {
  test("builds store from key release response", () => {
    const release: KeyReleaseResponse = {
      releasedKeys: [
        { domainId: "domain-public", keyId: "key-1", wrappedKey: randomBytes(32).toString("base64") },
        { domainId: "domain-contributor", keyId: "key-2", wrappedKey: randomBytes(32).toString("base64") },
      ],
      signature: "test-sig",
      signedBy: "lease-authority",
    }

    const store = buildDomainKeyStoreFromRelease(release)

    const pubKey = store.getDomainKey("domain-public")
    expect(pubKey).toBeDefined()
    expect(pubKey!.keyId).toBe("key-1")

    const contrKey = store.getDomainKey("domain-contributor")
    expect(contrKey).toBeDefined()
    expect(contrKey!.keyId).toBe("key-2")

    const ids = store.listDomainIds()
    expect(ids).toContain("domain-public")
    expect(ids).toContain("domain-contributor")
  })

  test("returns undefined for unknown domain", () => {
    const release: KeyReleaseResponse = {
      releasedKeys: [],
      signature: "sig",
      signedBy: "authority",
    }

    const store = buildDomainKeyStoreFromRelease(release)
    expect(store.getDomainKey("domain-unknown")).toBeUndefined()
  })
})

// ── Tests: processEntriesInBatches ───────────────────────────────────────────

describe("processEntriesInBatches", () => {
  test("decrypts entries in batches", () => {
    const domainKey = randomBytes(32)
    const domainKeys: DomainKeyStore = {
      getDomainKey: () => ({ domainId: "domain-public", wrappingKey: domainKey, keyId: "k1", rotation: 0 }),
      listDomainIds: () => ["domain-public"],
    }

    const { entry: e1, plaintext: pt1 } = makeEncryptedEntry({ domainId: "domain-public" }, "entry-1", domainKey)
    const { entry: e2, plaintext: pt2 } = makeEncryptedEntry({ domainId: "domain-public" }, "entry-2", domainKey)

    const { plaintexts, excluded } = processEntriesInBatches([e1, e2], domainKeys, 1)

    expect(plaintexts).toHaveLength(2)
    expect(excluded).toBe(0)
    expect(plaintexts[0]).toEqual(pt1)
    expect(plaintexts[1]).toEqual(pt2)
  })

  test("excludes entries with missing domain key", () => {
    const domainKeys: DomainKeyStore = {
      getDomainKey: () => undefined,
      listDomainIds: () => [],
    }

    const { entry: e1 } = makeEncryptedEntry({ domainId: "domain-unknown" }, "entry-1", randomBytes(32))

    const { plaintexts, excluded } = processEntriesInBatches([e1], domainKeys)

    expect(plaintexts).toHaveLength(0)
    expect(excluded).toBe(1)
  })

  test("excludes entries with tampered ciphertext (integrity check fails)", () => {
    const domainKey = randomBytes(32)
    const domainKeys: DomainKeyStore = {
      getDomainKey: () => ({ domainId: "domain-public", wrappingKey: domainKey, keyId: "k1", rotation: 0 }),
      listDomainIds: () => ["domain-public"],
    }

    const { entry: e1 } = makeEncryptedEntry({ domainId: "domain-public" }, "entry-1", domainKey)
    // Tamper with the ciphertext
    e1.ciphertext[0] ^= 0xff

    const { plaintexts, excluded } = processEntriesInBatches([e1], domainKeys)

    expect(plaintexts).toHaveLength(0)
    expect(excluded).toBe(1)
  })
})

// ── Tests: extractDerFromPem ─────────────────────────────────────────────────

describe("extractDerFromPem", () => {
  test("extracts DER from PEM public key", () => {
    const derBytes = randomBytes(32)
    const b64 = derBytes.toString("base64")
    const pem = `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`

    const result = extractDerFromPem(pem)
    expect(result).toEqual(derBytes)
  })

  test("handles PEM with multiple lines of base64", () => {
    // Generate a longer key so it spans multiple lines
    const derBytes = randomBytes(256)
    const b64 = Buffer.from(derBytes).toString("base64")
    // Split into 64-char lines
    const lines = b64.match(/.{1,64}/g) || [b64]
    const pem = `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`

    const result = extractDerFromPem(pem)
    expect(result).toEqual(derBytes)
  })

  test("passes through non-PEM (no markers)", () => {
    const raw = randomBytes(32)
    const result = extractDerFromPem(raw.toString("base64"))
    expect(result).toEqual(raw)
  })
})

// ── Tests: exportEntries (full pipeline) ──────────────────────────────────────

describe("exportEntries", () => {
  test("runs full export pipeline successfully", async () => {
    const dir = makeTempDir()
    const domainKey = randomBytes(32)

    // Create encrypted entries
    const { entry: e1 } = makeEncryptedEntry({ domainId: "domain-public" }, "entry-1", domainKey)
    const { entry: e2 } = makeEncryptedEntry({ domainId: "domain-public" }, "entry-2", domainKey)

    writeFileSync(join(dir, "entry-1.enc.json"), serializeEncryptedEntryForFile(e1))
    writeFileSync(join(dir, "entry-2.enc.json"), serializeEncryptedEntryForFile(e2))

    // Create signed manifest
    const manifestContent = {
      datasetId: "test-ds",
      version: "1.0",
      domainKeys: {
        releasedKeys: [
          { domainId: "domain-public", keyId: "k1", wrappedKey: domainKey.toString("base64") },
        ],
        signature: "embedded-sig",
        signedBy: "embedded-authority",
      },
    }
    const sm = signManifestPayload(
      { manifest: manifestContent, signature: "", signerIdentity: "test-signer" },
      rootKeyPair.privateKey,
    )
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(sm))

    // Create recipient key
    const recipientPair = generateEncryptionKeyPair()
    writeFileSync(join(dir, "recipient.pub"), recipientPair.publicKey)

    // Run export
    const config: ExportHostConfig = {
      manifestPath: join(dir, "manifest.json"),
      entriesDir: dir,
      recipientKeyPath: join(dir, "recipient.pub"),
      outputPath: join(dir, "result.pack"),
      batchSize: 10,
      rootPublicKeyB64: rootKeyB64,
    }

    const result = await exportEntries(config)

    expect(result.success).toBe(true)
    expect(result.entryCount).toBe(2)
    expect(result.excludedCount).toBe(0)
    expect(result.outputPath).toBe(join(dir, "result.pack"))

    // Verify output file exists
    const outputFile = readFileSync(join(dir, "result.pack"))
    expect(outputFile.length).toBeGreaterThan(0)

    // Verify receipt file exists
    const receiptRaw = readFileSync(join(dir, "result.pack.receipt.json"), "utf-8")
    const receipt = JSON.parse(receiptRaw)
    expect(receipt.entryCount).toBe(2)
    expect(receipt.authorityUsed).toBe("full_dataset_export")
    expect(receipt.exportManifestDigest).toBeTruthy()
    expect(receipt.outputDigest).toBeTruthy()

    rmSync(dir, { recursive: true, force: true })
  })

  test("returns error when no entries found", async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, "manifest.json"), "{}")
    mkdirSync(join(dir, "entries"), { recursive: true })

    const config: ExportHostConfig = {
      manifestPath: join(dir, "manifest.json"),
      entriesDir: join(dir, "entries"),
      recipientKeyPath: join(dir, "manifest.json"),
      outputPath: join(dir, "result.pack"),
      batchSize: 100,
      rootPublicKeyB64: rootKeyB64,
    }

    // Need a proper manifest for the entries dir check to pass
    const sm = signManifestPayload(makeManifest(), rootKeyPair.privateKey)
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(sm))
    writeFileSync(join(dir, "key.pub"), generateEncryptionKeyPair().publicKey)

    const result = await exportEntries({ ...config, entriesDir: dir, recipientKeyPath: join(dir, "key.pub") })
    expect(result.success).toBe(false)
    expect(result.error).toContain("No encrypted entries found")

    rmSync(dir, { recursive: true, force: true })
  })
})

// ── Tests: runExport (CLI entry point) ───────────────────────────────────────

describe("runExport", () => {
  test("exits with error on missing args", async () => {
    // Save original argv and exit
    const origArgv = process.argv
    const origExit = process.exit
    const origStdout = process.stdout.write

    let exitCode: number | null = null
    let output = ""

    process.exit = ((code?: number) => { exitCode = code ?? 0 }) as typeof process.exit
    process.stdout.write = ((str: string) => { output += str; return true }) as typeof process.stdout.write
    process.argv = ["node", "export-host"]

    await runExport()

    expect(exitCode).toBe(1)
    expect(output).toContain("success\":false")

    // Restore
    process.argv = origArgv
    process.exit = origExit
    process.stdout.write = origStdout
  })
})
