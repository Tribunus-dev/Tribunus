/**
 * Dharma OS-Enforced Sandbox — Resource Limits Tests
 *
 * Verifies that resource limit enforcement via cgroups v2 configuration
 * and namespace flags is correctly constructed.
 */

import { describe, it, expect } from "bun:test";
import { buildCgroupConfig, hasCgroupsV2, getCgroupPath } from "../linux-cgroups";
import { getNamespaceFlags } from "../linux-namespaces";

describe("resource limits", () => {
  describe("cgroup config", () => {
    it("buildCgroupConfig creates config with memory limit", () => {
      const config = buildCgroupConfig(512 * 1024 * 1024, 16);
      expect(config.memoryMaxBytes).toBe(512 * 1024 * 1024);
    });

    it("buildCgroupConfig creates config with PID limit", () => {
      const config = buildCgroupConfig(0, 32);
      expect(config.pidsMax).toBe(32);
    });

    it("buildCgroupConfig creates config with zero memory limit when not set", () => {
      const config = buildCgroupConfig(0, 16);
      expect(config.memoryMaxBytes).toBe(0);
    });

    it("buildCgroupConfig creates config with cpuMax string", () => {
      const config = buildCgroupConfig(512 * 1024 * 1024, 16);
      expect(typeof config.cpuMax).toBe("string");
      expect(config.cpuMax.length).toBeGreaterThan(0);
      // Format: "quota period"
      const parts = config.cpuMax.split(" ");
      expect(parts.length).toBe(2);
      expect(Number.isFinite(Number(parts[0]))).toBe(true);
      expect(Number.isFinite(Number(parts[1]))).toBe(true);
    });

    it("buildCgroupConfig creates config with ioMax string", () => {
      const config = buildCgroupConfig(512 * 1024 * 1024, 16);
      expect(typeof config.ioMax).toBe("string");
      expect(config.ioMax.length).toBeGreaterThan(0);
    });
  });

  describe("cgroup detection", () => {
    it("hasCgroupsV2 returns a boolean", () => {
      const result = hasCgroupsV2();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("cgroup path", () => {
    it("getCgroupPath returns non-empty string", () => {
      const path = getCgroupPath();
      expect(typeof path).toBe("string");
      expect(path.length).toBeGreaterThan(0);
    });

    it("getCgroupPath returns /sys/fs/cgroup by default", () => {
      const path = getCgroupPath();
      expect(path).toBe("/sys/fs/cgroup");
    });
  });

  describe("namespace flags", () => {
    it("getNamespaceFlags returns non-zero number", () => {
      const flags = getNamespaceFlags();
      expect(typeof flags).toBe("number");
      expect(flags).not.toBe(0);
    });

    it("getNamespaceFlags includes mount namespace flag", () => {
      const flags = getNamespaceFlags();
      // CLONE_NEWNS = 0x00020000
      expect((flags & 0x00020000) !== 0).toBe(true);
    });

    it("getNamespaceFlags includes PID namespace flag", () => {
      const flags = getNamespaceFlags();
      // CLONE_NEWPID = 0x20000000
      expect((flags & 0x20000000) !== 0).toBe(true);
    });

    it("getNamespaceFlags includes network namespace flag", () => {
      const flags = getNamespaceFlags();
      // CLONE_NEWNET = 0x40000000
      expect((flags & 0x40000000) !== 0).toBe(true);
    });

    it("getNamespaceFlags includes user namespace flag", () => {
      const flags = getNamespaceFlags();
      // CLONE_NEWUSER = 0x10000000
      expect((flags & 0x10000000) !== 0).toBe(true);
    });
  });
});
