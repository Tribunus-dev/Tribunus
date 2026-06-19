import { ipcMain, BrowserWindow } from "electron"
import { registerIpcHandler } from "./ipc-registration"
import { IPC } from "./ipc-channels"
import { withIpcResult } from "./ipc-contract"
import { coordinationProjection } from "./coordination-projection"

export function registerCoordinationIpcHandlers() {
  registerIpcHandler(IPC.handle.GET_COORDINATION_SNAPSHOT, async () => {
    return withIpcResult("coordination.getSnapshot", async () => {
      return coordinationProjection.getSnapshot()
    })
  })

  ipcMain.on(IPC.send.REQUEST_COORDINATION_RESYNC, (event) => {
    if (!event.sender) {
      console.error("[ipc] REQUEST_COORDINATION_RESYNC: blocked — no sender")
      return
    }
    coordinationProjection.requestResync()
  })

  coordinationProjection.subscribeDeltas((delta) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.push.COORDINATION_DELTA, delta)
      }
    }
  })
}
