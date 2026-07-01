import { expect, describe, it } from "bun:test"
import {
  createMemoryDomain,
  updateMemoryUsage,
  getAvailableBytes,
  isDomainFull,
  classifyMemoryDomain,
} from "../memory-domain"

describe("memory-domain creation", () => {
  it("creates a memory domain with default values", () => {
    const dom = createMemoryDomain("sysmem", "cpu_system_memory", 4096)
    expect(dom.domainId).toBe("sysmem")
    expect(dom.domainKind).toBe("cpu_system_memory")
    expect(dom.totalBytes).toBe(4096)
    expect(dom.usedBytes).toBe(0)
    expect(dom.reservedBytes).toBe(0)
    expect(dom.deviceIds).toEqual([])
    expect(dom.allocationGranularity).toBe(4096)
  })

  it("creates domains of all major kinds", () => {
    const dom1 = createMemoryDomain("d1", "apu_shared_memory", 1024)
    expect(dom1.domainKind).toBe("apu_shared_memory")

    const dom2 = createMemoryDomain("d2", "discrete_gpu_vram", 2048)
    expect(dom2.domainKind).toBe("discrete_gpu_vram")

    const dom3 = createMemoryDomain("d3", "pinned_host_memory", 512)
    expect(dom3.domainKind).toBe("pinned_host_memory")

    const dom4 = createMemoryDomain("d4", "managed_memory", 4096)
    expect(dom4.domainKind).toBe("managed_memory")
  })
})

describe("memory-domain usage tracking", () => {
  it("updates used bytes", () => {
    const dom = createMemoryDomain("dom", "cpu_system_memory", 1000)
    const updated = updateMemoryUsage(dom, 400)
    expect(updated.usedBytes).toBe(400)
    // Original is unchanged
    expect(dom.usedBytes).toBe(0)
  })

  it("clamps used bytes to total", () => {
    const dom = createMemoryDomain("dom", "cpu_system_memory", 1000)
    const updated = updateMemoryUsage(dom, 2000)
    expect(updated.usedBytes).toBe(1000)
  })

  it("clamps used bytes to zero", () => {
    const dom = createMemoryDomain("dom", "cpu_system_memory", 1000)
    dom.usedBytes = 500
    const updated = updateMemoryUsage(dom, -100)
    expect(updated.usedBytes).toBe(0)
  })
})

describe("memory-domain query helpers", () => {
  it("returns available bytes accounting for used + reserved", () => {
    let dom = createMemoryDomain("dom", "cpu_system_memory", 1000)
    expect(getAvailableBytes(dom)).toBe(1000)

    dom = updateMemoryUsage(dom, 300)
    dom.reservedBytes = 100
    expect(getAvailableBytes(dom)).toBe(600)
  })

  it("reports a domain as full when no bytes remain", () => {
    let dom = createMemoryDomain("dom", "cpu_system_memory", 100)
    expect(isDomainFull(dom)).toBe(false)

    dom = updateMemoryUsage(dom, 100)
    expect(isDomainFull(dom)).toBe(true)

    // over-allocated still full
    dom = updateMemoryUsage(dom, 200)
    expect(isDomainFull(dom)).toBe(true)
  })
})

describe("memory-domain classification", () => {
  it("classifies host memory domains", () => {
    expect(classifyMemoryDomain("cpu_system_memory")).toBe("host")
    expect(classifyMemoryDomain("pinned_host_memory")).toBe("host")
  })

  it("classifies shared memory domains", () => {
    expect(classifyMemoryDomain("apu_shared_memory")).toBe("shared")
    expect(classifyMemoryDomain("integrated_gpu_local_alias")).toBe("shared")
    expect(classifyMemoryDomain("npu_shared_memory")).toBe("shared")
    expect(classifyMemoryDomain("shared_memory_segment")).toBe("shared")
  })

  it("classifies device memory domains", () => {
    expect(classifyMemoryDomain("discrete_gpu_vram")).toBe("device")
    expect(classifyMemoryDomain("accelerator_device_dram")).toBe("device")
  })

  it("classifies persistent memory domains", () => {
    expect(classifyMemoryDomain("managed_memory")).toBe("persistent")
    expect(classifyMemoryDomain("durable_local_cache")).toBe("persistent")
  })
})
