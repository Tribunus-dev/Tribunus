import { describe, expect, test, beforeEach } from "bun:test"
import { createElectronMock, createMockIpcMainInvokeEvent, createMockIpcMainEvent } from "../electron-mock"

describe("electron-mock", () => {
  let mockElectron: ReturnType<typeof createElectronMock>

  beforeEach(() => {
    mockElectron = createElectronMock()
  })

  test("mockIpcMain.handle registers and invokes correctly", async () => {
    const { ipcMain } = mockElectron
    const handler = async (event: any, data: string) => {
      return { ok: true, value: `handled: ${data}` }
    }

    ipcMain.handle("test-channel", handler)

    // Ensure handler is registered
    expect(ipcMain._handlers.has("test-channel")).toBe(true)

    // Simulate invoke
    const registeredHandler = ipcMain._handlers.get("test-channel")!
    const result = await registeredHandler(createMockIpcMainInvokeEvent(), "payload")

    expect(result).toEqual({ ok: true, value: "handled: payload" })
    expect(ipcMain.handle.mock.calls.length).toBe(1)
    expect(ipcMain.handle.mock.calls[0].args[0]).toBe("test-channel")
  })

  test("mockIpcMain.on receives typedSend calls", () => {
    const { ipcMain } = mockElectron
    let receivedPayload = ""
    const listener = (event: any, payload: string) => {
      receivedPayload = payload
    }

    ipcMain.on("test-send-channel", listener)

    expect(ipcMain._listeners.has("test-send-channel")).toBe(true)

    // Simulate send
    const registeredListener = ipcMain._listeners.get("test-send-channel")!
    registeredListener(createMockIpcMainEvent(), "send-payload")

    expect(receivedPayload).toBe("send-payload")
    expect(ipcMain.on.mock.calls.length).toBe(1)
    expect(ipcMain.on.mock.calls[0].args[0]).toBe("test-send-channel")
  })

  test("mock supports typedInvoke patterns from ipc-contract", async () => {
    const { ipcMain } = mockElectron
    // IPC contract pattern expects handlers to return IpcResult
    const ipcContractHandler = async (event: any, req: { id: number }) => {
      if (req.id === 1) {
        return { ok: true, value: "success" }
      }
      return { ok: false, error: { code: "ipc.not_found", message: "Not found", recoverable: true } }
    }

    ipcMain.handle("contract-channel", ipcContractHandler)

    const handler = ipcMain._handlers.get("contract-channel")!
    
    // Simulate successful invoke
    const successResult = await handler(createMockIpcMainInvokeEvent(), { id: 1 })
    expect(successResult.ok).toBe(true)
    expect((successResult as any).value).toBe("success")

    // Simulate failed invoke
    const errorResult = await handler(createMockIpcMainInvokeEvent(), { id: 2 })
    expect(errorResult.ok).toBe(false)
    expect((errorResult as any).error.code).toBe("ipc.not_found")
  })

  test("mock can simulate push channel broadcasts", () => {
    // Push channels are simulated by the webContents.send method in the mock
    const { BrowserWindow } = mockElectron
    const win = BrowserWindow.getAllWindows()[0]
    
    // The createMockWebContents function defaults send to a no-op, 
    // but tests using the mock can attach spy functions to it.
    let sentChannel = ""
    let sentPayload: any = null
    // Here we assign the spy to the mocked object to verify it captures the broadcast
    win.webContents.send = (channel: string, ...args: any[]) => {
      sentChannel = channel
      sentPayload = args[0]
    }

    // A main process service would call this
    win.webContents.send("test-push-channel", { data: "push-data" })

    expect(sentChannel).toBe("test-push-channel")
    expect(sentPayload).toEqual({ data: "push-data" })
  })

  test("cleanup (removeAllListeners, removeHandler, reset) works correctly", () => {
    const { ipcMain } = mockElectron
    const handler = () => {}
    const listener = () => {}
    
    // Register handlers/listeners
    ipcMain.handle("test-channel", handler)
    ipcMain.on("test-channel-on", listener)
    
    expect(ipcMain._handlers.has("test-channel")).toBe(true)
    expect(ipcMain._listeners.has("test-channel-on")).toBe(true)

    // Remove handler
    ipcMain.removeHandler("test-channel")
    expect(ipcMain._handlers.has("test-channel")).toBe(false)
    expect(ipcMain.removeHandler.mock.calls.length).toBe(1)
    expect(ipcMain.removeHandler.mock.calls[0].args[0]).toBe("test-channel")

    // Remove listener
    ipcMain.removeAllListeners("test-channel-on")
    expect(ipcMain._listeners.has("test-channel-on")).toBe(false)
    expect(ipcMain.removeAllListeners.mock.calls.length).toBe(1)
    expect(ipcMain.removeAllListeners.mock.calls[0].args[0]).toBe("test-channel-on")

    // Test mockReset of maps
    // To clear handlers and listeners, test utilities using the mock 
    // will just clear the internal Maps or re-create the mock entirely
    ipcMain._handlers.clear()
    ipcMain._listeners.clear()
    
    expect(ipcMain._handlers.size).toBe(0)
    expect(ipcMain._listeners.size).toBe(0)
    
    // Test mock function reset capabilities
    ipcMain.handle.mockReset()
    expect(ipcMain.handle.mock.calls.length).toBe(0)
    expect(ipcMain.handle._impl).toBeUndefined()
  })
})
