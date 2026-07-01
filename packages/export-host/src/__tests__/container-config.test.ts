/**
 * Container Config Tests
 *
 * Phase 3 — Hardened Export Environment
 */

import { describe, test, expect } from "bun:test"
import {
  createHardenedConfig,
  verifyContainerConfig,
  getContainerRuntimeArgs,
} from "../container-config"
import type { ContainerConfig } from "../container-config"

describe("createHardenedConfig", () => {
  test("returns a config with correct defaults", () => {
    const config = createHardenedConfig()

    expect(config).toBeDefined()
    expect(config.memoryLimitMb).toBe(256)
    expect(config.cpuLimit).toBe(1)
    expect(config.timeLimitMs).toBe(60_000)
    expect(config.readOnlyRoot).toBe(true)
    expect(config.networkAccess).toBe("unix_socket_only")
    expect(config.capabilities).toEqual([])
    expect(config.seccompProfile).toBe("default")
    expect(config.appArmorProfile).toBe("unconfined")
  })

  test("returns a new object on each call (no shared mutation)", () => {
    const a = createHardenedConfig()
    const b = createHardenedConfig()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

describe("verifyContainerConfig", () => {
  test("passes for valid hardened default config", () => {
    expect(verifyContainerConfig(createHardenedConfig())).toBe(true)
  })

  test("passes for custom valid config", () => {
    const config: ContainerConfig = {
      memoryLimitMb: 512,
      cpuLimit: 2,
      timeLimitMs: 120_000,
      readOnlyRoot: true,
      networkAccess: "none",
      capabilities: [],
      seccompProfile: "default",
      appArmorProfile: "unconfined",
    }
    expect(verifyContainerConfig(config)).toBe(true)
  })

  test("rejects null config", () => {
    expect(verifyContainerConfig(null as unknown as ContainerConfig)).toBe(false)
  })

  test("rejects undefined config", () => {
    expect(verifyContainerConfig(undefined as unknown as ContainerConfig)).toBe(false)
  })

  test("rejects negative memoryLimitMb", () => {
    const config = createHardenedConfig()
    config.memoryLimitMb = -1
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects zero memoryLimitMb (must be non-negative; zero is valid as 'unlimited')", () => {
    const config = createHardenedConfig()
    config.memoryLimitMb = 0
    expect(verifyContainerConfig(config)).toBe(true)
  })

  test("rejects non-numeric memoryLimitMb", () => {
    const config = createHardenedConfig()
    config.memoryLimitMb = NaN
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects zero cpuLimit", () => {
    const config = createHardenedConfig()
    config.cpuLimit = 0
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects negative cpuLimit", () => {
    const config = createHardenedConfig()
    config.cpuLimit = -0.5
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects zero timeLimitMs", () => {
    const config = createHardenedConfig()
    config.timeLimitMs = 0
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects non-boolean readOnlyRoot", () => {
    const config = createHardenedConfig()
    config.readOnlyRoot = "yes" as unknown as boolean
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects invalid networkAccess", () => {
    const config = createHardenedConfig()
    config.networkAccess = "full" as "none" | "unix_socket_only"
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("accepts networkAccess 'none'", () => {
    const config = createHardenedConfig()
    config.networkAccess = "none"
    expect(verifyContainerConfig(config)).toBe(true)
  })

  test("rejects non-array capabilities", () => {
    const config = createHardenedConfig()
    config.capabilities = "ALL" as unknown as string[]
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects empty seccompProfile", () => {
    const config = createHardenedConfig()
    config.seccompProfile = ""
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects non-string seccompProfile", () => {
    const config = createHardenedConfig()
    config.seccompProfile = 42 as unknown as string
    expect(verifyContainerConfig(config)).toBe(false)
  })

  test("rejects empty appArmorProfile", () => {
    const config = createHardenedConfig()
    config.appArmorProfile = ""
    expect(verifyContainerConfig(config)).toBe(false)
  })
})

describe("getContainerRuntimeArgs", () => {
  test("produces correct default args", () => {
    const args = getContainerRuntimeArgs(createHardenedConfig())

    expect(args).toContain("--memory")
    expect(args).toContain("256m")
    expect(args).toContain("--memory-reservation")
    expect(args).toContain("192m")
    expect(args).toContain("--cpus")
    expect(args).toContain("1")
    expect(args).toContain("--read-only")
    expect(args).toContain("--network")
    expect(args).toContain("none")
    expect(args).toContain("--cap-drop")
    expect(args).toContain("ALL")
    expect(args).toContain("--security-opt")
    expect(args).toContain("no-new-privileges")
  })

  test("does not include --cap-add when capabilities are empty", () => {
    const args = getContainerRuntimeArgs(createHardenedConfig())
    expect(args).not.toContain("--cap-add")
  })

  test("includes cap-add for custom capabilities", () => {
    const config = createHardenedConfig()
    config.capabilities = ["NET_BIND_SERVICE"]
    const args = getContainerRuntimeArgs(config)
    expect(args).toContain("--cap-add")
    expect(args).toContain("NET_BIND_SERVICE")
  })

  test("includes custom seccomp path when not default", () => {
    const config = createHardenedConfig()
    config.seccompProfile = "/etc/seccomp/export-host.json"
    const args = getContainerRuntimeArgs(config)
    expect(args).toContain("seccomp=/etc/seccomp/export-host.json")
  })

  test("omits seccomp flag when default", () => {
    const args = getContainerRuntimeArgs(createHardenedConfig())
    expect(args.filter(a => a.startsWith("seccomp="))).toHaveLength(0)
  })

  test("includes apparmor when not unconfined", () => {
    const config = createHardenedConfig()
    config.appArmorProfile = "docker-export-host"
    const args = getContainerRuntimeArgs(config)
    expect(args).toContain("apparmor=docker-export-host")
  })

  test("omits apparmor flag when unconfined", () => {
    const args = getContainerRuntimeArgs(createHardenedConfig())
    expect(args.filter(a => a.startsWith("apparmor="))).toHaveLength(0)
  })
})
