import { describe, expect, test, beforeEach } from "bun:test"
import { ACTIONS, fetchDiagnostics, executeSafeModeAction, handleRetryNormalStartup } from "../safe-mode-logic"
import { createElectronMock } from "../../test-utils/electron-mock"

describe("safe-mode-logic", () => {
  let electronMock: ReturnType<typeof createElectronMock>
  let mockGetSafeModeDiagnostics: any
  let mockSafeModeAction: any

  beforeEach(() => {
    electronMock = createElectronMock()
    
    // safe-mode-logic relies directly on window.api which bridges to these electron functions normally.
    // In our test environment, window.api is exposed by the preload bridge, but we can mock it here
    // using the electron mock utilities pattern if we desire, or just map the IPC calls.
    // However, since window.api is the direct consumer for the logic functions, we will populate
    // window.api using mock functions directly on the global object for testing just like the preload does.
    if (typeof globalThis.window === "undefined") {
      ;(globalThis as any).window = {}
    }

    // Use bun:test mock functions to verify logic
    const { mock } = require("bun:test")
    mockGetSafeModeDiagnostics = mock(() => Promise.resolve({
      error: { message: "Test diagnostic error", component: "Test Component" },
      systemInfo: { platform: "darwin", arch: "arm64", version: "1.0", userDataPath: "/tmp", logPath: "/tmp" }
    }))
    mockSafeModeAction = mock(() => Promise.resolve())

    ;(globalThis.window as any).api = {
      getSafeModeDiagnostics: mockGetSafeModeDiagnostics,
      safeModeAction: mockSafeModeAction,
    }
  })

  test("ACTIONS array contains expected safe mode actions", () => {
    expect(ACTIONS.length).toBeGreaterThan(0)
    expect(ACTIONS.some(a => a.action === "export_debug_logs")).toBe(true)
    expect(ACTIONS.some(a => a.action === "repair_database")).toBe(true)
    expect(ACTIONS.some(a => a.action === "disable_plugins")).toBe(true)
  })

  test("fetchDiagnostics calls window.api.getSafeModeDiagnostics and returns data", async () => {
    const result = await fetchDiagnostics()
    expect(mockGetSafeModeDiagnostics).toHaveBeenCalled()
    expect(result).toBeDefined()
    expect(result?.error.message).toBe("Test diagnostic error")
    expect(result?.error.component).toBe("Test Component")
  })

  test("fetchDiagnostics handles errors gracefully", async () => {
    mockGetSafeModeDiagnostics.mockImplementation(() => Promise.reject(new Error("Failed")))
    const result = await fetchDiagnostics()
    expect(mockGetSafeModeDiagnostics).toHaveBeenCalled()
    expect(result).toBeNull()
  })

  test("executeSafeModeAction calls window.api.safeModeAction with specified action", async () => {
    await executeSafeModeAction("export_debug_logs")
    expect(mockSafeModeAction).toHaveBeenCalledWith("export_debug_logs")
  })

  test("executeSafeModeAction handles errors gracefully", async () => {
    mockSafeModeAction.mockImplementation(() => Promise.reject(new Error("Failed")))
    // Should not throw
    await executeSafeModeAction("repair_database")
    expect(mockSafeModeAction).toHaveBeenCalledWith("repair_database")
  })

  test("handleRetryNormalStartup calls window.api.safeModeAction with retry_normal_startup", async () => {
    await handleRetryNormalStartup()
    expect(mockSafeModeAction).toHaveBeenCalledWith("retry_normal_startup")
  })

  test("handleRetryNormalStartup handles errors gracefully", async () => {
    mockSafeModeAction.mockImplementation(() => Promise.reject(new Error("Failed")))
    // Should not throw
    await handleRetryNormalStartup()
    expect(mockSafeModeAction).toHaveBeenCalledWith("retry_normal_startup")
  })
})
