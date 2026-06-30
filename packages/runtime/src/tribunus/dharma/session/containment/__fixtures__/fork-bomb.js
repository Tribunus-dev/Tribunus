/**
 * Hostile fixture: attempts unbounded process creation.
 * Intentional escape payload for containment proof tests.
 *
 * Expected: process limit enforced by OS or containment backend.
 */

const { spawn } = require("child_process")

const MAX_PIDS = 200
const SPAWN_BATCH = 20
const children = []
let spawned = 0
let failed = 0
let exceeded = false

function trySpawnBatch() {
  for (let i = 0; i < SPAWN_BATCH; i++) {
    if (spawned >= MAX_PIDS) {
      exceeded = true
      break
    }
    try {
      const child = spawn("node", ["-e", "setInterval(() => {}, 60000)"], {
        detached: true,
        stdio: "ignore",
      })
      child.unref()
      children.push(child.pid)
      spawned++
    } catch {
      failed++
    }
  }
}

// Spawn in waves
for (let wave = 0; wave < 10; wave++) {
  if (exceeded) break
  trySpawnBatch()
}

// Kill all children
for (const pid of children) {
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // already dead
  }
}

console.log(JSON.stringify({
  spawned,
  failed,
  maxReached: exceeded,
  liveChildren: children.length,
}))

// Non-zero exit if we successfully spawned too many
process.exit(spawned > 50 ? 1 : 0)
