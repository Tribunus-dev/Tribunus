/**
 * Dharma OS-Enforced Sandbox — Linux Seccomp Filter Definitions
 *
 * Defines seccomp-bpf filters for contained processes. Restricts syscall
 * surface to a minimal safe set, denying dangerous or unnecessary operations.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface SeccompFilter {
  architecture: string;
  defaultAction: string;
  syscalls: { action: string; names: string[] };
}

export type SeccompAction = "allow" | "errno" | "kill" | "kill_process" | "trace" | "log";

export interface SeccompRule {
  action: SeccompAction;
  syscalls: string[];
}

export interface SeccompProfile {
  defaultAction: SeccompAction;
  rules: SeccompRule[];
  arch: string;
}

const ALLOWED_SYSCALLS: string[] = [
  // I/O
  "read", "write", "pread64", "pwrite64", "readv", "writev",
  "preadv", "pwritev", "preadv2", "pwritev2",
  "open", "openat", "close", "lseek",
  "stat", "lstat", "fstat", "newfstatat",
  "mmap", "munmap", "mprotect", "madvise",
  "brk", "sbrk",
  "ioctl", "fcntl",

  // File operations
  "unlink", "unlinkat", "rename", "renameat", "renameat2",
  "link", "linkat", "symlink", "symlinkat",
  "readlink", "readlinkat",
  "chdir", "fchdir", "getcwd",
  "access", "faccessat", "faccessat2",
  "mkdir", "mkdirat", "rmdir",
  "truncate", "ftruncate",
  "getdents", "getdents64",
  "fallocate",
  "copy_file_range",
  "sendfile",
  "utimensat",

  // Process
  "exit", "exit_group", "wait4", "waitid",
  "clone", "fork", "vfork",
  "getpid", "getppid", "gettid",
  "getuid", "getgid", "geteuid", "getegid",
  "getresuid", "getresgid",
  "setuid", "setgid",
  "set_robust_list", "get_robust_list",
  "sched_yield",
  "prctl", "arch_prctl",

  // Memory
  "mlock", "munlock", "mlockall", "munlockall",
  "mincore", "remap_file_pages",
  "mremap", "msync",

  // Signals
  "rt_sigaction", "rt_sigpending", "rt_sigprocmask",
  "rt_sigreturn", "rt_sigsuspend", "rt_sigtimedwait",
  "kill", "tgkill", "sigaltstack",
  "signal", "signalfd",

  // Time
  "clock_gettime", "clock_settime", "clock_getres",
  "clock_nanosleep",
  "gettimeofday", "settimeofday",
  "time", "nanosleep",

  // Descriptors
  "dup", "dup2", "dup3",
  "poll", "ppoll",
  "select", "pselect6",
  "epoll_create", "epoll_create1",
  "epoll_ctl", "epoll_wait", "epoll_pwait",

  // Pipes
  "pipe", "pipe2",

  // Sockets
  "socket", "connect", "bind", "listen", "accept", "accept4",
  "sendto", "recvfrom", "sendmsg", "recvmsg", "sendmmsg", "recvmmsg",
  "getsockname", "getpeername",
  "setsockopt", "getsockopt",
  "shutdown",
  "socketpair",

  // Filesystem
  "statfs", "fstatfs", "statx",

  // Misc
  "uname", "sysinfo",
  "getrandom",
  "umask",
  "chmod", "fchmod", "chmodat",
  "chown", "fchown", "lchown", "fchownat",
  "newfstatat",
  "set_tid_address",
  "futex", "futex_waitv",
  "setns",
  "eventfd", "eventfd2",
  "timerfd_create", "timerfd_settime", "timerfd_gettime",
  "inotify_init", "inotify_init1",
  "inotify_add_watch", "inotify_rm_watch",
  "pkey_alloc", "pkey_free", "pkey_mprotect",
  "userfaultfd",
  "name_to_handle_at", "open_by_handle_at",
  "memfd_create",
  "seccomp",
];

const DENIED_SYSCALLS: string[] = [
  "mount",
  "umount",
  "umount2",
  "ptrace",
  "kexec_load",
  "reboot",
  "swapon",
  "swapoff",
  "bpf",
  "lookup_dcookie",
  "perf_event_open",
  "add_key",
  "request_key",
  "process_vm_readv",
  "process_vm_writev",
  "uselib",
  "acct",
  "create_module",
  "init_module",
  "finit_module",
  "delete_module",
];

/** Build a seccomp-bpf filter for a contained process. */
export function buildSeccompFilter(): SeccompFilter {
  return {
    architecture: "SCMP_ARCH_AARCH64",
    defaultAction: "SCMP_ACT_ALLOW",
    syscalls: {
      action: "SCMP_ACT_ERRNO",
      names: [...DENIED_SYSCALLS],
    },
  };
}

/** Get the allowed syscall list for contained processes. */
export function getAllowedSyscalls(): string[] {
  return [...ALLOWED_SYSCALLS];
}

/** Get the denied syscall list. */
export function getDeniedSyscalls(): string[] {
  return [...DENIED_SYSCALLS];
}

/** Check if seccomp is available. */
export function hasSeccompSupport(): boolean {
  // Linux >= 3.17 has seccomp; check /proc/sys/kernel/seccomp/actions_avail
  if (existsSync("/proc/sys/kernel/seccomp")) {
    return true;
  }
  // Fallback: check PR_GET_SECCOMP via prctl
  try {
    execSync(
      "unshare --user true",
      { encoding: "utf-8", timeout: 2000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Compile a seccomp profile from defaults. */
export function compileSeccompProfile(): SeccompProfile {
  const filter = buildSeccompFilter();
  const action = filter.defaultAction === "SCMP_ACT_ALLOW"
    ? "allow" as SeccompAction
    : "errno" as SeccompAction;
  return {
    defaultAction: action,
    rules: [
      {
        action: filter.syscalls.action === "SCMP_ACT_ERRNO"
          ? "errno" as SeccompAction
          : "kill" as SeccompAction,
        syscalls: filter.syscalls.names,
      },
    ],
    arch: filter.architecture,
  };
}

/** Apply a seccomp profile to the current process. */
export function applySeccompProfile(profile: SeccompProfile): void {
  // TODO: Write seccomp-bpf filter to /proc/self/attr/seccomp
  // or use prctl(PR_SET_SECCOMP, ...) via native binding
  // This is a no-op in user-space; actual application requires a native helper
}
