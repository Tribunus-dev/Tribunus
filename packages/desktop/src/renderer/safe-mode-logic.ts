import type { SafeModeAction, SafeModeDiagnostics } from "../preload/types"

export interface ActionDef {
  title: string
  description: string
  action: SafeModeAction
}

export const ACTIONS: ActionDef[] = [
  { title: "Export Debug Logs", description: "Save diagnostic logs to a file", action: "export_debug_logs" },
  { title: "Open Logs Directory", description: "Open the logs folder in Finder", action: "open_logs" },
  { title: "Repair Database", description: "Attempt to repair or reset the database", action: "repair_database" },
  { title: "Disable Plugins", description: "Disable all plugins on next startup", action: "disable_plugins" },
  { title: "Disable MCP Servers", description: "Disable all MCP servers on next startup", action: "disable_mcp" },
  { title: "Clear Stale Locks", description: "Remove stale session lock files", action: "clear_stale_locks" },
  { title: "Reset Configuration", description: "Reset config to factory defaults", action: "reset_config" },
  { title: "Copy Diagnostics", description: "Copy diagnostic summary to clipboard", action: "copy_diagnostic_summary" },
]

export const fetchDiagnostics = async (): Promise<SafeModeDiagnostics | null> => {
  try {
    return await window.api.getSafeModeDiagnostics()
  } catch {
    return null
  }
}

export const executeSafeModeAction = async (action: SafeModeAction): Promise<void> => {
  try {
    await window.api.safeModeAction(action)
  } catch {
    // Actions are best-effort
  }
}

export const handleRetryNormalStartup = async (): Promise<void> => {
  try {
    await window.api.safeModeAction("retry_normal_startup")
  } catch {
    // Relaunch failed
  }
}
