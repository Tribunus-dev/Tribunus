/**
 * Hostile fixture: attempts symlink-based sandbox escape.
 * Intentional escape payload for containment proof tests.
 *
 * Expected: all symlink escape attempts denied at OS level.
 */

const fs = require("fs")
const path = require("path")

const sandboxRoot = process.env.SANDBOX_ROOT || process.cwd()
const attempts = [
  // Symlink to outside file
  { type: "link_outside", from: "escape-link", to: "/etc/passwd" },
  { type: "link_outside", from: "ssh-keys", to: path.join(process.env.HOME || "/Users/test", ".ssh") },
  // Symlink pointing to parent traversal
  { type: "parent_traverse", from: "traverse-up", to: "../../../etc/passwd" },
  // Double symlink through allowed path to denied path
  { type: "double_link", from: "intermediate", to: "target-file" },
  // Hard link attempt
  { type: "hardlink", from: "hard-escape", to: "/etc/hosts" },
]

let allDenied = 0
let succeeded = 0
const results = []

for (const attempt of attempts) {
  const targetPath = path.join(sandboxRoot, attempt.from)
  try {
    // Remove if exists
    try { fs.unlinkSync(targetPath) } catch {}

    if (attempt.type === "hardlink") {
      try {
        fs.linkSync(attempt.to, targetPath)
        succeeded++
        results.push({ ...attempt, status: "CREATED" })
        fs.unlinkSync(targetPath)
      } catch (err) {
        allDenied++
        results.push({ ...attempt, status: "DENIED", error: err.code || err.message })
      }
    } else {
      // Symlink
      try {
        fs.symlinkSync(attempt.to, targetPath)
        // Try to read through the symlink
        try {
          const content = fs.readFileSync(targetPath, "utf-8")
          succeeded++
          results.push({ ...attempt, status: "READABLE", bytes: content.length })
        } catch (readErr) {
          succeeded++
          results.push({ ...attempt, status: "SYMLINK_CREATED_BUT_UNREADABLE", error: readErr.code || readErr.message })
        }
        fs.unlinkSync(targetPath)
      } catch (err) {
        allDenied++
        results.push({ ...attempt, status: "DENIED", error: err.code || err.message })
      }
    }
  } catch (err) {
    allDenied++
    results.push({ ...attempt, status: "ERROR", error: err.message })
  }
}

console.log(JSON.stringify({ allDenied, succeeded, total: attempts.length, results }))
process.exit(succeeded > 0 ? 1 : 0)
