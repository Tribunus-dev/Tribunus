/**
 * Dharma OS-Enforced Sandbox — Process Visibility Isolation Tests
 *
 * Verifies that contained processes cannot see or interact with host
 * processes through PID namespace isolation and seccomp filtering.
 */

import { describe, it, expect } from "bun:test";
import { LINUX_REQUIRED_NAMESPACES } from "../linux-namespaces";
import { getDeniedSyscalls } from "../linux-seccomp";

describe("process visibility isolation", () => {
  describe("pid namespace", () => {
    it('LINUX_REQUIRED_NAMESPACES includes "pid"', () => {
      expect(LINUX_REQUIRED_NAMESPACES.includes("pid")).toBe(true);
    });

    it("LINUX_REQUIRED_NAMESPACES has correct length", () => {
      // mount, pid, net, ipc, uts, user = 6 namespaces
      expect(LINUX_REQUIRED_NAMESPACES.length).toBe(6);
    });
  });

  describe("process introspection prevention via seccomp", () => {
    it("getDeniedSyscalls includes process_vm_readv", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("process_vm_readv")).toBe(true);
    });

    it("getDeniedSyscalls includes process_vm_writev", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("process_vm_writev")).toBe(true);
    });
  });

  describe("process tampering prevention", () => {
    it("getDeniedSyscalls blocks ptrace", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("ptrace")).toBe(true);
    });

    it("getDeniedSyscalls blocks perf_event_open", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("perf_event_open")).toBe(true);
    });
  });
});
