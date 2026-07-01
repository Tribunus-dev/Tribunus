import { describe, test, expect } from "bun:test"
import {
  createDomainKeyStore,
  getActiveDomainKey,
  visibilityToDomainId,
  getRequiredDomains,
} from "../domain-keys"
import type { DomainKey, DomainKeyStore } from "../domain-keys"
import type { CodexVisibilityClass } from "../../codex-types"

// ── Helpers ──────────────────────────────────────────────────────────

function makeWrappingKey(): Buffer {
  return Buffer.from(
    Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)),
  )
}

function makeDomainKey(
  domainId: string,
  rotation: number = 0,
): DomainKey {
  return {
    domainId,
    wrappingKey: makeWrappingKey(),
    keyId: `${domainId}-v${rotation}`,
    rotation,
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe("domain-keys", () => {
  describe("createDomainKeyStore", () => {
    test("creates store from an array of domain keys", () => {
      const keys = [
        makeDomainKey("domain-session"),
        makeDomainKey("domain-public"),
      ]
      const store = createDomainKeyStore(keys)

      expect(store.listDomainIds()).toEqual(["domain-session", "domain-public"])
    })

    test("returns empty store when given no keys", () => {
      const store = createDomainKeyStore([])
      expect(store.listDomainIds()).toEqual([])
    })

    test("store.getDomainKey retrieves a key by domain id", () => {
      const key = makeDomainKey("domain-contributor", 1)
      const store = createDomainKeyStore([key])

      expect(store.getDomainKey("domain-contributor")).toEqual(key)
    })

    test("store.getDomainKey returns undefined for unknown domain", () => {
      const store = createDomainKeyStore([])
      expect(store.getDomainKey("domain-unknown")).toBeUndefined()
    })
  })

  describe("getActiveDomainKey", () => {
    test("returns the domain key from the store", () => {
      const key = makeDomainKey("domain-session")
      const store = createDomainKeyStore([key])

      const result = getActiveDomainKey("domain-session", store)
      expect(result).toEqual(key)
    })

    test("throws when domain is not found", () => {
      const store = createDomainKeyStore([])
      expect(() =>
        getActiveDomainKey("domain-steward", store),
      ).toThrow('Domain key not found for domain: domain-steward')
    })

    test("throws when domain id does not exist", () => {
      const store = createDomainKeyStore([makeDomainKey("domain-public")])
      expect(() =>
        getActiveDomainKey("domain-missing", store),
      ).toThrow('Domain key not found for domain: domain-missing')
    })
  })

  describe("visibilityToDomainId", () => {
    test("maps session visibility to domain-session", () => {
      expect(visibilityToDomainId("session" as CodexVisibilityClass)).toBe(
        "domain-session",
      )
    })

    test("maps contributor visibility to domain-contributor", () => {
      expect(
        visibilityToDomainId("contributor" as CodexVisibilityClass),
      ).toBe("domain-contributor")
    })

    test("maps public visibility to domain-public", () => {
      expect(visibilityToDomainId("public" as CodexVisibilityClass)).toBe(
        "domain-public",
      )
    })
  })

  describe("getRequiredDomains", () => {
    test("public returns domain-public", () => {
      expect(getRequiredDomains("public" as CodexVisibilityClass)).toEqual([
        "domain-public",
      ])
    })

    test("contributor returns domain-contributor", () => {
      expect(
        getRequiredDomains("contributor" as CodexVisibilityClass),
      ).toEqual(["domain-contributor"])
    })

    test("session returns domain-session", () => {
      expect(getRequiredDomains("session" as CodexVisibilityClass)).toEqual([
        "domain-session",
      ])
    })
  })
})
