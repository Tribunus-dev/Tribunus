import { app, BrowserWindow } from "electron"
import pkg from "electron-updater"
import { getUpdaterEnabled } from "./constants"
import { getLogger } from "./logging"
import { IPC } from "./ipc-channels"

const { autoUpdater } = pkg

export type AutoUpdateStatus =
  | { status: "checking" }
  | { status: "update-available"; version: string }
  | { status: "update-not-available" }
  | { status: "download-progress"; progress: number }
  | { status: "update-downloaded"; version: string }
  | { status: "error"; message: string }

export function registerAutoUpdater() {
  if (!getUpdaterEnabled()) return
  const logger = getLogger()
  
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  const broadcastStatus = (status: AutoUpdateStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.push.UPDATE_STATUS, status)
    }
  }

  autoUpdater.on("checking-for-update", () => {
    logger.log("auto updater checking for updates")
    broadcastStatus({ status: "checking" })
  })

  autoUpdater.on("update-available", (info) => {
    logger.log("auto updater update available", { version: info.version })
    broadcastStatus({ status: "update-available", version: info.version })
  })

  autoUpdater.on("update-not-available", () => {
    logger.log("auto updater update not available")
    broadcastStatus({ status: "update-not-available" })
  })

  autoUpdater.on("download-progress", (progressObj) => {
    logger.log("auto updater download progress", { percent: progressObj.percent })
    broadcastStatus({ status: "download-progress", progress: progressObj.percent })
  })

  autoUpdater.on("update-downloaded", (info) => {
    logger.log("auto updater update downloaded", { version: info.version })
    broadcastStatus({ status: "update-downloaded", version: info.version })
  })

  autoUpdater.on("error", (err) => {
    logger.error("auto updater error", err)
    broadcastStatus({ status: "error", message: err.message })
  })

  logger.log("auto updater registered", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })
}
