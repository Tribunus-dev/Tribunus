import { expect, describe, it } from "bun:test"
import {
  createTransportEdge,
  updateEdgeAvailability,
  isEdgeAvailable,
  canEdgeTransportBytes,
  classifyTransportKind,
} from "../transport-edge"

describe("transport-edge creation", () => {
  it("creates a transport edge with default settings", () => {
    const edge = createTransportEdge("e1", "src_dom", "dst_dom", "direct_shared_access")
    expect(edge.edgeId).toBe("e1")
    expect(edge.sourceDomainId).toBe("src_dom")
    expect(edge.destinationDomainId).toBe("dst_dom")
    expect(edge.transportKind).toBe("direct_shared_access")
    expect(edge.accessMode).toBe("read_write")
    expect(edge.coherencyMode).toBe("io_coherent")
    expect(edge.maximumBytes).toBe(0)
    expect(edge.availabilityState).toBe("untested")
    expect(edge.supportsAsync).toBe(false)
    expect(edge.supportsCancellation).toBe(false)
  })

  it("creates edges of different transport kinds", () => {
    const e1 = createTransportEdge("e1", "a", "b", "zero_copy_mapped_access")
    expect(e1.transportKind).toBe("zero_copy_mapped_access")

    const e2 = createTransportEdge("e2", "a", "b", "pinned_host_copy")
    expect(e2.transportKind).toBe("pinned_host_copy")

    const e3 = createTransportEdge("e3", "a", "b", "unsupported")
    expect(e3.transportKind).toBe("unsupported")
  })
})

describe("transport-edge availability", () => {
  it("starts untested by default", () => {
    const edge = createTransportEdge("e1", "a", "b", "direct_shared_access")
    expect(isEdgeAvailable(edge)).toBe(false)
  })

  it("is available when state is 'available'", () => {
    const edge = createTransportEdge("e1", "a", "b", "direct_shared_access")
    const updated = updateEdgeAvailability(edge, "available")
    expect(isEdgeAvailable(updated)).toBe(true)
  })

  it("is available when state is 'degraded'", () => {
    const edge = createTransportEdge("e1", "a", "b", "direct_shared_access")
    const updated = updateEdgeAvailability(edge, "degraded")
    expect(isEdgeAvailable(updated)).toBe(true)
  })

  it("is not available when state is 'unavailable'", () => {
    const edge = createTransportEdge("e1", "a", "b", "direct_shared_access")
    const updated = updateEdgeAvailability(edge, "unavailable")
    expect(isEdgeAvailable(updated)).toBe(false)
  })
})

describe("transport-edge byte capacity", () => {
  it("allows any bytes when maximumBytes is 0 (unlimited)", () => {
    const edge = createTransportEdge("e1", "a", "b", "direct_shared_access")
    // Default: maximumBytes = 0, state = "untested"
    const available = updateEdgeAvailability(edge, "available")
    expect(canEdgeTransportBytes(available, 10_000_000)).toBe(true)
    expect(canEdgeTransportBytes(available, 0)).toBe(true)
  })

  it("rejects bytes over maximum", () => {
    let edge = createTransportEdge("e1", "a", "b", "direct_shared_access")
    edge.maximumBytes = 1000
    edge = updateEdgeAvailability(edge, "available")
    expect(canEdgeTransportBytes(edge, 500)).toBe(true)
    expect(canEdgeTransportBytes(edge, 1000)).toBe(true)
    expect(canEdgeTransportBytes(edge, 1001)).toBe(false)
  })

  it("rejects transport on unavailable edges", () => {
    let edge = createTransportEdge("e1", "a", "b", "direct_shared_access")
    edge.maximumBytes = 10_000
    // untested
    expect(canEdgeTransportBytes(edge, 100)).toBe(false)
    // unavailable
    edge = updateEdgeAvailability(edge, "unavailable")
    expect(canEdgeTransportBytes(edge, 100)).toBe(false)
  })
})

describe("transport-edge classification", () => {
  it("classifies shared transport kinds", () => {
    expect(classifyTransportKind("direct_shared_access")).toBe("shared")
    expect(classifyTransportKind("zero_copy_mapped_access")).toBe("shared")
  })

  it("classifies copy transport kinds", () => {
    expect(classifyTransportKind("managed_memory_migration")).toBe("copy")
    expect(classifyTransportKind("pinned_host_copy")).toBe("copy")
    expect(classifyTransportKind("backend_device_copy")).toBe("copy")
    expect(classifyTransportKind("peer_device_copy")).toBe("copy")
    expect(classifyTransportKind("local_host_shared_memory_copy")).toBe("copy")
    expect(classifyTransportKind("serialized_payload_copy")).toBe("copy")
  })

  it("classifies import transport kind", () => {
    expect(classifyTransportKind("dma_buf_import")).toBe("import")
  })

  it("classifies unsupported transport kind", () => {
    expect(classifyTransportKind("unsupported")).toBe("unsupported")
  })
})
