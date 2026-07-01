import { expect, describe, it } from "bun:test"
import {
  createEmptyTopologyGraph,
  addDeviceToGraph,
  addMemoryDomain,
  addTransportEdge,
  getDeviceById,
  getDomainById,
  getDevicesByClass,
  getTransportEdgesBetween,
  getAvailableTransportKinds,
  incrementTopologyGeneration,
} from "../topology-graph"
import { createDevice } from "../device-registry"
import { createMemoryDomain } from "../memory-domain"
import { createTransportEdge } from "../transport-edge"

describe("topology-graph", () => {
  it("creates an empty topology graph", () => {
    const graph = createEmptyTopologyGraph("test-host")
    expect(graph.hostInstanceId).toBe("test-host")
    expect(graph.topologyGeneration).toBe(0)
    expect(graph.devices).toEqual([])
    expect(graph.memoryDomains).toEqual([])
    expect(graph.transportEdges).toEqual([])
    expect(graph.capabilitySignatures).toEqual([])
    expect(graph.measuredBandwidthClasses.length).toBeGreaterThan(0)
    expect(graph.measuredLatencyClasses.length).toBeGreaterThan(0)
  })

  it("adds a device to the graph", () => {
    let graph = createEmptyTopologyGraph("test-host")
    const dev = createDevice("dev1", "cpu", "cpu_native", 1024)
    graph = addDeviceToGraph(graph, dev)
    expect(graph.devices).toHaveLength(1)
    expect(graph.devices[0].deviceId).toBe("dev1")
  })

  it("adds a memory domain to the graph", () => {
    let graph = createEmptyTopologyGraph("test-host")
    const dom = createMemoryDomain("dom1", "cpu_system_memory", 4096)
    graph = addMemoryDomain(graph, dom)
    expect(graph.memoryDomains).toHaveLength(1)
    expect(graph.memoryDomains[0].domainId).toBe("dom1")
  })

  it("adds a transport edge to the graph", () => {
    let graph = createEmptyTopologyGraph("test-host")
    const edge = createTransportEdge("e1", "dom_a", "dom_b", "direct_shared_access")
    graph = addTransportEdge(graph, edge)
    expect(graph.transportEdges).toHaveLength(1)
    expect(graph.transportEdges[0].edgeId).toBe("e1")
  })

  it("looks up a device by id", () => {
    let graph = createEmptyTopologyGraph("test-host")
    const dev = createDevice("find-me", "cpu", "cpu_native", 1024)
    graph = addDeviceToGraph(graph, dev)
    expect(getDeviceById(graph, "find-me")?.deviceId).toBe("find-me")
    expect(getDeviceById(graph, "nonexistent")).toBeUndefined()
  })

  it("looks up a memory domain by id", () => {
    let graph = createEmptyTopologyGraph("test-host")
    const dom = createMemoryDomain("target-dom", "apu_shared_memory", 4096)
    graph = addMemoryDomain(graph, dom)
    expect(getDomainById(graph, "target-dom")?.domainId).toBe("target-dom")
    expect(getDomainById(graph, "missing")).toBeUndefined()
  })

  it("returns devices by class", () => {
    let graph = createEmptyTopologyGraph("test-host")
    graph = addDeviceToGraph(graph, createDevice("cpu0", "cpu", "cpu_native", 1024))
    graph = addDeviceToGraph(graph, createDevice("gpu0", "discrete_gpu", "rocm", 2048))
    graph = addDeviceToGraph(graph, createDevice("gpu1", "discrete_gpu", "rocm", 2048))
    graph = addDeviceToGraph(graph, createDevice("npu0", "npu", "rocm", 512))

    const gpus = getDevicesByClass(graph, "discrete_gpu")
    expect(gpus).toHaveLength(2)
    expect(gpus.map((d) => d.deviceId)).toEqual(["gpu0", "gpu1"])

    const cpus = getDevicesByClass(graph, "cpu")
    expect(cpus).toHaveLength(1)

    const fpgas = getDevicesByClass(graph, "fpga")
    expect(fpgas).toHaveLength(0)
  })

  it("returns transport edges between two memory domains", () => {
    let graph = createEmptyTopologyGraph("test-host")
    graph = addMemoryDomain(graph, createMemoryDomain("sysmem", "cpu_system_memory", 4096))
    graph = addMemoryDomain(graph, createMemoryDomain("vram0", "discrete_gpu_vram", 8192))
    graph = addMemoryDomain(graph, createMemoryDomain("vram1", "discrete_gpu_vram", 8192))

    graph = addTransportEdge(graph, createTransportEdge("e0", "sysmem", "vram0", "pinned_host_copy"))
    graph = addTransportEdge(graph, createTransportEdge("e1", "sysmem", "vram1", "pinned_host_copy"))
    graph = addTransportEdge(graph, createTransportEdge("e2", "vram0", "vram1", "peer_device_copy"))

    const edges = getTransportEdgesBetween(graph, "sysmem", "vram0")
    expect(edges).toHaveLength(1)
    expect(edges[0].edgeId).toBe("e0")
    expect(edges[0].transportKind).toBe("pinned_host_copy")

    expect(getTransportEdgesBetween(graph, "sysmem", "vram1")).toHaveLength(1)
    expect(getTransportEdgesBetween(graph, "vram0", "vram1")).toHaveLength(1)
    expect(getTransportEdgesBetween(graph, "vram0", "sysmem")).toHaveLength(0)
  })

  it("returns available transport kinds between domains (filtering unavailable edges)", () => {
    let graph = createEmptyTopologyGraph("test-host")
    graph = addMemoryDomain(graph, createMemoryDomain("sysmem", "cpu_system_memory", 4096))
    graph = addMemoryDomain(graph, createMemoryDomain("vram0", "discrete_gpu_vram", 8192))

    const e1 = createTransportEdge("e1", "sysmem", "vram0", "pinned_host_copy")
    e1.availabilityState = "available"
    graph = addTransportEdge(graph, e1)

    const e2 = createTransportEdge("e2", "sysmem", "vram0", "dma_buf_import")
    e2.availabilityState = "unavailable"
    graph = addTransportEdge(graph, e2)

    const e3 = createTransportEdge("e3", "sysmem", "vram0", "managed_memory_migration")
    e3.availabilityState = "untested"
    graph = addTransportEdge(graph, e3)

    const available = getAvailableTransportKinds(graph, "sysmem", "vram0")
    expect(available).toEqual(["pinned_host_copy"])
    expect(available).not.toContain("dma_buf_import")
    expect(available).not.toContain("managed_memory_migration")
  })

  it("increments topology generation", () => {
    let graph = createEmptyTopologyGraph("test-host")
    expect(graph.topologyGeneration).toBe(0)
    graph = incrementTopologyGeneration(graph)
    expect(graph.topologyGeneration).toBe(1)
    graph = incrementTopologyGeneration(graph)
    expect(graph.topologyGeneration).toBe(2)
  })
})
