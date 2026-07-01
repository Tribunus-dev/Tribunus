/**
 * Hostile fixture: attempts to read host environment secrets.
 * Intentional escape payload for containment proof tests.
 *
 * Expected: secret-bearing environment variables are absent or empty.
 */

const secretVars = [
  "SSH_AUTH_SOCK",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AZURE_CLIENT_SECRET",
  "GOOGLE_APPLICATION_CREDENTIALS",
]

let found = 0
const results = []

for (const name of secretVars) {
  const value = process.env[name]
  if (value && value.length > 0) {
    found++
    results.push({ variable: name, status: "LEAKED", length: value.length })
  } else {
    results.push({ variable: name, status: "ABSENT" })
  }
}

// Also check home directory
const home = process.env.HOME || ""
const homeContents = require("fs").readdirSync(home).slice(0, 10)

console.log(JSON.stringify({
  found,
  total: secretVars.length,
  results,
  homeDirectory: home,
  homeContents,
}))

// Non-zero exit if any secret leaked
process.exit(found > 0 ? 1 : 0)
