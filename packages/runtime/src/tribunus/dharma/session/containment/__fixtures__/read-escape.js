/**
 * Hostile fixture: attempts to read files outside the sandbox.
 * Intentional escape payload for containment proof tests.
 *
 * Expected: all read attempts denied at OS level.
 */

const fs = require("fs")
const path = require("path")

const targets = [
  // Outside sandbox root
  process.env.HOME || "/Users/test",
  "/etc/passwd",
  "/etc/shadow",
  "/private/var/db",
  "/var/root",
  // Credential paths
  path.join(process.env.HOME || "/Users/test", ".ssh", "id_rsa"),
  path.join(process.env.HOME || "/Users/test", ".aws", "credentials"),
  path.join(process.env.HOME || "/Users/test", ".config", "gcloud"),
  // Traversal attempts
  "../outside-sandbox.txt",
  "../../outside-sandbox.txt",
  "safe/../../../outside-sandbox.txt",
]

let allDenied = 0
let leaked = 0
const results = []

for (const target of targets) {
  try {
    const resolved = path.resolve(target)
    const data = fs.readFileSync(resolved, "utf-8")
    if (data.length > 0) {
      leaked++
      results.push({ target, status: "LEAKED", bytes: data.length })
    } else {
      results.push({ target, status: "EMPTY", bytes: 0 })
    }
  } catch (err) {
    allDenied++
    results.push({ target, status: "DENIED", error: err.code || err.message })
  }
}

// Output JSON for test harness parsing
console.log(JSON.stringify({ allDenied, leaked, total: targets.length, results }))

// Non-zero exit if any file leaked
process.exit(leaked > 0 ? 1 : 0)
