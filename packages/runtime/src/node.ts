
// ── Sidecar IPC handler — uses Electron's utilityProcess parentPort ──
// The desktop spawns this as a utilityProcess (Electron's child process API).
// Messages arrive via process.parentPort.on("message"), NOT process.on("message").
// The parent sends { type: "start", hostname, port, password, userDataPath, needsMigration }.

export { Config } from "@/config/config"
export { Server } from "./server/server"
export * as Log from "@tribunus/core/util/log"
export { Database } from "@/storage/db"
export { applyMigrations } from "@/storage/db.pg"
