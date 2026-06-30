/**
 * Hostile fixture: attempts to make network connections.
 * Intentional escape payload for containment proof tests.
 *
 * Expected: all network attempts denied at OS level.
 */

const http = require("http")
const https = require("https")
const net = require("net")
const dns = require("dns")

const targets = [
  { type: "http", url: "http://localhost:8080/escape-test" },
  { type: "http", url: "http://127.0.0.1:8080/escape-test" },
  { type: "https", url: "https://example.com" },
  { type: "https", url: "https://httpbin.org/get" },
  { type: "dns", hostname: "example.com" },
]

let allDenied = 0
let succeeded = 0
const results = []

function tryHttp(url, label) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      succeeded++
      results.push({ target: label, status: "CONNECTED", code: res.statusCode })
      res.resume()
      resolve()
    })
    req.on("error", (err) => {
      allDenied++
      results.push({ target: label, status: "DENIED", error: err.code || err.message })
      resolve()
    })
    req.setTimeout(2000, () => {
      req.destroy()
      allDenied++
      results.push({ target: label, status: "TIMEOUT" })
      resolve()
    })
  })
}

function tryHttps(url, label) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      succeeded++
      results.push({ target: label, status: "CONNECTED", code: res.statusCode })
      res.resume()
      resolve()
    })
    req.on("error", (err) => {
      allDenied++
      results.push({ target: label, status: "DENIED", error: err.code || err.message })
      resolve()
    })
    req.setTimeout(2000, () => {
      req.destroy()
      allDenied++
      results.push({ target: label, status: "TIMEOUT" })
      resolve()
    })
  })
}

function tryDns(hostname) {
  return new Promise((resolve) => {
    dns.lookup(hostname, (err) => {
      if (err) {
        allDenied++
        results.push({ target: `dns:${hostname}`, status: "DENIED", error: err.code || err.message })
      } else {
        succeeded++
        results.push({ target: `dns:${hostname}`, status: "RESOLVED" })
      }
      resolve()
    })
  })
}

async function main() {
  await tryDns("example.com")
  await tryHttp(targets[0].url, targets[0].url)
  await tryHttp(targets[1].url, targets[1].url)
  await tryHttps(targets[2].url, targets[2].url)
  await tryHttps(targets[3].url, targets[3].url)

  console.log(JSON.stringify({ allDenied, succeeded, total: targets.length, results }))
  process.exit(succeeded > 0 ? 1 : 0)
}

main()
