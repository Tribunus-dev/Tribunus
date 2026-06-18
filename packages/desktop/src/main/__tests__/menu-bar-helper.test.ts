import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"

class MockTray {
  constructor() {}
  setToolTip = mock()
  setContextMenu = mock()
}

mock.module("electron", () => {
  return {
    app: {
      isPackaged: false,
      getAppPath: () => "/mock/path",
    },
    Menu: {
      buildFromTemplate: mock(() => ({})),
    },
    Tray: MockTray,
    nativeImage: {
      createFromPath: mock(() => ({
        resize: mock(() => ({})),
        isEmpty: mock(() => false),
      })),
    },
  }
})

describe("createLinuxTray", () => {
  let originalPlatform: string

  beforeEach(() => {
    originalPlatform = process.platform
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    })
  })

  it("should return null if platform is not linux", async () => {
    const { createLinuxTray } = await import("../menu-bar-helper")

    Object.defineProperty(process, 'platform', {
      value: 'darwin'
    })

    const mainWindow = {} as any
    const tray = createLinuxTray(mainWindow)
    expect(tray).toBeNull()
  })

  it("should return Tray instance if platform is linux", async () => {
    const { createLinuxTray } = await import("../menu-bar-helper")

    Object.defineProperty(process, 'platform', {
      value: 'linux'
    })

    const mainWindow = {} as any
    const tray = createLinuxTray(mainWindow)
    expect(tray).not.toBeNull()
  })
})
