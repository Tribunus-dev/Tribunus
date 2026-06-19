import { test, expect, mock } from "bun:test"
import { parseDeepLink } from "./deep-link"
import { IPC } from "./ipc-channels"

test("parseDeepLink handles tribunus://project/<path>", () => {
  const result = parseDeepLink("tribunus://project/path/to/my/project", null)
  expect(result).toBe("tribunus://open-project?directory=path%2Fto%2Fmy%2Fproject")
})

test("parseDeepLink handles tribunus://settings/<section>", () => {
  const sendMock = mock(() => {})
  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      send: sendMock
    }
  } as any
  
  const result = parseDeepLink("tribunus://settings/general", mockWindow)
  expect(result).toBeNull()
  expect(sendMock).toHaveBeenCalledWith(IPC.push.MENU_COMMAND, { command: "settings.open", args: "general" })
})

test("parseDeepLink handles tribunus://session/<id>", () => {
  const result = parseDeepLink("tribunus://session/12345", null)
  expect(result).toBe("tribunus://session/12345")
})

test("parseDeepLink returns unknown URLs as-is", () => {
  const result = parseDeepLink("tribunus://unknown/123", null)
  expect(result).toBe("tribunus://unknown/123")
})

test("parseDeepLink returns non-tribunus URLs as-is", () => {
  const result = parseDeepLink("https://example.com", null)
  expect(result).toBe("https://example.com")
})

test("parseDeepLink handles invalid URLs safely", () => {
  const result = parseDeepLink("not-a-url", null)
  expect(result).toBe("not-a-url")
})
