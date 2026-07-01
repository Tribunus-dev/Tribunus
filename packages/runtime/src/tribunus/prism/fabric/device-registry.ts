/**
 * Prism Heterogeneous Memory Fabric — Device Registry
 *
 * Pure functions for compute device lifecycle and capability matching.
 */

import {
  type PrismComputeDevice,
  type PrismDeviceClass,
  type BackendKind,
  type DeviceHealthState,
  type WorkloadClass,
} from "./fabric-types"

/**
 * Create a compute device with the given identity and capacity.
 * Initial health is "healthy" with no reserved memory.
 */
export function createDevice(
  id: string,
  cls: PrismDeviceClass,
  backend: BackendKind,
  memBytes: number,
): PrismComputeDevice {
  return {
    deviceId: id,
    deviceClass: cls,
    backendKind: backend,
    targetCapabilitySignature: `${cls}:${backend}`,
    memoryDomainIds: [],
    computeCapabilities: [],
    supportedWorkloads: [],
    availableMemoryBytes: memBytes,
    reservedMemoryBytes: 0,
    healthState: "healthy",
  }
}

/**
 * Set a device's health state. Returns a new device reference.
 */
export function setDeviceHealth(
  device: PrismComputeDevice,
  health: DeviceHealthState,
): PrismComputeDevice {
  return { ...device, healthState: health }
}

/**
 * Check whether a device is healthy enough to accept work.
 */
export function isDeviceHealthy(device: PrismComputeDevice): boolean {
  return device.healthState === "healthy" || device.healthState === "degraded"
}

/**
 * Check whether a device can run a given workload class.
 * A device with no explicit supportedWorkloads is treated as capable of any workload.
 */
export function canDeviceRunWorkload(
  device: PrismComputeDevice,
  workload: WorkloadClass,
): boolean {
  if (!isDeviceHealthy(device)) {
    return false
  }
  if (device.supportedWorkloads.length === 0) {
    return true
  }
  return device.supportedWorkloads.includes(workload)
}

/**
 * Compute a device's effective compute capacity as its available memory.
 * Used as a simple heuristic for placement decisions.
 */
export function getDeviceComputeCapacity(device: PrismComputeDevice): number {
  return device.availableMemoryBytes - device.reservedMemoryBytes
}
