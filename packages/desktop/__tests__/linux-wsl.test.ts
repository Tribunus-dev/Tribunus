import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { detectWayland, detectWSL2, getWslGpuPaths } from '../src/main/linux-wsl'

describe('linux-wsl', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    // Clear relevant env vars for testing
    delete process.env.WAYLAND_DISPLAY
    delete process.env.XDG_SESSION_TYPE
    delete process.env.WSL_INTEROP
    delete process.env.WSL_DISTRO_NAME
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('detectWayland', () => {
    it('returns true when WAYLAND_DISPLAY is set', () => {
      process.env.WAYLAND_DISPLAY = 'wayland-0'
      expect(detectWayland()).toBe(true)
    })

    it('returns true when XDG_SESSION_TYPE is wayland', () => {
      process.env.XDG_SESSION_TYPE = 'wayland'
      expect(detectWayland()).toBe(true)
    })

    it('returns false when neither is set', () => {
      expect(detectWayland()).toBe(false)
    })
  })

  describe('detectWSL2', () => {
    it('returns true when both WSL_INTEROP and WSL_DISTRO_NAME are set', () => {
      process.env.WSL_INTEROP = '/run/WSL/1234_interop'
      process.env.WSL_DISTRO_NAME = 'Ubuntu'
      expect(detectWSL2()).toBe(true)
    })

    it('returns false when only WSL_DISTRO_NAME is set', () => {
      process.env.WSL_DISTRO_NAME = 'Ubuntu'
      expect(detectWSL2()).toBe(false)
    })

    it('returns false when neither is set', () => {
      expect(detectWSL2()).toBe(false)
    })
  })

  describe('getWslGpuPaths', () => {
    it('returns empty array when not in WSL2', () => {
      expect(getWslGpuPaths()).toEqual([])
    })

    it('returns GPU paths when in WSL2', () => {
      process.env.WSL_INTEROP = '/run/WSL/1234_interop'
      process.env.WSL_DISTRO_NAME = 'Ubuntu'
      expect(getWslGpuPaths()).toEqual(['/usr/lib/wsl/lib'])
    })
  })
})
