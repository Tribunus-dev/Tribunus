/**
 * Dharma OS-Enforced Sandbox — IPC Isolation Tests
 *
 * Verifies that contained processes cannot communicate with host processes
 * through IPC namespaces and seccomp filtering.
 */

import { describe, it, expect } from "bun:test";
import { LINUX_REQUIRED_NAMESPACES } from "../linux-namespaces";
import { buildSeccompFilter, getDeniedSyscalls } from "../linux-seccomp";

describe("ipc isolation", () => {
  describe("ipc namespace", () => {
    it('LINUX_REQUIRED_NAMESPACES includes "ipc"', () => {
      expect(LINUX_REQUIRED_NAMESPACES.includes("ipc")).toBe(true);
    });
  });

  describe("seccomp filter structure", () => {
    it("buildSeccompFilter returns filter with architecture", () => {
      const filter = buildSeccompFilter();
      expect(filter.architecture).toBeDefined();
      expect(filter.architecture.length).toBeGreaterThan(0);
    });

    it("buildSeccompFilter has defaultAction set to allow or deny", () => {
      const filter = buildSeccompFilter();
      const action = filter.defaultAction;
      expect(
        action === "SCMP_ACT_ALLOW" || action === "SCMP_ACT_ERRNO" ||
        action === "SCMP_ACT_KILL" || action === "SCMP_ACT_KILL_PROCESS",
      ).toBe(true);
    });

    it("buildSeccompFilter syscalls have action defined", () => {
      const filter = buildSeccompFilter();
      expect(filter.syscalls.action).toBeDefined();
      expect(filter.syscalls.action.length).toBeGreaterThan(0);
    });

    it("buildSeccompFilter syscalls names is a non-empty array", () => {
      const filter = buildSeccompFilter();
      expect(filter.syscalls.names.length).toBeGreaterThan(0);
    });
  });

  describe("keyring operation blocks", () => {
    it("getDeniedSyscalls blocks keyring operations", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("add_key")).toBe(true);
      expect(denied.includes("request_key")).toBe(true);
    });
  });

  describe("ipc-related syscall filtering", () => {
    it("getDeniedSyscalls blocks kernel module ops (indirect IPC bypass)", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("create_module")).toBe(true);
      expect(denied.includes("init_module")).toBe(true);
    });
  });
});
