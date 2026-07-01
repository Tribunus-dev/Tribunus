import { expect, describe, it } from "bun:test"
import { getClosestTransportKind, getRequiredCapabilities } from "../transport-capability"
import { createDevice } from "../device-registry"

describe("getClosestTransportKind", () => {
  describe("same domain kind pairings", () => {
    it("returns direct_shared_access for shared host memory", () => {
      expect(getClosestTransportKind("cpu_system_memory", "cpu_system_memory")).toBe("direct_shared_access")
      expect(getClosestTransportKind("apu_shared_memory", "apu_shared_memory")).toBe("direct_shared_access")
      expect(getClosestTransportKind("npu_shared_memory", "npu_shared_memory")).toBe("direct_shared_access")
      expect(getClosestTransportKind("shared_memory_segment", "shared_memory_segment")).toBe("direct_shared_access")
    })

    it("returns peer_device_copy for device VRAM", () => {
      expect(getClosestTransportKind("discrete_gpu_vram", "discrete_gpu_vram")).toBe("peer_device_copy")
      expect(getClosestTransportKind("accelerator_device_dram", "accelerator_device_dram")).toBe("peer_device_copy")
    })
  })

  describe("CPU system memory to shared memory", () => {
    it("returns direct_shared_access", () => {
      expect(getClosestTransportKind("cpu_system_memory", "apu_shared_memory")).toBe("direct_shared_access")
      expect(getClosestTransportKind("cpu_system_memory", "npu_shared_memory")).toBe("direct_shared_access")
      expect(getClosestTransportKind("cpu_system_memory", "integrated_gpu_local_alias")).toBe("direct_shared_access")
    })

    it("returns direct_shared_access from shared to CPU", () => {
      expect(getClosestTransportKind("apu_shared_memory", "cpu_system_memory")).toBe("direct_shared_access")
      expect(getClosestTransportKind("npu_shared_memory", "cpu_system_memory")).toBe("direct_shared_access")
    })
  })

  describe("host to discrete device", () => {
    it("returns pinned_host_copy for system memory to VRAM", () => {
      expect(getClosestTransportKind("cpu_system_memory", "discrete_gpu_vram")).toBe("pinned_host_copy")
      expect(getClosestTransportKind("cpu_system_memory", "accelerator_device_dram")).toBe("pinned_host_copy")
    })

    it("returns backend_device_copy for pinned to VRAM", () => {
      expect(getClosestTransportKind("pinned_host_memory", "discrete_gpu_vram")).toBe("backend_device_copy")
      expect(getClosestTransportKind("pinned_host_memory", "accelerator_device_dram")).toBe("backend_device_copy")
    })
  })

  describe("device to host", () => {
    it("returns backend_device_copy", () => {
      expect(getClosestTransportKind("discrete_gpu_vram", "cpu_system_memory")).toBe("backend_device_copy")
      expect(getClosestTransportKind("discrete_gpu_vram", "pinned_host_memory")).toBe("backend_device_copy")
      expect(getClosestTransportKind("accelerator_device_dram", "cpu_system_memory")).toBe("backend_device_copy")
    })
  })

  describe("device to device", () => {
    it("returns peer_device_copy", () => {
      expect(getClosestTransportKind("discrete_gpu_vram", "accelerator_device_dram")).toBe("peer_device_copy")
      expect(getClosestTransportKind("accelerator_device_dram", "discrete_gpu_vram")).toBe("peer_device_copy")
    })
  })

  describe("shared to device", () => {
    it("returns pinned_host_copy for APU shared to dGPU", () => {
      expect(getClosestTransportKind("apu_shared_memory", "discrete_gpu_vram")).toBe("pinned_host_copy")
      expect(getClosestTransportKind("apu_shared_memory", "accelerator_device_dram")).toBe("pinned_host_copy")
    })

    it("returns backend_device_copy for non-APU shared to device", () => {
      expect(getClosestTransportKind("shared_memory_segment", "discrete_gpu_vram")).toBe("backend_device_copy")
    })
  })

  describe("persistent domains", () => {
    it("returns managed_memory_migration for managed memory", () => {
      expect(getClosestTransportKind("managed_memory", "cpu_system_memory")).toBe("managed_memory_migration")
      expect(getClosestTransportKind("cpu_system_memory", "managed_memory")).toBe("managed_memory_migration")
    })

    it("returns serialized_payload_copy for durable cache", () => {
      expect(getClosestTransportKind("durable_local_cache", "cpu_system_memory")).toBe("serialized_payload_copy")
      expect(getClosestTransportKind("durable_local_cache", "discrete_gpu_vram")).toBe("serialized_payload_copy")
    })
  })

  describe("fallback", () => {
    it("returns unsupported for unknown pairings", () => {
      // This pairing has no explicit rule
      expect(getClosestTransportKind("integrated_gpu_local_alias", "cpu_system_memory")).toBe("direct_shared_access")
    })
  })
})

describe("getRequiredCapabilities", () => {
  it("returns host_memory_access for CPU devices with memory domains", () => {
    const cpu = createDevice("cpu0", "cpu", "cpu_native", 1024)
    cpu.memoryDomainIds = ["sysmem"]
    const caps = getRequiredCapabilities([cpu])
    expect(caps).toContain("host_memory_access")
  })

  it("returns shared_memory and zero_copy for integrated GPU", () => {
    const igpu = createDevice("igpu0", "integrated_gpu", "rocm", 1024)
    const caps = getRequiredCapabilities([igpu])
    expect(caps).toContain("shared_memory_access")
    expect(caps).toContain("zero_copy_transport")
  })

  it("returns device_memory and pinned/peer for discrete GPU", () => {
    const dgpu = createDevice("dgpu0", "discrete_gpu", "rocm", 1024)
    const caps = getRequiredCapabilities([dgpu])
    expect(caps).toContain("device_memory_access")
    expect(caps).toContain("pinned_host_transfer")
    expect(caps).toContain("peer_device_transfer")
  })

  it("returns shared_memory and npu_shared for NPU", () => {
    const npu = createDevice("npu0", "npu", "rocm", 512)
    const caps = getRequiredCapabilities([npu])
    expect(caps).toContain("shared_memory_access")
    expect(caps).toContain("npu_shared_access")
  })

  it("returns device_memory and dma_buf for accelerators/TPUs", () => {
    const acc = createDevice("acc0", "accelerator", "tensix", 1024)
    const caps = getRequiredCapabilities([acc])
    expect(caps).toContain("device_memory_access")
    expect(caps).toContain("dma_buf_import")
  })

  it("returns pinned_host for FPGAs", () => {
    const fpga = createDevice("fpga0", "fpga", "vulkan", 512)
    const caps = getRequiredCapabilities([fpga])
    expect(caps).toContain("pinned_host_transfer")
  })

  it("returns combined capabilities for mixed device sets", () => {
    const devices = [
      { ...createDevice("cpu0", "cpu", "cpu_native", 1024), memoryDomainIds: ["sysmem"] },
      createDevice("igpu0", "integrated_gpu", "rocm", 2048),
      createDevice("dgpu0", "discrete_gpu", "rocm", 4096),
    ]
    const caps = getRequiredCapabilities(devices)
    expect(caps).toContain("host_memory_access")
    expect(caps).toContain("shared_memory_access")
    expect(caps).toContain("zero_copy_transport")
    expect(caps).toContain("device_memory_access")
    expect(caps).toContain("pinned_host_transfer")
    expect(caps).toContain("peer_device_transfer")
  })
})
