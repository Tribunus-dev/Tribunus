/**
 * Dharma Fabric Policy — Unit Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createDefaultDharmaFabricPolicy,
  createRestrictiveDharmaFabricPolicy,
  isDeviceClassAllowed,
  isOffloadPermitted,
  isTransportWithinPolicy,
  isNpuAllowed,
} from "../dharma-fabric-policy"

// ── Policy Factories ────────────────────────────────────────────────────────

describe("createDefaultDharmaFabricPolicy", () => {
  test("allows all device classes", () => {
    const policy = createDefaultDharmaFabricPolicy()
    expect(policy.allowedDeviceClasses).toContain("cpu")
    expect(policy.allowedDeviceClasses).toContain("discrete_gpu")
    expect(policy.allowedDeviceClasses).toContain("npu")
    expect(policy.allowedDeviceClasses).toContain("integrated_gpu")
    expect(policy.allowedDeviceClasses).toContain("accelerator")
    expect(policy.forbiddenDeviceClasses).toEqual([])
  })

  test("allows all transport mechanisms by default", () => {
    const policy = createDefaultDharmaFabricPolicy()
    expect(policy.allowApuSharedMemory).toBe(true)
    expect(policy.allowDgpuOffload).toBe(true)
    expect(policy.allowManagedMemoryMigration).toBe(true)
    expect(policy.allowDmaBufImport).toBe(true)
    expect(policy.allowLocalHostKvTransport).toBe(true)
    expect(policy.allowNpuSubgraphs).toBe(true)
  })

  test("sets 1 GiB max transfer and 30 s max duration", () => {
    const policy = createDefaultDharmaFabricPolicy()
    expect(policy.maximumTransferBytes).toBe(1_073_741_824)
    expect(policy.maximumTransferDurationMs).toBe(30_000)
  })
})

describe("createRestrictiveDharmaFabricPolicy", () => {
  test("only allows cpu and integrated_gpu", () => {
    const policy = createRestrictiveDharmaFabricPolicy()
    expect(policy.allowedDeviceClasses).toEqual(["cpu", "integrated_gpu"])
    expect(policy.forbiddenDeviceClasses).toContain("discrete_gpu")
    expect(policy.forbiddenDeviceClasses).toContain("npu")
    expect(policy.forbiddenDeviceClasses).toContain("accelerator")
  })

  test("disables dgpu offload, npu, managed memory, dma-buf", () => {
    const policy = createRestrictiveDharmaFabricPolicy()
    expect(policy.allowDgpuOffload).toBe(false)
    expect(policy.allowManagedMemoryMigration).toBe(false)
    expect(policy.allowDmaBufImport).toBe(false)
    expect(policy.allowNpuSubgraphs).toBe(false)
    expect(policy.allowLocalHostKvTransport).toBe(true)
  })

  test("sets 256 MiB max transfer and 10 s max duration", () => {
    const policy = createRestrictiveDharmaFabricPolicy()
    expect(policy.maximumTransferBytes).toBe(268_435_456)
    expect(policy.maximumTransferDurationMs).toBe(10_000)
  })

  test("enforces same-host authority", () => {
    const policy = createRestrictiveDharmaFabricPolicy()
    expect(policy.requireSameHostAuthorityDomain).toBe(true)
  })
})

// ── isDeviceClassAllowed ───────────────────────────────────────────────────

describe("isDeviceClassAllowed", () => {
  test("allows cpu under default policy", () => {
    expect(isDeviceClassAllowed(createDefaultDharmaFabricPolicy(), "cpu")).toBe(true)
  })

  test("allows discrete_gpu under default policy", () => {
    expect(isDeviceClassAllowed(createDefaultDharmaFabricPolicy(), "discrete_gpu")).toBe(true)
  })

  test("rejects discrete_gpu under restrictive policy", () => {
    expect(isDeviceClassAllowed(createRestrictiveDharmaFabricPolicy(), "discrete_gpu")).toBe(false)
  })

  test("rejects npu under restrictive policy", () => {
    expect(isDeviceClassAllowed(createRestrictiveDharmaFabricPolicy(), "npu")).toBe(false)
  })

  test("allows cpu under restrictive policy", () => {
    expect(isDeviceClassAllowed(createRestrictiveDharmaFabricPolicy(), "cpu")).toBe(true)
  })

  test("allows integrated_gpu under restrictive policy", () => {
    expect(isDeviceClassAllowed(createRestrictiveDharmaFabricPolicy(), "integrated_gpu")).toBe(true)
  })
})

// ── isOffloadPermitted ─────────────────────────────────────────────────────

describe("isOffloadPermitted", () => {
  test("permits dgpu offload under default policy", () => {
    expect(isOffloadPermitted(createDefaultDharmaFabricPolicy(), "discrete_gpu")).toBe(true)
  })

  test("forbids dgpu offload under restrictive policy", () => {
    expect(isOffloadPermitted(createRestrictiveDharmaFabricPolicy(), "discrete_gpu")).toBe(false)
  })

  test("forbids offload to a forbidden class", () => {
    expect(isOffloadPermitted(createRestrictiveDharmaFabricPolicy(), "npu")).toBe(false)
  })

  test("permits offload to integrated_gpu under restrictive policy", () => {
    expect(isOffloadPermitted(createRestrictiveDharmaFabricPolicy(), "integrated_gpu")).toBe(true)
  })
})

// ── isTransportWithinPolicy ────────────────────────────────────────────────

describe("isTransportWithinPolicy", () => {
  test("direct_shared_access under default within byte limit", () => {
    expect(
      isTransportWithinPolicy(createDefaultDharmaFabricPolicy(), "direct_shared_access", 1_000_000),
    ).toBe(true)
  })

  test("rejects transfer exceeding max bytes under default", () => {
    expect(
      isTransportWithinPolicy(
        createDefaultDharmaFabricPolicy(),
        "direct_shared_access",
        2_000_000_000,
      ),
    ).toBe(false)
  })

  test("rejects managed_memory_migration under restrictive policy", () => {
    expect(
      isTransportWithinPolicy(createRestrictiveDharmaFabricPolicy(), "managed_memory_migration", 100),
    ).toBe(false)
  })

  test("rejects dma_buf_import under restrictive policy", () => {
    expect(
      isTransportWithinPolicy(createRestrictiveDharmaFabricPolicy(), "dma_buf_import", 100),
    ).toBe(false)
  })

  test("allows local_host_shared_memory_copy under restrictive policy", () => {
    expect(
      isTransportWithinPolicy(
        createRestrictiveDharmaFabricPolicy(),
        "local_host_shared_memory_copy",
        100,
      ),
    ).toBe(true)
  })

  test("rejects managed_memory_migration under default with byte overflow", () => {
    expect(
      isTransportWithinPolicy(
        createDefaultDharmaFabricPolicy(),
        "managed_memory_migration",
        2_000_000_000,
      ),
    ).toBe(false)
  })

  test("allows local host transport under default", () => {
    expect(
      isTransportWithinPolicy(
        createDefaultDharmaFabricPolicy(),
        "local_host_shared_memory_copy",
        1_000_000,
      ),
    ).toBe(true)
  })
})

// ── isNpuAllowed ───────────────────────────────────────────────────────────

describe("isNpuAllowed", () => {
  test("allows NPU under default policy", () => {
    expect(isNpuAllowed(createDefaultDharmaFabricPolicy())).toBe(true)
  })

  test("forbids NPU under restrictive policy", () => {
    expect(isNpuAllowed(createRestrictiveDharmaFabricPolicy())).toBe(false)
  })
})
