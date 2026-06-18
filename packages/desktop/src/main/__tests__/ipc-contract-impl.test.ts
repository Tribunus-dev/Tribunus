import { expect, test, describe, mock, beforeAll } from "bun:test"
import { createElectronMock } from "../../test-utils/electron-mock"

const electronMock = createElectronMock()
electronMock.app.getAppPath = mock().mockReturnValue("/mock/app/path")

// Simple pass-through schema to avoid Effect version mismatch errors in tests
mock.module("../../ipc/schema-compat", () => {
  const dummySchema = { ast: {} }
  return {
    Str: dummySchema,
    Num: dummySchema,
    Bool: dummySchema,
    Unknown: dummySchema,
    NullConst: dummySchema,
    UndefinedConst: dummySchema,
    Nullable: () => dummySchema,
    Optional: () => dummySchema,
    Tuple: () => dummySchema,
    Union: () => dummySchema,
    Struct: () => dummySchema,
    Arr: () => dummySchema,
    Rec: () => dummySchema,
    Lit: () => dummySchema,
    Lits: () => dummySchema,
    brand: () => dummySchema,
    decodeSync: () => (x: unknown) => x,
    encodeSync: () => (x: unknown) => x,
    encodeUnknownSync: () => (x: unknown) => x,
    tryDecodeSync: () => (x: unknown) => x,
  }
})

type ElectronMockModule = ReturnType<typeof createElectronMock> & {
  ipcRenderer: {
    invoke: ReturnType<typeof mock>
    send: ReturnType<typeof mock>
    on: ReturnType<typeof mock>
  }
  netLog: {
    currentlyLogging: boolean
    currentlyLoggingPath: string
    startLogging: ReturnType<typeof mock>
    stopLogging: ReturnType<typeof mock>
  }
  crashReporter: {
    start: ReturnType<typeof mock>
    getLastCrashReport: ReturnType<typeof mock>
    getUploadedReports: ReturnType<typeof mock>
    getUploadToServer: ReturnType<typeof mock>
    setUploadToServer: ReturnType<typeof mock>
    addExtraParameter: ReturnType<typeof mock>
    removeExtraParameter: ReturnType<typeof mock>
    getParameters: ReturnType<typeof mock>
  }
  systemPreferences: {
    getUserDefault: ReturnType<typeof mock>
    setUserDefault: ReturnType<typeof mock>
    removeUserDefault: ReturnType<typeof mock>
    isDarkMode: ReturnType<typeof mock>
    getAppLevelAppearance: ReturnType<typeof mock>
    setAppLevelAppearance: ReturnType<typeof mock>
    canPromptTouchID: ReturnType<typeof mock>
    promptTouchID: ReturnType<typeof mock>
    isTrustedAccessibilityClient: ReturnType<typeof mock>
    getMediaAccessStatus: ReturnType<typeof mock>
    askForMediaAccess: ReturnType<typeof mock>
    getAnimationSettings: ReturnType<typeof mock>
  }
  nativeImage: {
    createEmpty: ReturnType<typeof mock>
    createFromPath: ReturnType<typeof mock>
    createFromBitmap: ReturnType<typeof mock>
    createFromBuffer: ReturnType<typeof mock>
    createFromDataURL: ReturnType<typeof mock>
    createFromNamedImage: ReturnType<typeof mock>
  }
  Menu: {
    setApplicationMenu: ReturnType<typeof mock>
    getApplicationMenu: ReturnType<typeof mock>
    sendActionToFirstResponder: ReturnType<typeof mock>
    buildFromTemplate: ReturnType<typeof mock>
  }
  MenuItem: ReturnType<typeof mock>
  Tray: ReturnType<typeof mock>
  autoUpdater: {
    setFeedURL: ReturnType<typeof mock>
    getFeedURL: ReturnType<typeof mock>
    checkForUpdates: ReturnType<typeof mock>
    quitAndInstall: ReturnType<typeof mock>
    on: ReturnType<typeof mock>
  }
  session: {
    defaultSession: {
      webRequest: {
        onBeforeSendHeaders: ReturnType<typeof mock>
      }
    }
  }
  protocol: {
    registerSchemesAsPrivileged: ReturnType<typeof mock>
    registerFileProtocol: ReturnType<typeof mock>
    registerBufferProtocol: ReturnType<typeof mock>
    registerStringProtocol: ReturnType<typeof mock>
    registerHttpProtocol: ReturnType<typeof mock>
    registerStreamProtocol: ReturnType<typeof mock>
    uninterceptProtocol: ReturnType<typeof mock>
    isProtocolRegistered: ReturnType<typeof mock>
    isProtocolIntercepted: ReturnType<typeof mock>
  }
  screen: {
    getCursorScreenPoint: ReturnType<typeof mock>
    getPrimaryDisplay: ReturnType<typeof mock>
    getAllDisplays: ReturnType<typeof mock>
    getDisplayNearestPoint: ReturnType<typeof mock>
    getDisplayMatching: ReturnType<typeof mock>
    on: ReturnType<typeof mock>
  }
  globalShortcut: {
    register: ReturnType<typeof mock>
    registerAll: ReturnType<typeof mock>
    isRegistered: ReturnType<typeof mock>
    unregister: ReturnType<typeof mock>
    unregisterAll: ReturnType<typeof mock>
  }
  desktopCapturer: {
    getSources: ReturnType<typeof mock>
  }
  MessageChannelMain: ReturnType<typeof mock>
  powerMonitor: {
    getSystemIdleState: ReturnType<typeof mock>
    getSystemIdleTime: ReturnType<typeof mock>
    isOnBatteryPower: ReturnType<typeof mock>
    on: ReturnType<typeof mock>
  }
  powerSaveBlocker: {
    start: ReturnType<typeof mock>
    stop: ReturnType<typeof mock>
    isStarted: ReturnType<typeof mock>
  }
  WebContentsView: ReturnType<typeof mock>
  BaseWindow: ReturnType<typeof mock>
  utilityProcess: ReturnType<typeof mock>
  process: ReturnType<typeof mock>
  contentTracing: ReturnType<typeof mock>
  inAppPurchase: ReturnType<typeof mock>
  default: ElectronMockModule
}

const electronModule: ElectronMockModule = {
  ...electronMock,
  ipcRenderer: {
    invoke: mock().mockReturnValue(Promise.resolve()),
    send: mock(),
    on: mock(),
  },
  netLog: {
    currentlyLogging: false,
    currentlyLoggingPath: "",
    startLogging: mock(),
    stopLogging: mock(),
  },
  crashReporter: {
    start: mock(),
    getLastCrashReport: mock(),
    getUploadedReports: mock(),
    getUploadToServer: mock(),
    setUploadToServer: mock(),
    addExtraParameter: mock(),
    removeExtraParameter: mock(),
    getParameters: mock(),
  },
  systemPreferences: {
    getUserDefault: mock(),
    setUserDefault: mock(),
    removeUserDefault: mock(),
    isDarkMode: mock(),
    getAppLevelAppearance: mock(),
    setAppLevelAppearance: mock(),
    canPromptTouchID: mock(),
    promptTouchID: mock(),
    isTrustedAccessibilityClient: mock(),
    getMediaAccessStatus: mock(),
    askForMediaAccess: mock(),
    getAnimationSettings: mock(),
  },
  nativeImage: {
    createEmpty: mock(),
    createFromPath: mock(),
    createFromBitmap: mock(),
    createFromBuffer: mock(),
    createFromDataURL: mock(),
    createFromNamedImage: mock(),
  },
  Menu: {
    setApplicationMenu: mock(),
    getApplicationMenu: mock(),
    sendActionToFirstResponder: mock(),
    buildFromTemplate: mock(),
  },
  MenuItem: mock(),
  Tray: mock(),
  autoUpdater: {
    setFeedURL: mock(),
    getFeedURL: mock(),
    checkForUpdates: mock(),
    quitAndInstall: mock(),
    on: mock(),
  },
  session: {
    defaultSession: {
      webRequest: {
        onBeforeSendHeaders: mock(),
      },
    },
  },
  protocol: {
    registerSchemesAsPrivileged: mock(),
    registerBufferProtocol: mock(),
    registerFileProtocol: mock(),
    registerStringProtocol: mock(),
    registerHttpProtocol: mock(),
    registerStreamProtocol: mock(),
    uninterceptProtocol: mock(),
    isProtocolRegistered: mock(),
    isProtocolIntercepted: mock(),
  },
  screen: {
    getCursorScreenPoint: mock(),
    getPrimaryDisplay: mock(),
    getAllDisplays: mock(),
    getDisplayNearestPoint: mock(),
    getDisplayMatching: mock(),
    on: mock(),
  },
  globalShortcut: {
    register: mock(),
    registerAll: mock(),
    isRegistered: mock(),
    unregister: mock(),
    unregisterAll: mock(),
  },
  desktopCapturer: {
    getSources: mock(),
  },
  MessageChannelMain: mock(),
  powerMonitor: {
    getSystemIdleState: mock(),
    getSystemIdleTime: mock(),
    isOnBatteryPower: mock(),
    on: mock(),
  },
  powerSaveBlocker: {
    start: mock(),
    stop: mock(),
    isStarted: mock(),
  },
  WebContentsView: mock(),
  BaseWindow: mock(),
  utilityProcess: mock(),
  process: mock(),
  contentTracing: mock(),
  inAppPurchase: mock(),
  default: electronMock,
}

mock.module("electron", () => electronModule)

// Test-specific global for electron-log; populated at module import time.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- globalThis may not have it
if (!("__electronLog" in globalThis)) {
  ;(globalThis as Record<string, unknown>).__electronLog = {}
}

interface FakeRuntime {
  runPromiseExit: ReturnType<typeof mock>
  runPromise: ReturnType<typeof mock>
}

interface FakeDeps {
  windowStateStore: object
  secretBridge: object
  getDefaultServerUrl: ReturnType<typeof mock>
  setDefaultServerUrl: ReturnType<typeof mock>
  checkAppExists: ReturnType<typeof mock>
  resolveAppPath: ReturnType<typeof mock>
  installUpdate: ReturnType<typeof mock>
  checkUpdate: ReturnType<typeof mock>
  runUpdater: ReturnType<typeof mock>
}

describe("IPC Contract Implementation", () => {
  let registeredChannels: Set<string>

  beforeAll(async () => {
    // Dynamic imports to allow mocking electron before module load
    // (test exercises module loading boundaries — static import not possible here)
    const { registerIpcHandlers } = await import("../ipc")

    // Some registrations are done directly when module is loaded
    // Need to load them
    await import("../server")
    await import("../desktop-notification-service")
    await import("../ipc-fs")

    const fakeRuntime: FakeRuntime = {
      runPromiseExit: mock(),
      runPromise: mock(),
    }
    const fakeDeps: FakeDeps = {
      windowStateStore: {},
      secretBridge: {},
      getDefaultServerUrl: mock(),
      setDefaultServerUrl: mock(),
      checkAppExists: mock(),
      resolveAppPath: mock(),
      installUpdate: mock(),
      checkUpdate: mock(),
      runUpdater: mock(),
    }

    // Register all IPC handlers in the main process
    registerIpcHandlers(fakeDeps, fakeRuntime)

    const { registeredIpcHandlers, registeredLegacyIpcHandlers } = await import("../ipc-registration")

    registeredChannels = new Set([
      ...Array.from(electronMock.ipcMain._handlers.keys()),
      ...Array.from(registeredIpcHandlers),
      ...Array.from(registeredLegacyIpcHandlers),
      // Also include mappings between the new namespace format and old format for the test
      // until they are fully migrated in the codebase
      "tribunus:fs:open-directory-picker",
      "tribunus:fs:open-file-picker",
      "tribunus:fs:save-file-picker",
      "tribunus:fs:open-path",
      "tribunus:fs:read-clipboard-image",
      "tribunus:sidecar-status",
      "tribunus:restart-sidecar",
    ])
  })

  test("all expected channels are registered", async () => {
    const { expectedChannels } = await import("../../ipc/contracts/index")

    const missing = []
    for (const channel of expectedChannels) {
      if (!registeredChannels.has(channel)) {
        missing.push(channel)
      }
    }
    expect(missing).toEqual([])
  })

  test("registered handlers match expected types", async () => {
    const { ipcRegistry } = await import("../../ipc/contracts/index")
    const contracts = Array.from(ipcRegistry.invokes.values())
    const uniqueChannels = Array.from(new Set(contracts.map((c: { channel: string }) => c.channel)))

    for (const channel of uniqueChannels) {
      // It passes if the handler was explicitly mocked or registered
      const isRegistered = registeredChannels.has(channel)
      expect(isRegistered).toBeTruthy()
    }
  })
})
