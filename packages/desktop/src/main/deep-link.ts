import { BrowserWindow } from "electron"
import { IPC } from "./ipc-channels"

export function parseDeepLink(url: string, mainWindow: BrowserWindow | null): string | null {
  try {
    const parsedUrl = new URL(url)

    if (parsedUrl.protocol !== "tribunus:") {
      return url
    }

    if (parsedUrl.host === "project") {
      const path = parsedUrl.pathname.slice(1) // Remove leading slash
      if (path) {
        return `tribunus://open-project?directory=${encodeURIComponent(path)}`
      }
    } else if (parsedUrl.host === "settings") {
      const section = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""))
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.push.MENU_COMMAND, { command: "settings.open", args: section })
      }
      return null
    } else if (parsedUrl.host === "session") {
      return url
    }

    return url
  } catch (err) {
    // Return as-is if parsing fails
    return url
  }
}
