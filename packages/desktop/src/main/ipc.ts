import { app, BrowserWindow, ipcMain } from "electron"
import { join } from "node:path"
import type { StorageMigrationProgress } from "../preload/types"
import { IPC } from "./ipc-channels"
import { registerConfigIpcHandlers } from "./ipc-config"
import { registerStoreIpcHandlers } from "./ipc-store"
import { registerFsIpcHandlers } from "./ipc-fs"
import { registerSessionIpcHandlers } from "./ipc-session"
import { registerWindowIpcHandlers } from "./ipc-window"
import { registerLocaleIpcHandlers } from "./ipc-locale"
import { registerInitIpcHandlers } from "./ipc-init"
import type { Deps as InitDeps } from "./ipc-init"
import { registerGithubIpcHandlers } from "./github-ipc"
import { registerPluginTransportIpcHandlers } from "./plugin-transport-ipc"
import { registerCapabilitiesIpcHandlers } from "./ipc-capabilities"
import { registerGitIpcHandlers } from "./ipc-git"
import { registerSecretIpcHandlers } from "./desktop-secret-store"
import { registerNotificationIpcHandlers } from "./desktop-notification-service"
import { validateRegisteredIpcHandlers } from "./ipc-registration"
import { registerConversationHandlers } from "./ipc/conversation-handlers"
let registered = false

import type { PrismInferenceServer as PrismInferenceServerType } from "../../../compute-native"
import { createRequire } from "node:module"

export function registerIpcHandlers(deps: InitDeps) {
  if (registered) return
  registered = true

  registerInitIpcHandlers(deps)
  registerConfigIpcHandlers()
  registerStoreIpcHandlers()
  registerFsIpcHandlers()
  registerSessionIpcHandlers()
  registerWindowIpcHandlers()
  registerLocaleIpcHandlers()
  registerGithubIpcHandlers()
  registerPluginTransportIpcHandlers()
  registerCapabilitiesIpcHandlers()
  registerGitIpcHandlers()
  registerSecretIpcHandlers()
  registerNotificationIpcHandlers()

  registerConversationHandlers({
    journalDir: join(app.getPath("userData"), "state", "conversations"),
    valkey: null,
  })

  // ── Engine Generate ─────────────────────────────────────
  ipcMain.handle(IPC.handle.CONVERSATION_ENGINE_GENERATE, async (_event, sessionId: string, prompt: string, maxTokens: number) => {
    try {
      const require = createRequire(import.meta.url)
      const { PrismInferenceServer: PrismInferenceServerImpl } = require("../../../compute-native") as {
        PrismInferenceServer: typeof PrismInferenceServerType
      }

      const server = new PrismInferenceServerImpl({
        modelStorePath: "/tmp",
        maxConcurrentSessions: 2,
        maxInputTokens: 4096,
        maxOutputTokens: 2048,
      })

      // Simple char-code tokenization — placeholder for real tokenizer
      const inputIds = prompt.split("").map((c) => c.charCodeAt(0) % 1000)

      const result = server.generate(sessionId, inputIds, maxTokens)
      const output = result.output || ""

      // Stream tokens back via push channel
      const wins = BrowserWindow.getAllWindows()
      for (let i = 0; i < output.length; i++) {
        for (const win of wins) {
          win.webContents.send(IPC.push.CONVERSATION_STREAM_TOKEN, output[i])
        }
        // Small delay between token pushes for streaming effect
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 3)
        await promise
      }

      return { ok: true as const, value: { ok: true as const } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "Unknown error")
      return { ok: false as const, error: { code: "ipc.internal", message, recoverable: true as const } }
    }
  })

  const issues = validateRegisteredIpcHandlers()
  if (issues.length > 0) {
    console.error("[IPC Registry] Mismatch between IPC_METHOD_REGISTRY and registered handlers:")
    for (const issue of issues) console.error(`  \u2022 ${issue}`)
  }

  // Direct relaunch — renderer sends this to trigger app restart
  ipcMain.on(IPC.send.RELAUNCH, (event) => {
    if (!event.sender) {
      console.error("[ipc] RELAUNCH: blocked — no sender")
      return
    }
    app.relaunch()
    app.exit(0)
  })
}

export function sendStorageMigrationProgress(win: BrowserWindow, progress: StorageMigrationProgress) {
  win.webContents.send(IPC.push.STORAGE_MIGRATION_PROGRESS, progress)
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send(IPC.push.MENU_COMMAND, id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send(IPC.push.DEEP_LINK, urls)
}
