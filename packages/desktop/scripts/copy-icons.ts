import { $ } from "bun"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const src = `./icons/${channel}`
const dest = "resources/icons"

await $`rm -rf ${dest}`
await $`cp -R ${src} ${dest}`
console.log(`Copied ${channel} icons from ${src} to ${dest}`)

await $`mkdir -p assets/icons`
await $`cp ${src}/icon.png assets/icons/tribunus-app-icon.png`
console.log(`Copied ${src}/icon.png to assets/icons/tribunus-app-icon.png for electron-builder`)
