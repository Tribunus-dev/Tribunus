/**
 * Dharma OS-Enforced Sandbox — Filesystem Escape Prevention Tests
 *
 * Verifies that the Linux containment layer correctly prevents filesystem
 * escape attempts through mount namespace restrictions and seccomp filters.
 */

import { describe, it, expect } from "bun:test";
import { buildMountCommands } from "../linux-mounts";
import type { MountConfig } from "../linux-mounts";
import { getDeniedSyscalls } from "../linux-seccomp";

describe("filesystem escape prevention", () => {
  describe("mount commands", () => {
    it("buildMountCommands includes readonly bind mounts for allowed paths", () => {
      const config: MountConfig = {
        readableBindMounts: ["/usr/lib", "/usr/bin"],
        writableBindMounts: ["/tmp/work"],
        procMount: true,
        tmpfs: ["/tmp"],
      };

      const commands = buildMountCommands(config);

      expect(commands.length).toBeGreaterThan(0);

      // Check that read-only bind mounts are generated
      const roMounts = commands.filter(
        (cmd) => cmd.includes("mount --bind -o ro"),
      );
      expect(roMounts.length).toBe(2);

      // Verify the specific paths appear
      expect(roMounts.some((cmd) => cmd.includes("/usr/lib"))).toBe(true);
      expect(roMounts.some((cmd) => cmd.includes("/usr/bin"))).toBe(true);
    });

    it("buildMountCommands does not expose denied paths", () => {
      const config: MountConfig = {
        readableBindMounts: ["/usr/lib"],
        writableBindMounts: [],
        procMount: false,
        tmpfs: [],
      };

      const commands = buildMountCommands(config);

      // Sensitive paths must NOT appear in mount commands
      const deniedPaths = [
        "/etc/passwd",
        "/etc/shadow",
        "/root",
        "/home",
        "/var/db",
      ];

      for (const path of deniedPaths) {
        expect(commands.every((cmd) => !cmd.includes(path))).toBe(true);
      }
    });
  });

  describe("seccomp syscall filtering", () => {
    it("getDeniedSyscalls includes mount syscall", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("mount")).toBe(true);
    });

    it("getDeniedSyscalls includes ptrace", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("ptrace")).toBe(true);
    });

    it("getDeniedSyscalls includes umount related calls", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("umount")).toBe(true);
      expect(denied.includes("umount2")).toBe(true);
    });

    it("getDeniedSyscalls denies kernel module operations", () => {
      const denied = getDeniedSyscalls();
      expect(denied.includes("create_module")).toBe(true);
      expect(denied.includes("init_module")).toBe(true);
      expect(denied.includes("delete_module")).toBe(true);
    });
  });
});
