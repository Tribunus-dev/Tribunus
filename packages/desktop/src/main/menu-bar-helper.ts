import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, BrowserWindow } from "electron"
import { join } from "node:path"
import { app } from "electron"
import type { SidecarState } from "./server"

type Deps = {
  showWindow: () => void
  restartSidecar: () => void
  quit: () => void
  getSidecarStatus: () => SidecarState
}

let tray: Tray | null = null
let refreshTimer: NodeJS.Timeout | null = null

export function createMenuBarHelper(deps: Deps, mainWindow?: BrowserWindow): Tray | null | void {
  if (process.platform === 'linux' && mainWindow) {
    const tray = createLinuxTray(mainWindow)
    if (tray) return tray
    // Fall through to no tray (headless mode)
    return null
  }

  if (process.platform !== "darwin") return
  if (tray) return

  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "icons", "dock.png")
    : join(app.getAppPath(), "resources", "icons", "dock.png")
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) return

  tray = new Tray(icon.resize({ width: 18, height: 18 }))
  tray.setToolTip("Tribunus MCP")
  tray.on("click", () => deps.showWindow())

  const refresh = () => {
    if (!tray) return
    const status = deps.getSidecarStatus()
    tray.setToolTip(`Tribunus MCP: ${status.readyAt ? "ready" : "starting"}`)
    tray.setContextMenu(Menu.buildFromTemplate(buildTemplate(status, deps)))
  }

  refresh()
  refreshTimer = setInterval(refresh, 5000)

  app.once("before-quit", () => {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = null
    tray?.destroy()
    tray = null
  })
}

function buildTemplate(status: SidecarState, deps: Deps): MenuItemConstructorOptions[] {
  return [
    { label: "Tribunus MCP", enabled: false },
    { type: "separator" },
    {
      label: status.readyAt ? "Server Ready" : "Server Starting",
      enabled: false,
    },
    {
      label: "Open Window",
      click: () => deps.showWindow(),
    },
    {
      label: "Restart Sidecar",
      click: () => deps.restartSidecar(),
    },
    {
      label: "Quit Tribunus",
      click: () => deps.quit(),
    },
  ]
}


export function createLinuxTray(mainWindow: BrowserWindow): Tray | null {
  if (process.platform !== 'linux') return null

  try {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, "icons", "dock.png")
      : join(app.getAppPath(), "resources", "icons", "dock.png")
    const icon = nativeImage.createFromPath(iconPath)
    const tray = new Tray(icon.resize({ width: 22, height: 22 }))

    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Tribunus', click: () => { mainWindow.show(); mainWindow.focus() } },
      { type: 'separator' },
      { label: 'Start Server', click: () => { mainWindow.webContents.send('server:start') } },
      { label: 'Stop Server', click: () => { mainWindow.webContents.send('server:stop') } },
      { type: 'separator' },
      { label: 'Check Status', click: () => { mainWindow.webContents.send('server:status') } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.quit() } }
    ])

    tray.setToolTip('Tribunus')
    tray.setContextMenu(contextMenu)
    return tray
  } catch (err) {
    console.warn('[linux-tray] Failed to create tray:', err)
    return null
  }
}
